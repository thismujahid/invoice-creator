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
  aggregatePurchaseByProduct,
  applyStockGroup,
  estimatePurchaseOps,
  proposedSellingPrice,
  purchaseLineBaseCost,
  purchaseLineBaseQuantity,
  purchasePreviewAverage,
  purchaseUnitProposals,
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
  /** Stock alert threshold for new products (default 5). */
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
      const factorKey = Number(item.unit_factor ?? 1) > 0 ? Number(item.unit_factor) : 1;
      const key = item.product_id
        ? `id:${item.product_id}|unit:${String(item.unit_id ?? "")}|f:${factorKey}`
        : `name:${String(item.name ?? "").trim().toLocaleLowerCase()}`;
      if (seenItems.has(key)) return { ok: false, error: `الصنف رقم ${index + 1} مكرر في الفاتورة.` };
      seenItems.add(key);
    }
    // Client-side pre-validation (server re-validates inside txn).
    for (const [idx, it] of items.entries()) {
      const n = idx + 1;
      if (it.product_id && typeof it.product_id !== "string") return { ok: false, error: `صنف ${n}: معرّف غير صالح.` };
      if (!(toNum(it.quantity) > 0)) return { ok: false, error: `صنف ${n}: الكمية يجب أن تكون أكبر من صفر.` };
      if (!Number.isInteger(toNum(it.quantity))) return { ok: false, error: `صنف ${n}: الكمية يجب أن تكون رقمًا صحيحًا.` };
      if (!(toNum(it.unit_cost) >= 0) || !Number.isFinite(toNum(it.unit_cost))) return { ok: false, error: `صنف ${n}: تكلفة الوحدة غير صالحة.` };
      if (!it.product_id) {
        if (!String(it.name ?? "").trim()) return { ok: false, error: `صنف ${n}: اسم المنتج الجديد مطلوب.` };
        if (!(toNum(it.price) > 0)) return { ok: false, error: `صنف ${n}: سعر بيع المنتج الجديد مطلوب.` };
      }
      if (it.pricing.mode === "custom" && !(toNum(it.pricing.price) >= 0)) {
        return { ok: false, error: `صنف ${n}: سعر البيع المخصص غير صالح.` };
      }
    }
    const total = round2(items.reduce((s, it) => s + round2(toNum(it.quantity) * round4(toNum(it.unit_cost))), 0));
    const paid = round2(toNum(input.paidNow));
    if (!(paid >= 0)) return { ok: false, error: "المدفوع الآن يجب ألا يكون سالبًا." };
    if (paid > total && !input.supplier_id) return { ok: false, error: "اختر المورد لتسجيل المبلغ الزائد كسلفة مستحقة لنا." };
    const { applied: invoicePaid, advance } = allocateSupplierCash(total, paid);
    try {
      let out: ExecutePurchaseResult = { ok: false, error: "خطأ غير متوقع." };
      let cachedProductWrites: Product[] = [];
      let cashBalanceAfterPurchase: number | null = null;
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
            advance: round2(toNum(d.advance_amount)),
          };
          return;
        }
        // 1. Fresh reads: existing products + cashbox.
        const existingIds = [...new Set(items.filter((i) => i.product_id).map((i) => i.product_id as string))];
        const prods = new Map<string, { stock: number; cost: number; price: number; name: string; units: ProductUnit[]; baseUnitId: string | null; baseUnitName: string | null }>();
        for (const pid of existingIds) {
          const snap = await tx.get(doc(db, "products", pid));
          if (!snap.exists()) throw new Error(`VALIDATION:منتج غير موجود.`);
          const d = snap.data();
          prods.set(pid, {
            stock: toNum(d.stock_quantity),
            cost: toNum(d.cost_price),
            price: toNum(d.price),
            name: String(d.name || ""),
            units: Array.isArray(d.units) ? d.units as ProductUnit[] : [],
            baseUnitId: typeof d.base_unit_id === "string" ? d.base_unit_id : null,
            baseUnitName: typeof d.base_unit_name === "string" ? d.base_unit_name : null,
          });
        }
        const cRef = doc(db, "cashbox", "current");
        const cSnap = await tx.get(cRef);
        const cashReady = cSnap.exists();
        const bal = cashReady ? round2(Number(cSnap.data()?.balance || 0)) : 0;
        if (paid > 0 && !cashReady) throw new Error("VALIDATION:لا يمكن الدفع قبل تهيئة الخزنة. هيّئ الخزنة أولاً.");
        if (paid - bal > 1e-9) throw new Error("VALIDATION:المدفوع الآن يتجاوز رصيد الخزنة المتاح.");
        if (paid > 0) cashBalanceAfterPurchase = round2(bal - paid);
        // 2. Per-item math (average + pricing decisions, re-derived fresh).
        // Canonical purchase math lives in composables/finance (same helpers
        // the preview uses): baseQty = qty × factor, baseCost = unitCost ÷
        // factor, weighted average on BASE terms only. Multi-unit lines of one
        // product are aggregated before averaging (deterministic, order-free).
        const now = serverTimestamp();
        const byWho = by();
        const builtItems: PurchaseInvoiceItem[] = [];
        const productWrites: { id: string; isNew: boolean; name: string; stock: number; cost: number; price: number; movementId: string; movementIds: string[]; units?: ProductUnit[]; base_unit_id?: string; base_unit_name?: string; low_stock_threshold?: number }[] = [];
        const invLogs: Record<string, unknown>[] = [];
        let seq = 0;
        // Normalize every row first (shared with preview).
        const normalized = items.map((it) => {
          const qty = round2(toNum(it.quantity));
          const unitCost = round4(toNum(it.unit_cost));
          const factor = Number(it.unit_factor ?? 1);
          if (!(Number.isFinite(factor) && factor > 0)) throw new Error("VALIDATION:معامل تحويل الوحدة غير صالح.");
          const baseQty = purchaseLineBaseQuantity(qty, factor);
          const baseCost = purchaseLineBaseCost(unitCost, factor);
          return { it, qty, unitCost, factor, baseQty, baseCost, lineTotal: round2(qty * unitCost) };
        });
        // Aggregate existing-product lines per product for the average.
        const aggregate = aggregatePurchaseByProduct(
          normalized.filter((n) => n.it.product_id).map((n) => ({ product_id: n.it.product_id as string, baseQty: n.baseQty, lineTotal: n.baseQty * n.baseCost })),
        );
        const newAvgByProduct = new Map<string, { newAvg: number; stock: number }>();
        for (const [pid, agg] of aggregate) {
          const cur = prods.get(pid)!;
          const applied = applyStockGroup(cur.stock, cur.cost, 0, agg.baseQty > 0 ? [{ qty: agg.baseQty, cost: agg.baseCost }] : []);
          newAvgByProduct.set(pid, { newAvg: applied.avg ?? agg.baseCost, stock: applied.stock });
        }
        // Pricing decisions must be consistent across lines of one product.
        const pricingByProduct = new Map<string, string>();
        for (const n of normalized) {
          if (!n.it.product_id) continue;
          const key = JSON.stringify(n.it.pricing);
          const prev = pricingByProduct.get(n.it.product_id);
          if (prev !== undefined && prev !== key) {
            throw new Error("VALIDATION:قرار سعر البيع يجب أن يكون موحدًا لكل سطور نفس المنتج.");
          }
          pricingByProduct.set(n.it.product_id, key);
        }
        const finalizedByProduct = new Map<string, { finalPrice: number | null; proposed: number | null; rate: number | null; newAvg: number }>();
        for (const [pid, { newAvg }] of newAvgByProduct) {
          const cur = prods.get(pid)!;
          const rep = normalized.find((n) => n.it.product_id === pid)!.it;
          const { rate, proposed } = proposedSellingPrice(cur.cost, cur.price, newAvg);
          const hasApprovedProposal = rep.pricing.mode === "proposed" ||
            (rep.pricing.mode === "custom" && rep.pricing.approvedProposed !== undefined);
          const approvedProposal = rep.pricing.mode === "keep" ? undefined : rep.pricing.approvedProposed;
          const proposalChanged = hasApprovedProposal && (
            proposed === null
              ? approvedProposal !== null
              : approvedProposal === null || approvedProposal === undefined || Math.abs(proposed - approvedProposal) > 0.005
          );
          if (proposalChanged) {
            throw Object.assign(new Error("STALE_PRICING"), {
              stale: { product_id: pid, product_name: cur.name, newAvg, proposed, oldPrice: cur.price, oldCost: cur.cost, rate },
            });
          }
          let finalPrice: number | null = null;
          if (newAvg - cur.price > 1e-9) {
            if (rep.pricing.mode === "keep") {
              throw Object.assign(new Error("STALE_PRICING"), {
                stale: { product_id: pid, product_name: cur.name, newAvg, proposed, oldPrice: cur.price, oldCost: cur.cost, rate },
              });
            }
            if (rep.pricing.mode === "proposed") {
              if (proposed === null || rate === null) {
                throw new Error("VALIDATION:لا توجد نسبة ربح قابلة للاشتقاق — أدخل سعر بيع يدويًا.");
              }
              finalPrice = round2(rep.pricing.price ?? proposed);
            } else {
              finalPrice = round2(toNum(rep.pricing.price));
            }
          }
          finalizedByProduct.set(pid, { finalPrice, proposed, rate, newAvg });
        }
        for (const n of normalized) {
          const { it, qty, unitCost, factor, baseQty, baseCost } = n;
          if (it.product_id) {
            const cur = prods.get(it.product_id)!;
            const configuredUnit = cur.units.find((unit) => unit.id === it.unit_id);
            if (cur.units.length && (!configuredUnit || configuredUnit.can_purchase === false || Math.abs(Number(configuredUnit.factor) - factor) > 1e-9)) {
              throw new Error("VALIDATION:تغيرت وحدة المنتج — أعد مراجعة الفاتورة.");
            }
            if (!cur.units.length && Math.abs(factor - 1) > 1e-9) throw new Error("VALIDATION:المنتج القديم يدعم وحدة مخزون واحدة حتى يتم إعداد وحداته.");
            const movementId = doc(collection(db, "inventory_transactions")).id;
            const { newAvg } = newAvgByProduct.get(it.product_id)!;
            const { finalPrice } = finalizedByProduct.get(it.product_id)!;
            builtItems.push({
              product_id: it.product_id,
              product_name: cur.name,
              quantity: qty,
              unit_cost: unitCost,
              unit_id: it.unit_id ?? null,
              unit_name: it.unit_name ?? configuredUnit?.name ?? cur.baseUnitName ?? "وحدة",
              unit_factor: factor,
              base_quantity: baseQty,
              base_unit_cost: round4(baseCost),
              line_total: round2(qty * unitCost),
            });
            invLogs.push({
              type: "purchase",
              product_id: it.product_id,
              product_name: cur.name,
              quantity: qty,
              unit_id: it.unit_id ?? null,
              unit_name: it.unit_name ?? cur.baseUnitName ?? "وحدة",
              unit_factor: factor,
              base_quantity: baseQty,
              direction: "in",
              unit_cost: baseCost,
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
              unit_id: it.unit_id ?? null,
              unit_name: it.unit_name ?? it.base_unit_name ?? "وحدة",
              unit_factor: factor,
              base_quantity: baseQty,
              base_unit_cost: round4(baseCost),
              line_total: round2(qty * unitCost),
            });
            productWrites.push({
              id: productId,
              isNew: true,
              name: String(it.name ?? "").trim(),
              stock: baseQty,
              cost: round4(baseCost),
              price,
              movementId,
              movementIds: [movementId],
              units: it.units?.length
                ? it.units.map((entry) => ({
                  ...entry,
                  purchase_price:
                    entry.purchase_price ??
                    (entry.id === (it.unit_id ?? it.base_unit_id) ? round4(unitCost) : null),
                }))
                : [{ id: it.base_unit_id || "base", name: it.base_unit_name || "وحدة", factor: 1, selling_price: price, purchase_price: round4(baseCost), is_base: true }],
              base_unit_id: it.base_unit_id || "base",
              base_unit_name: it.base_unit_name?.trim() || "وحدة",
              low_stock_threshold: threshold,
            });
            invLogs.push({
              type: "purchase",
              product_id: productId,
              product_name: String(it.name ?? "").trim(),
              quantity: qty,
              unit_id: it.unit_id ?? null,
              unit_name: it.unit_name ?? it.base_unit_name ?? "وحدة",
              unit_factor: factor,
              base_quantity: baseQty,
              direction: "in",
              unit_cost: baseCost,
              purchase_invoice_id: invRef.id,
              note: input.note ?? null,
              seq: seq++,
              id: movementId,
              created_by: byWho,
              created_at: now,
            });
          }
        }
        // Aggregate existing-product writes: one stock/cost update per product,
        // proposals for EVERY sellable unit (each preserves its own margin).
        for (const [pid, { newAvg, stock }] of newAvgByProduct) {
          const cur = prods.get(pid)!;
          const { finalPrice } = finalizedByProduct.get(pid)!;
          const proposals = purchaseUnitProposals(
            { cost_price: cur.cost, price: cur.price, units: cur.units, base_unit_id: cur.baseUnitId } as unknown as import("~/types").Product,
            newAvg,
          );
          const proposalByUnit = new Map(proposals.map((p) => [p.unitId, p.proposed]));
          const purchasedCosts = new Map<string, number>();
          for (const n of normalized) {
            if (n.it.product_id !== pid) continue;
            const uid = n.it.unit_id ?? cur.units.find((u) => u.id === n.it.unit_id)?.id ?? null;
            if (uid) purchasedCosts.set(uid, n.unitCost);
          }
          const baseId = cur.baseUnitId || cur.units.find((entry) => entry.is_base)?.id;
          const updatedUnits = cur.units.map((unit) => {
            let next = purchasedCosts.has(unit.id) ? { ...unit, purchase_price: purchasedCosts.get(unit.id)! } : unit;
            if (finalPrice !== null && unit.can_sell !== false) {
              if (unit.id === baseId) {
                next = { ...next, selling_price: finalPrice };
              } else {
                const prop = proposalByUnit.get(unit.id);
                if (prop !== null && prop !== undefined) next = { ...next, selling_price: prop };
              }
            }
            return next;
          });
          const movementIds = invLogs.filter((l) => (l as { product_id?: string }).product_id === pid).map((l) => String((l as { id?: string }).id));
          productWrites.push({
            id: pid,
            isNew: false,
            name: cur.name,
            stock,
            cost: round4(newAvg),
            price: finalPrice ?? cur.price,
            movementId: movementIds[0] ?? doc(collection(db, "inventory_transactions")).id,
            movementIds,
            units: updatedUnits,
          });
        }
        const remaining = round2(total - invoicePaid);
        const status = deriveSupplierInvoiceStatus(invoicePaid, remaining);
        // 3. Writes.
        tx.set(invRef, {
          supplier_name: input.supplier_name?.trim() || null,
          supplier_id: input.supplier_id ?? null,
          supplier_ref: input.supplier_ref?.trim() || null,
          invoice_number: input.invoice_number?.trim() || null,
          source: input.source ?? "manual",
          pinned: false,
          items: builtItems,
          product_ids: productWrites.map((product) => product.id),
          total_amount: total,
          paid_amount: invoicePaid,
          advance_amount: advance,
          remaining_amount: remaining,
          status,
          payment_ids: [],
          note: input.note ?? null,
          created_by: byWho,
          created_at: now,
        });
        writeSupplierSummaryDelta(tx, db, { supplier_id: input.supplier_id, supplier_name: input.supplier_name }, {
          invoice_count: 1,
          total_purchases: total,
          outstanding_payable: remaining,
          advance_receivable: advance,
        });
        if (advance > 0 && input.supplier_id) {
          tx.set(doc(db, "supplier_advances", invRef.id), {
            supplier_id: input.supplier_id,
            supplier_name: input.supplier_name?.trim() || "مورد غير مسمى",
            purchase_invoice_id: invRef.id,
            amount: advance,
            remaining_amount: advance,
            created_by: byWho,
            created_at: now,
          });
        }
        for (const w of productWrites) {
          if (w.isNew) {
            const ref = doc(db, "products", w.id);
            tx.set(ref, {
              name: w.name,
              price: w.price,
              cost_price: w.cost,
              stock_quantity: w.stock,
              base_unit_id: items.find((i) => !i.product_id && String(i.name ?? "").trim() === w.name)?.base_unit_id || "base",
              base_unit_name: items.find((i) => !i.product_id && String(i.name ?? "").trim() === w.name)?.base_unit_name?.trim() || "وحدة",
              units: w.units,
              low_stock_threshold: w.low_stock_threshold ?? 5,
              last_inventory_transaction_id: w.movementId,
              last_inventory_transaction_ids: w.movementIds?.length ? w.movementIds : [w.movementId],
              last_purchase_invoice_id: invRef.id,
            });
          } else {
            tx.update(doc(db, "products", w.id), {
              stock_quantity: w.stock,
              cost_price: w.cost,
              price: w.price,
              ...("units" in w ? { units: w.units } : {}),
              last_inventory_transaction_id: w.movementId,
              last_inventory_transaction_ids: w.movementIds?.length ? w.movementIds : [w.movementId],
              last_purchase_invoice_id: invRef.id,
            });
          }
        }
        cachedProductWrites = productWrites.map((w) => ({
          id: w.id,
          name: w.name,
          price: w.price,
          cost_price: w.cost,
          stock_quantity: w.stock,
          ...(w.units ? { units: w.units } : {}),
          ...(w.base_unit_id ? { base_unit_id: w.base_unit_id } : {}),
          ...(w.base_unit_name ? { base_unit_name: w.base_unit_name } : {}),
          ...(w.low_stock_threshold !== undefined ? { low_stock_threshold: w.low_stock_threshold } : {}),
        }));
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
            reference_type: "supplier_invoice",
            reference_id: invRef.id,
            reference_label: `فاتورة توريد من ${input.supplier_name?.trim() || "مورد غير مسمى"}`,
            note: input.note ?? null,
            created_by: byWho,
            created_at: now,
          });
        }
        out = { ok: true, id: invRef.id, total, paid: invoicePaid, remaining, fullyPaid: remaining <= 0, advance };
      });
      const productsStore = useProductsStore();
      for (const product of cachedProductWrites) productsStore.upsertCached(product);
      if (cashBalanceAfterPurchase !== null) useCashbox().balance = cashBalanceAfterPurchase;
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
          tx.set(doc(db, "supplier_payments", input.key), { purchase_invoice_id: input.invoiceId, advance_id: input.advanceId, amount, cash_amount: 0, note: "تسوية من سلفة المورد", created_by: by(), created_at: now });
        }
        if (cashRef && cashSnap) {
          nextCash = round2(toNum(cashSnap.data()?.balance) + amount);
          tx.set(cashRef, { balance: nextCash, updated_at: now }, { merge: true });
          tx.set(doc(db, "cash_transactions", input.key), { type: "supplier_advance_refund", direction: "in", amount, reference_type: "supplier_invoice", reference_id: advance.purchase_invoice_id, reference_label: `استرداد سلفة من ${String(advance.supplier_name || "مورد")}`, purchase_invoice_id: advance.purchase_invoice_id, created_by: by(), created_at: now });
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
