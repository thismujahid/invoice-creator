import { collection, doc } from "firebase/firestore";
import type {
  PurchaseInvoice,
  PurchaseInvoiceItem,
  SupplierPayment,
} from "~/types/finance";
import {
  MAX_PURCHASE_ITEMS,
  applyStockGroup,
  estimatePurchaseOps,
  proposedSellingPrice,
  round2,
  toNum,
} from "./finance";
import type { PriceDecision } from "./finance";

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
  /** Stock alert threshold for new products (default 5). */
  threshold?: number | null;
}

export interface ExecutePurchaseInput {
  /** Client-generated idempotency key (dialog UUID, or `import:<hash>`). */
  idempotencyKey: string;
  supplier_name?: string | null;
  supplier_ref?: string | null;
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

/** Unified purchase core: single dialog, bulk import — one code path (S5).
 *  Single atomic transaction: idempotency + reads + validations + invoice
 *  doc + stock/avg updates + logs + ONE cash movement for paidNow. */
export const usePurchasing = defineStore("purchasing", () => {
  const { db, serverTimestamp, readFrom, getDoc } = useFirebase();
  const authStore = useAuth();

  const by = () => (authStore.currentUserKey as string) || null;

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
    const seenItems = new Set<string>();
    for (const [index, item] of items.entries()) {
      const key = item.product_id ? `id:${item.product_id}` : `name:${String(item.name ?? "").trim().toLocaleLowerCase()}`;
      if (seenItems.has(key)) return { ok: false, error: `الصنف رقم ${index + 1} مكرر في الفاتورة.` };
      seenItems.add(key);
    }
    // Client-side pre-validation (server re-validates inside txn).
    for (const [idx, it] of items.entries()) {
      const n = idx + 1;
      if (it.product_id && typeof it.product_id !== "string") return { ok: false, error: `صنف ${n}: معرّف غير صالح.` };
      if (!(toNum(it.quantity) > 0)) return { ok: false, error: `صنف ${n}: الكمية يجب أن تكون أكبر من صفر.` };
      if (!(toNum(it.unit_cost) >= 0) || !Number.isFinite(toNum(it.unit_cost))) return { ok: false, error: `صنف ${n}: تكلفة الوحدة غير صالحة.` };
      if (!it.product_id) {
        if (!String(it.name ?? "").trim()) return { ok: false, error: `صنف ${n}: اسم المنتج الجديد مطلوب.` };
        if (!(toNum(it.price) > 0)) return { ok: false, error: `صنف ${n}: سعر بيع المنتج الجديد مطلوب.` };
      }
      if (it.pricing.mode === "custom" && !(toNum(it.pricing.price) >= 0)) {
        return { ok: false, error: `صنف ${n}: سعر البيع المخصص غير صالح.` };
      }
    }
    const total = round2(items.reduce((s, it) => s + round2(toNum(it.quantity)) * round2(toNum(it.unit_cost)), 0));
    const paid = round2(toNum(input.paidNow));
    if (!(paid >= 0) || paid - total > 1e-9) {
      return { ok: false, error: "المدفوع الآن يجب أن يكون بين صفر وإجمالي الفاتورة." };
    }
    try {
      let out: ExecutePurchaseResult = { ok: false, error: "خطأ غير متوقع." };
      await runTx(async (tx) => {
        // 0. Idempotency: same key twice = same intent → return existing.
        const invRef = doc(db, "purchase_invoices", input.idempotencyKey);
        const invSnap = await tx.get(invRef);
        if (invSnap.exists()) {
          const d = invSnap.data() as Record<string, unknown>;
          out = {
            ok: true,
            duplicate: true,
            id: invRef.id,
            total: round2(toNum(d.total_amount)),
            paid: round2(toNum(d.paid_amount)),
            remaining: round2(toNum(d.remaining_amount)),
            fullyPaid: round2(toNum(d.remaining_amount)) <= 0,
          };
          return;
        }
        // 1. Fresh reads: existing products + cashbox.
        const existingIds = [...new Set(items.filter((i) => i.product_id).map((i) => i.product_id as string))];
        const prods = new Map<string, { stock: number; cost: number; price: number; name: string }>();
        for (const pid of existingIds) {
          const snap = await tx.get(doc(db, "products", pid));
          if (!snap.exists()) throw new Error(`VALIDATION:منتج غير موجود.`);
          const d = snap.data();
          prods.set(pid, {
            stock: toNum(d.stock_quantity),
            cost: toNum(d.cost_price),
            price: toNum(d.price),
            name: String(d.name || ""),
          });
        }
        const cRef = doc(db, "cashbox", "current");
        const cSnap = await tx.get(cRef);
        const cashReady = cSnap.exists();
        const bal = cashReady ? round2(Number(cSnap.data()?.balance || 0)) : 0;
        if (paid - bal > 1e-9) throw new Error("VALIDATION:المدفوع الآن يتجاوز رصيد الخزنة المتاح.");
        // 2. Per-item math (average + pricing decisions, re-derived fresh).
        const now = serverTimestamp();
        const byWho = by();
        const builtItems: PurchaseInvoiceItem[] = [];
        const productWrites: { id: string; isNew: boolean; name: string; stock: number; cost: number; price: number; movementId: string }[] = [];
        const invLogs: Record<string, unknown>[] = [];
        let seq = 0;
        for (const it of items) {
          const qty = round2(toNum(it.quantity));
          const unitCost = round2(toNum(it.unit_cost));
          if (it.product_id) {
            const cur = prods.get(it.product_id)!;
            const movementId = doc(collection(db, "inventory_transactions")).id;
            const applied = applyStockGroup(cur.stock, cur.cost, 0, [{ qty, cost: unitCost }]);
            const newAvg = applied.avg ?? unitCost;
            // Pricing policy (§2.3): re-derive; enforce explicit approved value.
            const { rate, proposed } = proposedSellingPrice(cur.cost, cur.price, newAvg);
            const hasApprovedProposal = it.pricing.mode === "proposed" ||
              (it.pricing.mode === "custom" && it.pricing.approvedProposed !== undefined);
            const approvedProposal = it.pricing.mode === "keep" ? undefined : it.pricing.approvedProposed;
            const proposalChanged = hasApprovedProposal && (
              proposed === null
                ? approvedProposal !== null
                : approvedProposal === null || approvedProposal === undefined || Math.abs(proposed - approvedProposal) > 0.005
            );
            if (proposalChanged) {
              throw Object.assign(new Error("STALE_PRICING"), {
                stale: { product_id: it.product_id, product_name: cur.name, newAvg, proposed, oldPrice: cur.price, oldCost: cur.cost, rate },
              });
            }
            let finalPrice: number | null = null;
            if (newAvg - cur.price > 1e-9) {
              if (it.pricing.mode === "keep") {
                throw Object.assign(new Error("STALE_PRICING"), {
                  stale: { product_id: it.product_id, product_name: cur.name, newAvg, proposed, oldPrice: cur.price, oldCost: cur.cost, rate },
                });
              }
              if (it.pricing.mode === "proposed") {
                if (proposed === null || rate === null) {
                  throw new Error("VALIDATION:لا توجد نسبة ربح قابلة للاشتقاق — أدخل سعر بيع يدويًا.");
                }
                finalPrice = proposed;
              } else {
                finalPrice = round2(toNum(it.pricing.price));
              }
            }
            builtItems.push({
              product_id: it.product_id,
              product_name: cur.name,
              quantity: qty,
              unit_cost: unitCost,
              line_total: round2(qty * unitCost),
            });
            productWrites.push({ id: it.product_id, isNew: false, name: cur.name, stock: applied.stock, cost: round2(newAvg), price: finalPrice ?? cur.price, movementId });
            invLogs.push({
              type: "purchase",
              product_id: it.product_id,
              product_name: cur.name,
              quantity: qty,
              direction: "in",
              unit_cost: unitCost,
              purchase_invoice_id: invRef.id,
              note: input.note ?? null,
              seq: seq++,
              id: movementId,
              created_by: byWho,
              created_at: now,
            });
          } else {
            // Brand-new product: stock starts 0 → average = batch cost.
            const price = round2(toNum(it.price));
            const thrRaw: unknown = it.threshold;
            const threshold = thrRaw === null || thrRaw === undefined || thrRaw === "" ? 5 : toNum(thrRaw);
            if (!(threshold >= 0)) throw new Error("VALIDATION:مؤشر النقص غير صالح.");
            const productId = doc(collection(db, "products")).id;
            const movementId = doc(collection(db, "inventory_transactions")).id;
            builtItems.push({
              product_id: productId,
              product_name: String(it.name ?? "").trim(),
              quantity: qty,
              unit_cost: unitCost,
              line_total: round2(qty * unitCost),
            });
            productWrites.push({ id: productId, isNew: true, name: String(it.name ?? "").trim(), stock: qty, cost: unitCost, price, movementId });
            (productWrites[productWrites.length - 1] as Record<string, unknown>).threshold = threshold;
            invLogs.push({
              type: "purchase",
              product_id: productId,
              product_name: String(it.name ?? "").trim(),
              quantity: qty,
              direction: "in",
              unit_cost: unitCost,
              purchase_invoice_id: invRef.id,
              note: input.note ?? null,
              seq: seq++,
              id: movementId,
              created_by: byWho,
              created_at: now,
            });
          }
        }
        const remaining = round2(total - paid);
        // 3. Writes.
        tx.set(invRef, {
          supplier_name: input.supplier_name?.trim() || null,
          supplier_ref: input.supplier_ref?.trim() || null,
          items: builtItems,
          product_ids: productWrites.map((product) => product.id),
          total_amount: total,
          paid_amount: paid,
          remaining_amount: remaining,
          payment_ids: [],
          note: input.note ?? null,
          created_by: byWho,
          created_at: now,
        });
        for (const w of productWrites) {
          if (w.isNew) {
            const ref = doc(db, "products", w.id);
            tx.set(ref, {
              name: w.name,
              price: w.price,
              cost_price: w.cost,
              count: null,
              stock_quantity: w.stock,
              low_stock_threshold: (w as Record<string, unknown>).threshold ?? 5,
              last_inventory_transaction_id: w.movementId,
              last_inventory_transaction_ids: [w.movementId],
            });
          } else {
            tx.update(doc(db, "products", w.id), {
              stock_quantity: w.stock,
              cost_price: w.cost,
              price: w.price,
              last_inventory_transaction_id: w.movementId,
              last_inventory_transaction_ids: [w.movementId],
            });
          }
        }
        for (const movement of invLogs) {
          const { id, ...data } = movement;
          tx.set(doc(db, "inventory_transactions", String(id)), data);
        }
        if (paid > 0) {
          tx.set(cRef, { balance: round2(bal - paid), updated_at: now }, { merge: true });
          tx.set(doc(collection(db, "cash_transactions")), {
            type: "inventory_purchase",
            direction: "out",
            amount: paid,
            purchase_invoice_id: invRef.id,
            note: input.note ?? null,
            created_by: byWho,
            created_at: now,
          });
        }
        out = { ok: true, id: invRef.id, total, paid, remaining, fullyPaid: remaining <= 0 };
      });
      await useProductsStore().fetchProducts();
      await useCashbox().fetchCashbox();
      return out;
    } catch (e) {
      if (e instanceof Error && e.message === "STALE_PRICING") {
        const stale = (e as Error & { stale?: ExecutePurchaseResult["stale"] }).stale;
        return { ok: false, error: "تغيّرت بيانات منتج أثناء الحفظ — راجع الأسعار المقترحة.", stale };
      }
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر حفظ فاتورة الشراء." };
    }
  }

  async function paySupplierInvoice(
    invoiceId: string,
    amount: number,
    note?: string | null,
    idempotencyKey?: string,
  ): Promise<{ ok: true; remaining: number; duplicate?: boolean } | { ok: false; error: string }> {
    const pay = round2(toNum(amount));
    if (!invoiceId) return { ok: false, error: "فاتورة غير صالحة." };
    if (!(pay > 0)) return { ok: false, error: "مبلغ السداد يجب أن يكون أكبر من صفر." };
    const key = idempotencyKey || `${invoiceId}:${Date.now()}:${Math.floor(Math.random() * 1e6)}`;
    try {
      let out: { ok: true; remaining: number; duplicate?: boolean } | { ok: false; error: string } = {
        ok: false,
        error: "خطأ غير متوقع.",
      };
      let isDuplicate = false;
      await runTx(async (tx) => {
        const payRef = doc(db, "supplier_payments", key);
        const paySnap = await tx.get(payRef);
        if (paySnap.exists()) {
          const existingPayment = paySnap.data();
          if (
            existingPayment.purchase_invoice_id !== invoiceId ||
            Math.abs(round2(toNum(existingPayment.amount)) - pay) > 0.005
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
        if (pay - remaining > 1e-9) throw new Error("VALIDATION:الدفعة تتجاوز باقي الفاتورة.");
        const cRef = doc(db, "cashbox", "current");
        const cSnap = await tx.get(cRef);
        const bal = cSnap.exists() ? round2(Number(cSnap.data()?.balance || 0)) : 0;
        if (pay - bal > 1e-9) throw new Error("VALIDATION:الدفعة تتجاوز رصيد الخزنة المتاح.");
        const now = serverTimestamp();
        const byWho = by();
        const paid = round2(toNum(d.paid_amount) + pay);
        const ids = [...((d.payment_ids as string[]) ?? []), key];
        tx.update(invRef, { paid_amount: paid, remaining_amount: round2(remaining - pay), payment_ids: ids });
        tx.set(payRef, {
          purchase_invoice_id: invoiceId,
          amount: pay,
          note: note ?? null,
          created_by: byWho,
          created_at: now,
        });
        tx.set(doc(collection(db, "cash_transactions")), {
          type: "supplier_payment",
          direction: "out",
          amount: pay,
          purchase_invoice_id: invoiceId,
          note: note ?? null,
          created_by: byWho,
          created_at: now,
        });
        tx.set(cRef, { balance: round2(bal - pay), updated_at: now }, { merge: true });
        out = { ok: true, remaining: round2(remaining - pay) };
      });
      if (isDuplicate) {
        // Already recorded: report current state instead of re-executing.
        const invSnap = await getDoc(doc(db, "purchase_invoices", invoiceId));
        const rem = invSnap.exists() ? round2(toNum((invSnap.data() as Record<string, unknown>).remaining_amount)) : 0;
        await useCashbox().fetchCashbox();
        return { ok: true, remaining: rem, duplicate: true };
      }
      await useCashbox().fetchCashbox();
      return out;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر تسجيل السداد." };
    }
  }

  async function fetchPurchaseInvoices(): Promise<PurchaseInvoice[]> {
    const list = (await readFrom<PurchaseInvoice>("purchase_invoices")) || [];
    return [...list].sort((a, b) => {
      const da = a.created_at && typeof a.created_at === "object" && "seconds" in (a.created_at as object)
        ? Number((a.created_at as { seconds: number }).seconds)
        : 0;
      const db2 = b.created_at && typeof b.created_at === "object" && "seconds" in (b.created_at as object)
        ? Number((b.created_at as { seconds: number }).seconds)
        : 0;
      return db2 - da;
    });
  }

  async function fetchSupplierPayments(invoiceId: string): Promise<SupplierPayment[]> {
    return readFrom<SupplierPayment>("supplier_payments", { purchase_invoice_id: invoiceId });
  }

  return { executePurchase, paySupplierInvoice, fetchPurchaseInvoices, fetchSupplierPayments };
});
