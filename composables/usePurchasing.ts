import { collection, doc, getDocs, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot } from "firebase/firestore";
import type {
  PurchaseInvoice,
  PurchaseInvoiceItem,
  SupplierPayment,
  SupplierAdvance,
} from "~/types/finance";
import { deriveSupplierInvoiceStatus } from "~/types/finance";
import type { Product, ProductUnit } from "~/types";
import { toDateSafe } from "~/types";
import {
  MAX_PURCHASE_ITEMS,
  allocateSupplierCash,
  round2,
  round4,
  toNum,
} from "./finance";
import type { PriceDecision } from "./finance";
import { writeSupplierSummaryDelta } from "./performanceSummaries";
import { callStaff } from "./staffApi";

export interface PurchaseItemInput {
  product_id?: string | null;
  quantity: number;
  unit_cost: number;
  pricing: PriceDecision;
  unit_id?: string | null;
  unit_name?: string | null;
  unit_factor?: number | null;
  base_unit_name?: string | null;
  base_unit_id?: string | null;
  units?: ProductUnit[];
}

export interface ExecutePurchaseInput {
  /** Client-generated idempotency key (dialog UUID, or `import:<hash>`). */
  idempotencyKey: string;
  supplier_name?: string | null;
  supplier_id?: string | null;
  supplier_ref?: string | null;
  invoice_number?: string | null;
  source?: "manual" | "excel_import" | "repeat";
  items: PurchaseItemInput[];
  paidNow: number;
  note?: string | null;
}

export interface ExecutePurchaseResult {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  id?: string;
  total?: number;
  paid?: number;
  remaining?: number;
  fullyPaid?: boolean;
  advance?: number;
  stale?: {
    product_id: string;
    product_name: string;
    newAvg: number;
    proposed: number | null;
    oldPrice: number;
    oldCost: number;
    rate: number | null;
  };
}

export interface PurchaseInvoicePageOptions {
  supplierId?: string | null;
  status?: "all" | "paid" | "partial" | "unpaid";
  pageSize?: number;
  cursor?: QueryDocumentSnapshot | null;
}

