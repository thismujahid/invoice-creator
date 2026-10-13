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
  applyUnitPurchase,
  estimatePurchaseOps,
  prependPurchasePriceHistory,
  round2,
  round4,
  toNum,
} from "./finance";
import type { PriceDecision } from "./finance";
import { writeSupplierSummaryDelta } from "./performanceSummaries";

export interface PurchaseItemInput {
  /** Existing product id; null/undefined for brand-new products. */
  product_id?: string | null;
  /** Required for new products. */
  name?: string | null;
  quantity: number;
  unit_cost: number;
  pricing: PriceDecision;
  /** Required selling price for new products. */
  price?: number | null;
  /** Shortage alert for new products, applied to the BASE unit in base-unit
   *  terms (default 5). Per-unit thresholds may also arrive on `units`. */
  threshold?: number | null;
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
    const items = input.items ?? [];
    const total = round2(items.reduce((sum, item) => sum + round2(toNum(item.quantity) * toNum(item.unit_cost)), 0));
    const paid = round2(toNum(input.paidNow));
    const { applied: invoicePaid, advance } = allocateSupplierCash(total, paid);
    const fingerprint = JSON.stringify(input);
    let cached: Product[] = [];
    let cashBalanceAfterPurchase: number | null = null;
    let result: ExecutePurchaseResult = { ok: false, error: "تعذر حفظ فاتورة المورد." };
    try {
      await runTx(async (tx) => {
        const invoiceRef = doc(db, "purchase_invoices", input.idempotencyKey);
        const duplicate = await tx.get(invoiceRef);
        if (duplicate.exists()) {
          const data = duplicate.data();
          if (data.request_fingerprint !== fingerprint) throw new Error("VALIDATION:مفتاح العملية مستخدم لبيانات مختلفة. أعد فتح الاستيراد.");
          result = { ok: true, duplicate: true, id: invoiceRef.id, total: round2(toNum(data.total_amount)), paid: round2(toNum(data.paid_amount)), remaining: round2(toNum(data.remaining_amount)), fullyPaid: toNum(data.remaining_amount) <= 0, advance: round2(toNum(data.advance_amount)) };
          return;
        }
        const cashRef = doc(db, "cashbox", "current");
        const cash = await tx.get(cashRef);
        const balance = cash.exists() ? round2(toNum(cash.data()?.balance)) : 0;
        if (paid > 0 && !cash.exists()) throw new Error("VALIDATION:لا يمكن الدفع قبل تهيئة الخزنة.");
        if (paid - balance > 1e-9) throw new Error("VALIDATION:المدفوع الآن يتجاوز رصيد الخزنة المتاح.");
        const productIds = [...new Set(items.map((item) => item.product_id).filter((id): id is string => !!id))];
        const products = new Map<string, { ref: ReturnType<typeof doc>; data: Product }>();
        for (const productId of productIds) {
          const snap = await tx.get(doc(db, "products", productId));
          if (!snap.exists()) throw new Error("VALIDATION:منتج غير موجود.");
          products.set(productId, { ref: snap.ref, data: { id: snap.id, ...(snap.data() as object) } as Product });
        }
        const now = serverTimestamp();
        const nowMs = Date.now();
        const movements: Record<string, unknown>[] = [];
        const invoiceItems: PurchaseInvoiceItem[] = [];
        const writes = new Map<string, Product>();
        let seq = 0;
        for (const item of items) {
          const quantity = round4(toNum(item.quantity));
          const cost = round4(toNum(item.unit_cost));
          if (!(quantity > 0) || !(cost >= 0)) throw new Error("VALIDATION:كمية أو تكلفة الشراء غير صالحة.");
          let product: Product;
          let productId: string;
          if (item.product_id) {
            product = writes.get(item.product_id) ?? products.get(item.product_id)!.data;
            productId = item.product_id;
          } else {
            productId = doc(collection(db, "products")).id;
            const unitId = item.unit_id || "unit";
            const provided = item.units?.length ? item.units : [{ id: unitId, name: item.unit_name || "وحدة", factor: 1, selling_price: item.price ?? null, purchase_price: cost, low_stock_threshold: item.threshold ?? null, can_purchase: true, can_sell: toNum(item.price) > 0, allows_fractional: false }];
            product = { id: productId, name: String(item.name ?? "").trim(), price: null, cost_price: null, units: provided.map((unit) => ({ ...unit, factor: 1, stock_quantity: round4(toNum(unit.stock_quantity)), average_cost: unit.average_cost ?? null })) };
          }
          const unitId = item.unit_id ?? product.units?.[0]?.id;
          const index = product.units?.findIndex((unit) => unit.id === unitId) ?? -1;
          if (index < 0) throw new Error("VALIDATION:وحدة الشراء غير موجودة.");
          const unit = product.units![index]!;
          const basis = item.pricing.averageBasis;
          if (input.source === "excel_import" && basis && (Math.abs(toNum(unit.stock_quantity) - basis.stock) > 0.00005 || Math.abs(toNum(unit.average_cost) - basis.cost) > 0.00005)) {
            throw Object.assign(new Error("STALE_PRICING"), { stale: { product_id: productId, product_name: product.name, newAvg: toNum(unit.average_cost), proposed: null, oldPrice: toNum(unit.selling_price), oldCost: toNum(unit.average_cost), rate: null } });
          }
          if (unit.can_purchase === false) throw new Error("VALIDATION:هذه الوحدة مرجعية ولا يمكن الشراء بها.");
          if (unit.allows_fractional !== true && Math.abs(quantity - Math.round(quantity)) > 1e-9) throw new Error("VALIDATION:هذه الوحدة لا تقبل كميات كسرية.");
          const movementId = doc(collection(db, "inventory_transactions")).id;
          let nextUnit: ProductUnit;
          try { nextUnit = applyUnitPurchase(unit, quantity, cost, item.pricing); }
          catch (error) { throw new Error(`VALIDATION:${error instanceof Error ? error.message : "بيانات الشراء غير صالحة."}`); }
          nextUnit.purchase_price_history = prependPurchasePriceHistory(unit.purchase_price_history, cost, nowMs);
          product = { ...product, units: product.units!.map((entry, entryIndex) => entryIndex === index ? nextUnit : entry) };
          writes.set(productId, product);
          invoiceItems.push({ product_id: productId, product_name: product.name, quantity, unit_cost: cost, unit_id: unit.id, unit_name: unit.name, line_total: round2(quantity * cost) });
          movements.push({ id: movementId, type: "purchase", direction: "in", product_id: productId, product_name: product.name, quantity, unit_quantity: quantity, unit_id: unit.id, unit_name: unit.name, unit_cost: cost, purchase_invoice_id: invoiceRef.id, note: input.note ?? null, seq: seq++, created_by: by(), created_at: now });
        }
        const remaining = round2(total - invoicePaid);
        tx.set(invoiceRef, { request_fingerprint: fingerprint, supplier_name: input.supplier_name?.trim() || null, supplier_id: input.supplier_id ?? null, supplier_ref: input.supplier_ref?.trim() || null, invoice_number: input.invoice_number?.trim() || null, source: input.source ?? "manual", pinned: false, items: invoiceItems, product_ids: [...writes.keys()], total_amount: total, paid_amount: invoicePaid, advance_amount: advance, remaining_amount: remaining, status: deriveSupplierInvoiceStatus(invoicePaid, remaining), payment_ids: [], note: input.note ?? null, created_by: by(), created_at: now });
        for (const [productId, product] of writes) {
          const ids = movements.filter((movement) => movement.product_id === productId).map((movement) => String(movement.id));
          tx.set(doc(db, "products", productId), { name: product.name, units: product.units, is_active: product.is_active !== false, last_inventory_transaction_id: ids.at(-1) ?? null, last_inventory_transaction_ids: ids, last_purchase_invoice_id: invoiceRef.id }, { merge: true });
        }
        for (const movement of movements) {
          const { id, ...data } = movement;
          tx.set(doc(db, "inventory_transactions", String(id)), data);
        }
        if (advance > 0) tx.set(doc(db, "supplier_advances", invoiceRef.id), { supplier_id: input.supplier_id, supplier_name: input.supplier_name ?? null, purchase_invoice_id: invoiceRef.id, amount: advance, remaining_amount: advance, created_by: by(), created_at: now });
        if (paid > 0) {
          cashBalanceAfterPurchase = round2(balance - paid);
          tx.set(cashRef, { balance: cashBalanceAfterPurchase, updated_at: now }, { merge: true });
        }
        if (paid > 0) tx.set(doc(collection(db, "cash_transactions")), { type: "inventory_purchase", direction: "out", amount: paid, purchase_invoice_id: invoiceRef.id, reference_type: "supplier_invoice", reference_id: invoiceRef.id, reference_label: `فاتورة توريد من ${input.supplier_name?.trim() || "مورد غير مسمى"}`, note: input.note ?? null, created_by: by(), created_at: now });
        writeSupplierSummaryDelta(tx, db, { supplier_id: input.supplier_id, supplier_name: input.supplier_name }, { invoice_count: 1, total_purchases: total, outstanding_payable: remaining, advance_receivable: advance });
        cached = [...writes.values()];
        result = { ok: true, id: invoiceRef.id, total, paid: invoicePaid, remaining, fullyPaid: remaining <= 0, advance };
      });
      for (const product of cached) useProductsStore().upsertCached(product);
      if (cashBalanceAfterPurchase !== null) useCashbox().balance = cashBalanceAfterPurchase;
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_PRICING") return { ok: false, error: "تغيّر رصيد الوحدة أو متوسط تكلفتها. راجع المعاينة ثم أكد مجددًا.", stale: (error as Error & { stale?: ExecutePurchaseResult["stale"] }).stale };
      if (error instanceof Error && error.message.startsWith("VALIDATION:")) return { ok: false, error: error.message.slice(11) };
      console.error(error);
      return { ok: false, error: "تعذر تسجيل شراء المخزون." };
    }
  }

  async function executePurchase(input: ExecutePurchaseInput): Promise<ExecutePurchaseResult> {
    if (!input.idempotencyKey) return { ok: false, error: "مفتاح عدم التكرار مفقود." };
    const items = input.items ?? [];
    if (!items.length) return { ok: false, error: "لا توجد أصناف للشراء." };
    const newCount = items.filter((i) => !i.product_id).length;
    if (items.length > MAX_PURCHASE_ITEMS) {
      return { ok: false, error: `عدد الأصناف (${items.length}) يتجاوز حد المعالجة الذرية (${MAX_PURCHASE_ITEMS}) — يلزم مسار خادمي لهذه الفاتورة.` };
    }
    if (estimatePurchaseOps(items.length, newCount) > 450) {
      return { ok: false, error: "الفاتورة تتجاوز حد الكتابات الآمن للمعاملة الذرية — يلزم مسار خادمي." };
    }
    // Uniqueness is product + unit (same product may appear in several
    // purchase units, e.g. 2 cartons + 5 pieces). Exact duplicate rows
    // (same product + same unit) are still rejected.
    const seenItems = new Set<string>();
    for (const [index, item] of items.entries()) {
      const key = item.product_id
        ? `id:${item.product_id}|unit:${String(item.unit_id ?? "")}`
        : `name:${String(item.name ?? "").trim().toLocaleLowerCase()}`;
      if (seenItems.has(key)) return { ok: false, error: `الصنف رقم ${index + 1} مكرر في الفاتورة.` };
      seenItems.add(key);
    }
    // Client-side pre-validation (server re-validates inside txn).
    for (const [idx, it] of items.entries()) {
      const n = idx + 1;
      if (it.product_id && typeof it.product_id !== "string") return { ok: false, error: `صنف ${n}: معرّف غير صالح.` };
      if (!Number.isFinite(it.quantity) || !(it.quantity > 0)) return { ok: false, error: `صنف ${n}: الكمية يجب أن تكون أكبر من صفر.` };
      if (!Number.isFinite(it.unit_cost) || it.unit_cost < 0) return { ok: false, error: `صنف ${n}: تكلفة الوحدة غير صالحة.` };
      if (!it.product_id) {
        if (!String(it.name ?? "").trim()) return { ok: false, error: `صنف ${n}: اسم المنتج الجديد مطلوب.` };
        if (!(toNum(it.price) > 0)) return { ok: false, error: `صنف ${n}: سعر بيع المنتج الجديد مطلوب.` };
      }
      if (it.pricing.mode === "custom" && (!Number.isFinite(it.pricing.price) || it.pricing.price < 0)) {
        return { ok: false, error: `صنف ${n}: سعر البيع المخصص غير صالح.` };
      }
    }
    const total = round2(items.reduce((s, it) => s + round2(toNum(it.quantity) * round4(toNum(it.unit_cost))), 0));
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
