import { collection, doc, getDocs, limit as fsLimit, orderBy, query, where } from "firebase/firestore";
import type { InvoiceReturn, InvoiceReturnItem } from "~/types/finance";
import type { Invoice } from "~/types";
import { applyStockGroup, lineRefundValue, lineUnitFactor, netRatioOf, outstandingDebtOf, round2, round4, splitRefund, toNum } from "./finance";
import { summarizeInvoice, writeDebtSummary } from "./debtSummaries";

export interface ReturnLineInput {
  rowKey: string;
  quantity: number;
}

export interface ReturnRow {
  key: string;
  product_id: string;
  product_name: string;
  /** Representative selling price (first line of the group, display only). */
  unit_price: number;
  unit_cost: number;
  unit_id?: string;
  unit_name: string;
  unit_factor: number;
  /** Sold lines backing this cost group, in invoice order. */
  lines: { index: number; price: number; qty: number; returnedQty: number }[];
  soldQty: number;
  returnedQty: number;
  maxQty: number;
  qty: number;
}

const EPS = 1e-9;

export const useInvoiceReturns = defineStore("invoiceReturns", () => {
  const { db, serverTimestamp } = useFirebase();
  const authStore = useAuth();
  const { notify } = useAppToast();

  const byId = (i: ReturnRow) => i.key;

  /** All returns (bounded) — caller derives per-invoice aggregates. */
  async function fetchRecentReturns(max = 500): Promise<InvoiceReturn[]> {
    try {
      const q = query(collection(db, "invoice_returns"), orderBy("created_at", "desc"), fsLimit(max));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as InvoiceReturn);
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async function fetchReturnsForInvoice(invoice_id: string): Promise<InvoiceReturn[]> {
    try {
      const q = query(collection(db, "invoice_returns"), where("invoice_id", "==", invoice_id));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as InvoiceReturn);
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  /** Build returnable rows for an invoice: sold per (product,price) minus
   *  previously returned per product (F11/F12). Accepts return docs or a
   *  plain product->qty map (the transactional path uses the stored map). */
  function returnedMapOf(previous: InvoiceReturn[] | Record<string, number>): Map<string, number> {
    const m = new Map<string, number>();
    if (Array.isArray(previous)) {
      for (const r of previous) {
        for (const it of r.items ?? []) {
          m.set(it.product_id, round2((m.get(it.product_id) ?? 0) + Number(it.base_quantity ?? toNum(it.quantity) * Number(it.unit_factor || 1))));
        }
      }
    } else {
      for (const [k, v] of Object.entries(previous ?? {})) m.set(k, round2(toNum(v)));
    }
    return m;
  }
  function buildReturnRows(
    invoice: Invoice,
    previous: InvoiceReturn[] | Record<string, number>,
    aggregateReturned: Record<string, number> = {},
  ): ReturnRow[] {
    const returnedByProduct = Array.isArray(previous) ? new Map<string, number>() : returnedMapOf(previous);
    if (Array.isArray(previous)) for (const ret of previous) for (const item of ret.items ?? []) {
      returnedByProduct.set(item.product_id, round2((returnedByProduct.get(item.product_id) ?? 0) + toNum(item.quantity)));
    }
    if (!Array.isArray(previous)) for (const [productId, quantity] of Object.entries(aggregateReturned)) {
      returnedByProduct.set(productId, Math.max(returnedByProduct.get(productId) ?? 0, round2(toNum(quantity))));
    }
    const returnedByCost = new Map<string, number>();
    const returnedByLine = new Map<string, number>();
    if (Array.isArray(previous)) {
      for (const ret of previous) {
        for (const item of ret.items ?? []) {
          const costKey = `${item.product_id}||${round2(toNum(item.original_unit_cost))}||${item.unit_id ?? "legacy"}||${Number(item.unit_factor || 1)}`;
          returnedByCost.set(costKey, round2((returnedByCost.get(costKey) ?? 0) + toNum(item.quantity)));
          if (item.source_line_index !== undefined) {
            const lineKey = `${item.product_id}||${item.source_line_index}`;
            returnedByLine.set(lineKey, round2((returnedByLine.get(lineKey) ?? 0) + toNum(item.quantity)));
          }
        }
      }
    }
    // Group by (product, HISTORICAL cost) — never by selling price alone.
    const groups = new Map<string, ReturnRow>();
    for (const [index, l] of (invoice.products ?? []).entries()) {
      if (!l.product_id) continue;
      const cost = round4(toNum(l.product_cost_price));
      const price = round2(toNum(l.product_price));
      const factor = lineUnitFactor(l);
      const key = `${l.product_id}||${cost}||${l.unit_id ?? "legacy"}||${factor}`;
      const g = groups.get(key) ?? {
        key,
        product_id: l.product_id,
        product_name: l.product_name || "",
        unit_price: price,
        unit_cost: cost,
        unit_id: l.unit_id,
        unit_name: l.unit_name || "وحدة",
        unit_factor: factor,
        lines: [] as { index: number; price: number; qty: number; returnedQty: number }[],
        soldQty: 0,
        returnedQty: 0,
        maxQty: 0,
        qty: 0,
      };
      let returnedQty = returnedByLine.get(`${l.product_id}||${index}`) ?? 0;
      if (Array.isArray(previous) && returnedQty === 0) {
        const groupReturned = returnedByCost.get(key) ?? 0;
        const priorMatchingLines = g.lines.reduce((sum, line) => sum + line.returnedQty, 0);
        const unallocated = Math.max(0, round2(groupReturned - priorMatchingLines));
        const legacyPriceMatches = previous.reduce((sum, ret) => sum + (ret.items ?? [])
          .filter((item) => item.product_id === l.product_id && round2(toNum(item.original_unit_cost)) === cost &&
            round2(toNum(item.original_unit_price)) === price && item.source_line_index === undefined &&
            (item.unit_id ?? "legacy") === (l.unit_id ?? "legacy") && Number(item.unit_factor || 1) === factor)
          .reduce((itemSum, item) => itemSum + toNum(item.quantity), 0), 0);
        returnedQty = Math.min(toNum(l.product_quantity), legacyPriceMatches - priorMatchingLines);
        if (unallocated <= 0) returnedQty = 0;
      }
      g.lines.push({ index, price, qty: toNum(l.product_quantity), returnedQty: Math.max(0, round2(returnedQty)) });
      g.soldQty = round2(g.soldQty + toNum(l.product_quantity));
      groups.set(key, g);
    }
    const rows = [...groups.values()];
    const legacyReturned = new Map(returnedByProduct);
    if (Array.isArray(previous)) {
      for (const [productId, returned] of returnedByProduct) {
        const exactReturned = [...returnedByCost.entries()]
          .filter(([key]) => key.startsWith(`${productId}||`))
          .reduce((sum, [, qty]) => sum + qty, 0);
        legacyReturned.set(productId, Math.max(0, round2(returned - exactReturned)));
      }
    }
    const legacyAllocated = new Map<string, number>();
    for (const r of rows) {
      const lineReturned = r.lines.reduce((sum, line) => sum + line.returnedQty, 0);
      const knownGroupReturned = Array.isArray(previous) ? returnedByCost.get(r.key) ?? 0 : 0;
      const legacy = legacyReturned.get(r.product_id) ?? 0;
      const legacyUsed = legacyAllocated.get(r.product_id) ?? 0;
      const legacyTake = Math.min(Math.max(0, round2(legacy - legacyUsed)), Math.max(0, r.soldQty - lineReturned - knownGroupReturned));
      if (legacyTake > 0 && r.lines.length) {
        let remaining = legacyTake;
        for (const line of r.lines) {
          const take = Math.min(remaining, line.qty - line.returnedQty);
          line.returnedQty = round2(line.returnedQty + take);
          remaining = round2(remaining - take);
          if (remaining <= EPS) break;
        }
      }
      legacyAllocated.set(r.product_id, round2(legacyUsed + legacyTake));
      r.returnedQty = round2(r.lines.reduce((sum, line) => sum + line.returnedQty, 0));
      r.maxQty = Math.max(0, round2(r.soldQty - r.returnedQty));
    }
    return rows.filter((r) => r.soldQty > 0);
  }

  /** Atomic return (F14/F29): return doc + restock + logs + debt-first
   *  split + cash only for real refunds. */
  async function createReturn(
    invoice: Invoice,
    items: ReturnLineInput[],
    note?: string | null,
  ): Promise<{ ok: true; id: string; debtReduction: number; cashRefund: number } | { ok: false; error: string }> {
    if (!invoice.id) return { ok: false, error: "الفاتورة غير صالحة." };
    const wanted = items.filter((i) => i.rowKey && toNum(i.quantity) > 0);
    if (!wanted.length) return { ok: false, error: "حدد صنفاً واحداً على الأقل بكمية أكبر من صفر." };
    try {
      const priorReturnsSnapshot = await getDocs(query(collection(db, "invoice_returns"), where("invoice_id", "==", invoice.id)));
      const priorReturns = priorReturnsSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as InvoiceReturn);
      let returnId = "";
      let debtReduction = 0;
      let cashRefund = 0;
      await runTx(async (tx) => {
        // 1. Fresh invoice + previous returns (anti over-return).
        const invRef = doc(db, "invoices", invoice.id as string);
        const invSnap = await tx.get(invRef);
        if (!invSnap.exists()) throw new Error("VALIDATION:الفاتورة غير موجودة.");
        const fresh = { ...(invSnap.data() as object), id: invSnap.id } as Invoice;
        // Authoritative returned map lives on the invoice doc (transactional).
        const storedReturned = { ...((fresh.returned ?? {}) as Record<string, number>) };
        const returnedFromDocs = returnedMapOf(priorReturns);
        for (const [productId, storedQty] of Object.entries(storedReturned)) {
          if (Math.abs(toNum(storedQty) - (returnedFromDocs.get(productId) ?? 0)) > EPS) {
            throw new Error("VALIDATION:تغيّر سجل المرتجعات — أعد فتح الفاتورة ثم حاول مرة أخرى.");
          }
        }
        const returnedMap = { ...storedReturned };
        for (const [productId, returnedQty] of returnedFromDocs) {
          returnedMap[productId] = Math.max(toNum(returnedMap[productId]), returnedQty);
        }
        const rows = buildReturnRows(fresh, priorReturns, returnedMap);
        const ratio = netRatioOf(fresh);
        // 2. Validate per cost-group row, price from ORIGINAL sale LINES
        // (F12): a row's qty is spread over its own lines in order, so each
        // slice refunds at its exact historical selling price (F13).
        const retItems: InvoiceReturnItem[] = [];
        const byRowKey = new Map(rows.map((r) => [r.key, r]));
        const acceptedByRow = new Map<string, number>();
        for (const w of wanted) {
          const r = byRowKey.get(w.rowKey);
          if (!r) throw new Error("VALIDATION:صنف غير موجود بالفاتورة الأصلية.");
          const want = round2(toNum(w.quantity));
          const remainingForRow = round2(r.maxQty - (acceptedByRow.get(r.key) ?? 0));
          if (want - remainingForRow > EPS) {
            throw new Error(`VALIDATION:الكمية المطلوبة تتجاوز المتاح للإرجاع (${remainingForRow}).`);
          }
          acceptedByRow.set(r.key, round2((acceptedByRow.get(r.key) ?? 0) + want));
          let need = want;
          for (const ln of r.lines) {
            if (need <= EPS) break;
            const take = Math.min(need, ln.qty - ln.returnedQty);
            if (take <= EPS) continue;
            need = round2(need - take);
            retItems.push({
              product_id: r.product_id,
              product_name: r.product_name,
              quantity: take,
              unit_id: fresh.products[ln.index]?.unit_id ?? null,
              unit_name: fresh.products[ln.index]?.unit_name ?? null,
              unit_factor: lineUnitFactor(fresh.products[ln.index] ?? { unit_factor: 1 }),
              base_quantity: round2(take * lineUnitFactor(fresh.products[ln.index] ?? { unit_factor: 1 })),
              original_unit_price: ln.price,
              original_unit_cost: r.unit_cost,
              source_line_index: ln.index,
              refund_amount: lineRefundValue(ln.price, take, ratio),
            });
          }
        }
        if (!retItems.length) throw new Error("VALIDATION:لا توجد كميات صالحة للإرجاع.");
        const totalRefund = round2(retItems.reduce((s, i) => s + i.refund_amount, 0));
        // 3. Debt-first split against CURRENT remaining (shared legacy rule:
        //    legacy invoices without paid state count as paid → full cash).
        const remainingDebt = outstandingDebtOf(fresh);
        const split = splitRefund(totalRefund, remainingDebt);
        debtReduction = split.debtReduction;
        cashRefund = split.cashRefund;
        // 4. Stock + products must exist.
        const stocks = new Map<string, { stock: number; cost: number }>();
        for (const it of retItems) {
          if (stocks.has(it.product_id)) continue;
          const pSnap = await tx.get(doc(db, "products", it.product_id));
          if (!pSnap.exists()) throw new Error(`VALIDATION:المنتج ${it.product_name} غير موجود بالمخزون.`);
          stocks.set(it.product_id, {
            stock: toNum(pSnap.data().stock_quantity),
            cost: toNum(pSnap.data().cost_price),
          });
        }
        // 5. Cashbox only when real cash leaves.
        let cashBal = 0;
        let cashReady = true;
        if (cashRefund > 0) {
          const cSnap = await tx.get(doc(db, "cashbox", "current"));
          cashReady = cSnap.exists();
          if (!cashReady) throw new Error("VALIDATION:لا يمكن رد نقدية — الخزنة غير مهيأة بعد.");
          cashBal = round2(Number(cSnap.data()?.balance || 0));
          if (cashBal < cashRefund) throw new Error("VALIDATION:رصيد الخزنة لا يكفي للمبلغ المسترد نقداً.");
        }
        const now = serverTimestamp();
        const by = (authStore.currentUserKey as string) || null;
        // 6. Writes.
        const retRef = doc(collection(db, "invoice_returns"));
        returnId = retRef.id;
        tx.set(retRef, {
          invoice_id: invoice.id,
          customer_id: (fresh.customer_id as string) || null,
          items: retItems,
          total_refund: totalRefund,
          debt_reduction: debtReduction,
          cash_refund: cashRefund,
          note: note ?? null,
          created_by: by,
          created_at: now,
        });
        // Restored stock applies per product through the canonical helper
        // (same math replay uses); every slice keeps its own audit log.
        const restoredPids = [...new Set(retItems.map((it) => it.product_id))];
        let retSeq = 0;
        const lastMovementByProduct = new Map<string, string>();
        const movementIdsByProduct = new Map<string, string[]>();
        for (const it of retItems) {
          const movementRef = doc(collection(db, "inventory_transactions"));
          lastMovementByProduct.set(it.product_id, movementRef.id);
          const movementIds = movementIdsByProduct.get(it.product_id) ?? [];
          movementIds.push(movementRef.id);
          movementIdsByProduct.set(it.product_id, movementIds);
          tx.set(movementRef, {
            type: "refund",
            product_id: it.product_id,
            product_name: it.product_name,
            quantity: it.quantity,
            unit_id: it.unit_id ?? null,
            unit_name: it.unit_name ?? null,
            unit_factor: it.unit_factor ?? 1,
            base_quantity: it.base_quantity ?? it.quantity,
            direction: "in",
            unit_cost: it.original_unit_cost,
            invoice_id: invoice.id,
            return_id: returnId,
            note: null,
            seq: retSeq++,
            created_by: by,
            created_at: now,
          });
        }
        for (const pid of restoredPids) {
          const st = stocks.get(pid)!;
          const inflows = retItems
            .filter((it) => it.product_id === pid)
            .map((it) => ({ qty: Number(it.base_quantity ?? it.quantity), cost: it.original_unit_cost as number | null }));
          const applied = applyStockGroup(st.stock, st.cost, 0, inflows);
          tx.update(doc(db, "products", pid), {
            stock_quantity: applied.stock,
            cost_price: applied.avg ?? st.cost,
            last_inventory_transaction_id: lastMovementByProduct.get(pid),
            last_inventory_transaction_ids: movementIdsByProduct.get(pid) ?? [],
          });
        }
        const mergedReturned: Record<string, number> = { ...returnedMap };
        for (const it of retItems) {
          mergedReturned[it.product_id] = round2((mergedReturned[it.product_id] ?? 0) + Number(it.base_quantity ?? it.quantity));
        }
        tx.update(invRef, {
          remaining: round2(remainingDebt - debtReduction),
          returned: mergedReturned,
        });
        writeDebtSummary(tx, db, {
          invoice_id: invoice.id as string,
          customer_id: (fresh.customer_id as string) || null,
          customer_name: (fresh.customer_name as string | null) ?? null,
          customer_phone: (fresh.customer_phone as string | number | null) ?? null,
          date: (fresh.date as unknown) ?? null,
          ...summarizeInvoice({ ...fresh, remaining: round2(remainingDebt - debtReduction) }),
        });
        if (cashRefund > 0) {
          const cRef = doc(db, "cashbox", "current");
          tx.set(cRef, { balance: round2(cashBal - cashRefund), updated_at: now }, { merge: true });
          tx.set(doc(collection(db, "cash_transactions")), {
            type: "invoice_refund",
            direction: "out",
            amount: cashRefund,
            invoice_id: invoice.id,
            return_id: returnId,
            reference_type: "return",
            reference_id: returnId,
            reference_label: `Invoice Return - ${String(fresh.customer_name || "Customer")}`,
            note: note ?? null,
            created_by: by,
            created_at: now,
          });
        }
      });
      return { ok: true, id: returnId, debtReduction, cashRefund };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  return { byId, fetchRecentReturns, fetchReturnsForInvoice, buildReturnRows, createReturn };
});