export interface PurchaseInvoicePage {
  items: PurchaseInvoice[];
  pinned: PurchaseInvoice[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

/** Unified purchase core: single dialog, bulk import — one code path (S5).
 *  Single atomic transaction: idempotency + reads + validations + invoice
 *  doc + stock/avg updates + logs + ONE cash movement for paidNow. */
export const usePurchasing = defineStore("purchasing", () => {
  const { db, serverTimestamp, getDoc, updateItem } = useFirebase();
  const authStore = useAuth();

  const by = () => (authStore.currentUserKey as string) || null;

  async function executeUnitPurchase(input: ExecutePurchaseInput): Promise<ExecutePurchaseResult> {
    try {
      const result = await callStaff<ExecutePurchaseInput, ExecutePurchaseResult>("executeInventoryPurchase", input);
      useProductsStore().invalidateCache();
      await useCashbox().fetchCashbox();
      return result;
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "";
      return { ok: false, error: message || "تعذر تسجيل شراء المخزون." };
    }
  }

  async function executePurchase(input: ExecutePurchaseInput): Promise<ExecutePurchaseResult> {
    if (!input.idempotencyKey) return { ok: false, error: "مفتاح عدم التكرار مفقود." };
    const items = input.items ?? [];
    if (!items.length) return { ok: false, error: "لا توجد أصناف للشراء." };
    if (items.length > MAX_PURCHASE_ITEMS) {
      return { ok: false, error: `عدد الأصناف (${items.length}) يتجاوز حد المعالجة الآمن (${MAX_PURCHASE_ITEMS}).` };
    }
    // Client-side pre-validation (server re-validates inside txn).
    for (const [idx, it] of items.entries()) {
      const n = idx + 1;
      if (it.product_id && typeof it.product_id !== "string") return { ok: false, error: `صنف ${n}: معرّف غير صالح.` };
      if (!Number.isFinite(it.quantity) || !(it.quantity > 0)) return { ok: false, error: `صنف ${n}: الكمية يجب أن تكون أكبر من صفر.` };
      if (!Number.isFinite(it.unit_cost) || it.unit_cost < 0) return { ok: false, error: `صنف ${n}: تكلفة الوحدة غير صالحة.` };
      if (!it.product_id) return { ok: false, error: `صنف ${n}: اختر نوعًا مخزنيًا موجودًا قبل تسجيل الشراء.` };
      if (it.pricing.mode === "custom" && (!Number.isFinite(it.pricing.price) || it.pricing.price < 0)) {
        return { ok: false, error: `صنف ${n}: سعر البيع المخصص غير صالح.` };
      }
    }
    const total = round2(items.reduce((s, it) => s + round2(toNum(it.quantity) * toNum(it.unit_cost)), 0));
    const paid = round2(toNum(input.paidNow));
    if (!Number.isFinite(input.paidNow) || input.paidNow < 0) return { ok: false, error: "المدفوع الآن يجب ألا يكون سالبًا." };
    if (paid > total && !input.supplier_id) return { ok: false, error: "اختر المورد لتسجيل المبلغ الزائد كسلفة مستحقة لنا." };
    return executeUnitPurchase(input);
  }

  async function paySupplierInvoice(
    invoiceId: string,
    amount: number,
    note?: string | null,
    idempotencyKey?: string,
  ): Promise<{ ok: true; remaining: number; advance: number; duplicate?: boolean } | { ok: false; error: string }> {
    const pay = round2(toNum(amount));
    if (!invoiceId) return { ok: false, error: "فاتورة غير صالحة." };
    if (!(pay > 0)) return { ok: false, error: "مبلغ السداد يجب أن يكون أكبر من صفر." };
    const key = idempotencyKey || `${invoiceId}:${Date.now()}:${Math.floor(Math.random() * 1e6)}`;
    try {
      let out: { ok: true; remaining: number; advance: number; duplicate?: boolean } | { ok: false; error: string } = {
        ok: false,
        error: "خطأ غير متوقع.",
      };
      let isDuplicate = false;
      let resultingBalance: number | null = null;
      await runTx(async (tx) => {
        const payRef = doc(db, "supplier_payments", key);
        const paySnap = await tx.get(payRef);
        if (paySnap.exists()) {
          const existingPayment = paySnap.data();
          if (
            existingPayment.purchase_invoice_id !== invoiceId ||
            Math.abs(round2(toNum(existingPayment.cash_amount ?? existingPayment.amount)) - pay) > 0.005
          ) {
            throw new Error("VALIDATION:مفتاح السداد مستخدم لدفعة مختلفة.");
          }
          isDuplicate = true;
          return;
        }
        const invRef = doc(db, "purchase_invoices", invoiceId);
        const invSnap = await tx.get(invRef);
        if (!invSnap.exists()) throw new Error("VALIDATION:فاتورة الشراء غير موجودة.");
        const d = invSnap.data() as Record<string, unknown>;
        const remaining = round2(toNum(d.remaining_amount));
        if (!(remaining > 0)) throw new Error("VALIDATION:الفاتورة مسددة بالفعل.");
        const { applied, advance } = allocateSupplierCash(remaining, pay);
        if (advance > 0 && !d.supplier_id) throw new Error("VALIDATION:اربط الفاتورة بمورد لتسجيل السلفة.");
        const cRef = doc(db, "cashbox", "current");
        const cSnap = await tx.get(cRef);
        if (!cSnap.exists()) throw new Error("VALIDATION:لا يمكن السداد قبل تهيئة الخزنة.");
        const bal = round2(Number(cSnap.data()?.balance || 0));
        if (pay - bal > 1e-9) throw new Error("VALIDATION:الدفعة تتجاوز رصيد الخزنة المتاح.");
        const now = serverTimestamp();
        const byWho = by();
        const paid = round2(toNum(d.paid_amount) + applied);
        const remainingAfterPayment = round2(remaining - applied);
        const status = deriveSupplierInvoiceStatus(paid, remainingAfterPayment);
        resultingBalance = round2(bal - pay);
        const ids = [...((d.payment_ids as string[]) ?? []), key];
        tx.update(invRef, { paid_amount: paid, remaining_amount: remainingAfterPayment, status, payment_ids: ids });
        writeSupplierSummaryDelta(tx, db, { supplier_id: d.supplier_id as string | null, supplier_name: d.supplier_name as string | null }, { outstanding_payable: -applied, advance_receivable: advance });
        if (advance > 0) {
          tx.set(doc(db, "supplier_advances", key), {
            supplier_id: d.supplier_id,
            supplier_name: String(d.supplier_name || "مورد غير مسمى"),
            purchase_invoice_id: invoiceId,
            amount: advance,
            remaining_amount: advance,
            created_by: byWho,
            created_at: now,
          });
        }
        tx.set(payRef, {
          purchase_invoice_id: invoiceId,
          reference_type: "supplier_invoice",
          reference_id: invoiceId,
          reference_label: `فاتورة توريد من ${String(d.supplier_name || "مورد غير مسمى")}`,
          amount: applied,
          cash_amount: pay,
          advance_amount: advance,
          note: note ?? null,
          created_by: byWho,
          created_at: now,
        });
        tx.set(doc(collection(db, "cash_transactions")), {
          type: "supplier_payment",
          direction: "out",
          amount: pay,
          purchase_invoice_id: invoiceId,
          reference_type: "supplier_invoice",
          reference_id: invoiceId,
          reference_label: `فاتورة توريد من ${String(d.supplier_name || "مورد غير مسمى")}`,
          note: note ?? null,
          created_by: byWho,
          created_at: now,
        });
        tx.set(cRef, { balance: resultingBalance as number, updated_at: now }, { merge: true });
        out = { ok: true, remaining: remainingAfterPayment, advance };
      });
      if (isDuplicate) {
        // Already recorded: report current state instead of re-executing.
        const invSnap = await getDoc(doc(db, "purchase_invoices", invoiceId));
        const rem = invSnap.exists() ? round2(toNum((invSnap.data() as Record<string, unknown>).remaining_amount)) : 0;
        return { ok: true, remaining: rem, advance: 0, duplicate: true };
      }
      if (resultingBalance !== null) useCashbox().balance = resultingBalance;
      return out;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر تسجيل السداد." };
    }
  }

  async function fetchPurchaseInvoice(invoiceId: string): Promise<PurchaseInvoice | null> {
    const snapshot = await getDoc(doc(db, "purchase_invoices", invoiceId));
    return snapshot.exists() ? ({ id: snapshot.id, ...(snapshot.data() as object) }) as PurchaseInvoice : null;
  }

  async function fetchSupplierAdvances(supplierId: string): Promise<SupplierAdvance[]> {
    if (!supplierId) return [];
    const snapshot = await getDocs(query(collection(db, "supplier_advances"), where("supplier_id", "==", supplierId)));
    return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<SupplierAdvance, "id">) })).filter((item) => toNum(item.remaining_amount) > 0);
  }

  async function settleSupplierAdvance(input: { advanceId: string; invoiceId?: string; amount: number; mode: "apply" | "refund"; key: string }): Promise<{ ok: true; duplicate?: boolean } | { ok: false; error: string }> {
    const amount = round2(input.amount);
    if (!(amount > 0) || !input.advanceId || !input.key || (input.mode === "apply" && !input.invoiceId)) return { ok: false, error: "بيانات تسوية السلفة غير صالحة." };
    try {
      let duplicate = false;
      let nextCash: number | null = null;
      await runTx(async (tx) => {
        const movementRef = doc(db, "supplier_advance_transactions", input.key);
        const existing = await tx.get(movementRef);
        if (existing.exists()) {
          const data = existing.data();
          if (data.advance_id !== input.advanceId || data.mode !== input.mode || data.amount !== amount || (data.invoice_id ?? null) !== (input.invoiceId ?? null)) throw new Error("VALIDATION:مفتاح التسوية مستخدم لعملية مختلفة.");
          duplicate = true;
          return;
        }
        const advanceRef = doc(db, "supplier_advances", input.advanceId);
        const advanceSnap = await tx.get(advanceRef);
        if (!advanceSnap.exists()) throw new Error("VALIDATION:سلفة المورد غير موجودة.");
        const advance = advanceSnap.data();
        if (amount > toNum(advance.remaining_amount)) throw new Error("VALIDATION:المبلغ يتجاوز السلفة المتاحة.");
        const invoiceRef = input.mode === "apply" ? doc(db, "purchase_invoices", input.invoiceId!) : null;
        const invoiceSnap = invoiceRef ? await tx.get(invoiceRef) : null;
        if (invoiceRef && (!invoiceSnap?.exists() || invoiceSnap.data().supplier_id !== advance.supplier_id || amount > toNum(invoiceSnap.data().remaining_amount))) throw new Error("VALIDATION:الفاتورة غير صالحة أو المبلغ يتجاوز باقيها.");
        const cashRef = input.mode === "refund" ? doc(db, "cashbox", "current") : null;
        const cashSnap = cashRef ? await tx.get(cashRef) : null;
        if (cashRef && !cashSnap?.exists()) throw new Error("VALIDATION:الخزنة غير مهيأة.");
        const now = serverTimestamp();
        tx.update(advanceRef, { remaining_amount: round2(toNum(advance.remaining_amount) - amount) });
        writeSupplierSummaryDelta(tx, db, { supplier_id: advance.supplier_id, supplier_name: advance.supplier_name }, { advance_receivable: -amount, ...(invoiceRef ? { outstanding_payable: -amount } : {}) });
        if (invoiceRef && invoiceSnap) {
          const invoice = invoiceSnap.data()!;
          const paid = round2(toNum(invoice.paid_amount) + amount);
          const remaining = round2(toNum(invoice.remaining_amount) - amount);
          tx.update(invoiceRef, { paid_amount: paid, remaining_amount: remaining, status: deriveSupplierInvoiceStatus(paid, remaining), payment_ids: [...((invoice.payment_ids as string[]) ?? []), input.key] });
          tx.set(doc(db, "supplier_payments", input.key), { purchase_invoice_id: input.invoiceId, advance_id: input.advanceId, return_id: advance.source_return_id ?? null, amount, cash_amount: 0, note: advance.source_return_id ? "تسوية من رصيد مرتجع المورد" : "تسوية من سلفة المورد", created_by: by(), created_at: now });
        }
        if (cashRef && cashSnap) {
          nextCash = round2(toNum(cashSnap.data()?.balance) + amount);
          tx.set(cashRef, { balance: nextCash, updated_at: now }, { merge: true });
          tx.set(doc(db, "cash_transactions", input.key), { type: "supplier_advance_refund", direction: "in", amount, reference_type: "supplier_invoice", reference_id: advance.purchase_invoice_id, reference_label: `استرداد سلفة من ${String(advance.supplier_name || "مورد")}`, purchase_invoice_id: advance.purchase_invoice_id, return_id: advance.source_return_id ?? null, created_by: by(), created_at: now });
        }
        tx.set(movementRef, { advance_id: input.advanceId, supplier_id: advance.supplier_id, invoice_id: input.invoiceId ?? null, mode: input.mode, amount, created_by: by(), created_at: now });
      });
      if (nextCash !== null) useCashbox().balance = nextCash;
      return { ok: true, duplicate };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("VALIDATION:")) return { ok: false, error: error.message.slice(11) };
      console.error(error);
      return { ok: false, error: "تعذر تسوية سلفة المورد." };
    }
  }

  async function fetchPurchaseInvoices(options: PurchaseInvoicePageOptions = {}): Promise<PurchaseInvoicePage> {
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
    const buildQuery = (pinnedOnly: boolean) => {
      let q = query(collection(db, "purchase_invoices"));
      if (options.supplierId) q = query(q, where("supplier_id", "==", options.supplierId));
      if (pinnedOnly) q = query(q, where("pinned", "==", true));
      if (options.status && options.status !== "all") q = query(q, where("status", "==", options.status));
      if (!pinnedOnly) q = query(q, orderBy("created_at", "desc"));
      if (!pinnedOnly && options.cursor) q = query(q, startAfter(options.cursor));
      return query(q, limit(pinnedOnly ? 20 : pageSize + 1));
    };
    const [pageSnapshot, pinnedSnapshot] = await Promise.all([
      getDocs(buildQuery(false)),
      getDocs(buildQuery(true)),
    ]);
    const pageDocs = pageSnapshot.docs.slice(0, pageSize);
    return {
      items: pageDocs.map((d) => ({ id: d.id, ...(d.data() as object) }) as PurchaseInvoice),
      pinned: pinnedSnapshot.docs
        .map((d) => ({ id: d.id, ...(d.data() as object) }) as PurchaseInvoice)
        .sort((left, right) => (toDateSafe(right.created_at)?.getTime() ?? 0) - (toDateSafe(left.created_at)?.getTime() ?? 0))
        .slice(0, 20),
      cursor: pageDocs.at(-1) ?? null,
      hasMore: pageSnapshot.docs.length > pageSize,
    };
  }

  async function fetchSupplierPayments(invoiceId: string): Promise<SupplierPayment[]> {
    const snapshot = await getDocs(query(collection(db, "supplier_payments"), where("purchase_invoice_id", "==", invoiceId), orderBy("created_at", "desc"), limit(50)));
    return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as SupplierPayment);
  }

  async function setPurchaseInvoicePinned(invoiceId: string, pinned: boolean): Promise<void> {
    await updateItem("purchase_invoices", invoiceId, { pinned });
  }

  return { executePurchase, paySupplierInvoice, fetchPurchaseInvoice, fetchPurchaseInvoices, fetchSupplierPayments, fetchSupplierAdvances, settleSupplierAdvance, setPurchaseInvoicePinned };
});
