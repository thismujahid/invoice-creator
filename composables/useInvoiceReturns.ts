import { collection, doc, getDocs, limit as fsLimit, orderBy, query, where } from "firebase/firestore";
import type { InvoiceReturn, InvoiceReturnItem } from "~/types/finance";
import type { Invoice } from "~/types";
import { lineRefundValue, movingAverageCost, netRatioOf, outstandingDebtOf, round2, splitRefund, toNum } from "./finance";
import { summarizeInvoice, writeDebtSummary } from "./debtSummaries";

export interface ReturnLineInput {
  product_id: string;
  quantity: number;
}

export interface ReturnRow {
  key: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  unit_cost: number;
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
          m.set(it.product_id, round2((m.get(it.product_id) ?? 0) + toNum(it.quantity)));
        }
      }
    } else {
      for (const [k, v] of Object.entries(previous ?? {})) m.set(k, round2(toNum(v)));
    }
    return m;
  }
  function buildReturnRows(invoice: Invoice, previous: InvoiceReturn[] | Record<string, number>): ReturnRow[] {
    const returnedByProduct = returnedMapOf(previous);
    const groups = new Map<string, ReturnRow>();
    for (const l of invoice.products ?? []) {
      if (!l.product_id) continue;
      const price = round2(toNum(l.product_price));
      const key = `${l.product_id}||${price}`;
      const g = groups.get(key) ?? {
        key,
        product_id: l.product_id,
        product_name: l.product_name || "",
        unit_price: price,
        unit_cost: round2(toNum(l.product_cost_price)),
        soldQty: 0,
        returnedQty: 0,
        maxQty: 0,
        qty: 0,
      };
      g.soldQty = round2(g.soldQty + toNum(l.product_quantity));
      groups.set(key, g);
    }
    // Cap: product-level (sold − returned) distributed across its price rows.
    const usedByProduct = new Map<string, number>();
    const rows = [...groups.values()];
    for (const r of rows) {
      const returned = returnedByProduct.get(r.product_id) ?? 0;
      const productMax = Math.max(0, round2(totalSoldFor(rows, r.product_id) - returned - (usedByProduct.get(r.product_id) ?? 0)));
      r.returnedQty = round2(Math.min(returned, totalSoldFor(rows, r.product_id)));
      r.maxQty = round2(Math.min(r.soldQty, productMax));
      usedByProduct.set(r.product_id, round2((usedByProduct.get(r.product_id) ?? 0) + r.maxQty));
    }
    return rows.filter((r) => r.soldQty > 0);
  }

  function totalSoldFor(rows: ReturnRow[], product_id: string): number {
    return round2(rows.filter((r) => r.product_id === product_id).reduce((s, r) => s + r.soldQty, 0));
  }

  /** Atomic return (F14/F29): return doc + restock + logs + debt-first
   *  split + cash only for real refunds. */
  async function createReturn(
    invoice: Invoice,
    items: ReturnLineInput[],
    note?: string | null,
  ): Promise<{ ok: true; id: string; debtReduction: number; cashRefund: number } | { ok: false; error: string }> {
    if (!invoice.id) return { ok: false, error: "الفاتورة غير صالحة." };
    const wanted = items.filter((i) => i.product_id && toNum(i.quantity) > 0);
    if (!wanted.length) return { ok: false, error: "حدد صنفاً واحداً على الأقل بكمية أكبر من صفر." };
    try {
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
        const returnedMap: Record<string, number> = { ...((fresh.returned ?? {}) as Record<string, number>) };
        const rows = buildReturnRows(fresh, returnedMap);
        const ratio = netRatioOf(fresh);
        // 2. Validate + price from ORIGINAL sale lines (F12), discount-aware (F13).
        const retItems: InvoiceReturnItem[] = [];
        for (const w of wanted) {
          const candidates = rows.filter((r) => r.product_id === w.product_id);
          if (!candidates.length) throw new Error("VALIDATION:صنف غير موجود بالفاتورة الأصلية.");
          let need = round2(toNum(w.quantity));
          const productMax = round2(candidates.reduce((s, r) => s + r.maxQty, 0));
          if (need - productMax > EPS) {
            throw new Error(`VALIDATION:الكمية المطلوبة تتجاوز المتاح للإرجاع (${productMax}).`);
          }
          for (const r of candidates) {
            if (need <= EPS) break;
            const take = Math.min(need, r.maxQty);
            if (take <= EPS) continue;
            need = round2(need - take);
            retItems.push({
              product_id: r.product_id,
              product_name: r.product_name,
              quantity: take,
              original_unit_price: r.unit_price,
              original_unit_cost: r.unit_cost,
              refund_amount: lineRefundValue(r.unit_price, take, ratio),
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
        for (const it of retItems) {
          const st = stocks.get(it.product_id)!;
          // Restored units re-enter at their ORIGINAL invoice cost (§5).
          const newCost = round2(movingAverageCost(st.stock, st.cost, it.quantity, it.original_unit_cost));
          st.stock = round2(st.stock + it.quantity);
          st.cost = newCost;
          stocks.set(it.product_id, st);
          tx.update(doc(db, "products", it.product_id), {
            stock_quantity: st.stock,
            cost_price: st.cost,
          });
          tx.set(doc(collection(db, "inventory_transactions")), {
            type: "refund",
            product_id: it.product_id,
            product_name: it.product_name,
            quantity: it.quantity,
            direction: "in",
            unit_cost: it.original_unit_cost,
            invoice_id: invoice.id,
            return_id: returnId,
            note: null,
            created_by: by,
            created_at: now,
          });
        }
        const mergedReturned: Record<string, number> = { ...returnedMap };
        for (const it of retItems) {
          mergedReturned[it.product_id] = round2((mergedReturned[it.product_id] ?? 0) + it.quantity);
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
