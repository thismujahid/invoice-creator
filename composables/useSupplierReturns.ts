import { collection, doc, getDocs, query, where, type DocumentSnapshot } from "firebase/firestore";
import type { PurchaseInvoice, SupplierReturn, SupplierReturnItem } from "~/types/finance";
import { deriveSupplierInvoiceStatus } from "~/types/finance";
import { toDateSafe } from "~/types";
import { round2, splitSupplierReturn, toNum } from "./finance";
import { writeSupplierSummaryDelta } from "./performanceSummaries";

export interface SupplierReturnSelection {
  line_index: number;
  quantity: number;
}

export const useSupplierReturns = defineStore("supplierReturns", () => {
  const { db, serverTimestamp } = useFirebase();
  const auth = useAuth();

  async function fetchForInvoice(invoiceId: string): Promise<SupplierReturn[]> {
    const snapshot = await getDocs(query(collection(db, "supplier_returns"), where("purchase_invoice_id", "==", invoiceId)));
    const records = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as object) }) as SupplierReturn);
    for (let index = 0; index < records.length; index += 30) {
      const ids = records.slice(index, index + 30).map((record) => record.id!);
      const cash = await getDocs(query(collection(db, "cash_transactions"), where("return_id", "in", ids)));
      for (const movement of cash.docs) {
        const data = movement.data();
        if (data.type !== "supplier_advance_refund" || data.direction !== "in") continue;
        const record = records.find((item) => item.id === data.return_id);
        if (record) record.cash_received = round2(toNum(record.cash_received) + toNum(data.amount));
      }
    }
    return records.sort((a, b) => (toDateSafe(b.created_at)?.getTime() ?? 0) - (toDateSafe(a.created_at)?.getTime() ?? 0));
  }

  async function createReturn(input: {
    id: string;
    invoice_id: string;
    items: SupplierReturnSelection[];
    supplier_id?: string | null;
    note?: string | null;
  }): Promise<{ ok: true; total: number; payableReduction: number; receivable: number; duplicate?: boolean } | { ok: false; error: string }> {
    if (!input.id || !input.invoice_id || !input.items.length || input.items.length > 50) return { ok: false, error: "حدد أصناف المرتجع." };
    const selected = new Map<number, number>();
    for (const item of input.items) {
      if (!Number.isInteger(item.line_index) || !Number.isFinite(item.quantity) || item.quantity <= 0 || selected.has(item.line_index)) return { ok: false, error: "كميات المرتجع غير صالحة." };
      selected.set(item.line_index, item.quantity);
    }
    const fingerprint = JSON.stringify({ invoice_id: input.invoice_id, items: [...selected].sort(([a], [b]) => a - b), supplier_id: input.supplier_id ?? null, note: input.note ?? null });
    try {
      let result: { ok: true; total: number; payableReduction: number; receivable: number; duplicate?: boolean } = { ok: true, total: 0, payableReduction: 0, receivable: 0 };
      await runTx(async (tx) => {
        const returnRef = doc(db, "supplier_returns", input.id);
        const previous = await tx.get(returnRef);
        if (previous.exists()) {
          const saved = previous.data() as SupplierReturn;
          if (saved.request_fingerprint !== fingerprint) throw new Error("VALIDATION:مفتاح المرتجع مستخدم لعملية أخرى.");
          result = { ok: true, total: saved.total_return, payableReduction: saved.payable_reduction, receivable: saved.receivable_amount, duplicate: true };
          return;
        }
        const invoiceRef = doc(db, "purchase_invoices", input.invoice_id);
        const invoiceSnap = await tx.get(invoiceRef);
        if (!invoiceSnap.exists()) throw new Error("VALIDATION:فاتورة المورد غير موجودة.");
        const invoice = invoiceSnap.data() as PurchaseInvoice;
        const returned = { ...(invoice.returned_quantities ?? {}) };
        const items: SupplierReturnItem[] = [];
        const byUnit = new Map<string, number>();
        const productSnapshots = new Map<string, DocumentSnapshot>();
        for (const [index, quantity] of selected) {
          const line = invoice.items?.[index];
          if (!line?.product_id || quantity > toNum(line.quantity) - toNum(returned[String(index)])) throw new Error("VALIDATION:كمية المرتجع تتجاوز المتاح في الفاتورة.");
          const snapshot = productSnapshots.get(line.product_id) ?? await tx.get(doc(db, "products", line.product_id));
          productSnapshots.set(line.product_id, snapshot);
          const unit = snapshot.data()?.units?.find((entry: { id?: string }) => entry.id === line.unit_id);
          if (!unit) throw new Error("VALIDATION:وحدة الصنف لم تعد موجودة.");
          if (unit.allows_fractional !== true && !Number.isInteger(quantity)) throw new Error("VALIDATION:هذه الوحدة لا تقبل كميات كسرية.");
          const factor = 1;
          const baseQuantity = round4(quantity);
          const amount = round2(quantity * toNum(line.unit_cost));
          items.push({ line_index: index, product_id: line.product_id, product_name: line.product_name, quantity, unit_name: line.unit_name ?? null, unit_factor: factor, base_quantity: baseQuantity, unit_cost: toNum(line.unit_cost), amount });
          const unitKey = `${line.product_id}||${line.unit_id ?? ""}`;
          byUnit.set(unitKey, round4((byUnit.get(unitKey) ?? 0) + quantity));
          returned[String(index)] = round2(toNum(returned[String(index)]) + quantity);
        }
        const total = round2(items.reduce((sum, item) => sum + item.amount, 0));
        const { payableReduction, receivable } = splitSupplierReturn(total, invoice.remaining_amount);
        const supplierId = invoice.supplier_id || input.supplier_id || null;
        if (receivable > 0 && !supplierId) throw new Error("VALIDATION:اختر المورد لتسجيل الرصيد المستحق لنا.");
        const supplierSnap = supplierId ? await tx.get(doc(db, "suppliers", supplierId)) : null;
        const summarySnap = supplierId ? await tx.get(doc(db, "supplier_summaries", supplierId)) : null;
        if (supplierId && !supplierSnap?.exists()) throw new Error("VALIDATION:المورد المحدد غير موجود.");
        if (invoice.supplier_id && input.supplier_id && invoice.supplier_id !== input.supplier_id) throw new Error("VALIDATION:المورد لا يطابق الفاتورة.");
        for (const key of byUnit.keys()) {
          const [productId] = key.split("||");
          if (!productSnapshots.has(productId)) productSnapshots.set(productId, await tx.get(doc(db, "products", productId)));
        }
        for (const [key, quantity] of byUnit) {
          const [productId, unitId] = key.split("||");
          const snapshot = productSnapshots.get(productId);
          const unit = snapshot?.data()?.units?.find((entry: { id?: string }) => entry.id === unitId);
          if (!snapshot?.exists() || !unit || toNum(unit.stock_quantity) + 0.005 < quantity) throw new Error("VALIDATION:المخزون المتاح لا يكفي لإرجاع الأصناف المحددة.");
        }
        const now = serverTimestamp();
        const user = auth.currentUserKey ?? null;
        const movementIds = new Map<string, string[]>();
        for (const [seq, item] of items.entries()) {
          const movement = doc(collection(db, "inventory_transactions"));
          movementIds.set(item.product_id, [...(movementIds.get(item.product_id) ?? []), movement.id]);
          tx.set(movement, { type: "supplier_return", direction: "out", product_id: item.product_id, product_name: item.product_name, quantity: item.quantity, unit_quantity: item.quantity, unit_id: invoice.items[item.line_index]?.unit_id ?? null, unit_name: item.unit_name, unit_factor: 1, base_quantity: item.quantity, unit_cost: item.unit_cost, purchase_invoice_id: input.invoice_id, return_id: input.id, seq, created_by: user, created_at: now });
        }
        for (const [productId, snapshot] of productSnapshots) {
          const units = Array.isArray(snapshot.data()?.units) ? snapshot.data()!.units : [];
          const nextUnits = units.map((unit: { id?: string; stock_quantity?: number }) => {
            const quantity = byUnit.get(`${productId}||${unit.id ?? ""}`) ?? 0;
            return quantity > 0 ? { ...unit, stock_quantity: round4(toNum(unit.stock_quantity) - quantity) } : unit;
          });
          const ids = movementIds.get(productId) ?? [];
          tx.update(snapshot.ref, { units: nextUnits, last_inventory_transaction_id: ids.at(-1), last_inventory_transaction_ids: ids });
        }
        const newTotal = round2(toNum(invoice.return_total) + total);
        const soldBase = round2((invoice.items ?? []).reduce((sum, item) => sum + toNum(item.base_quantity ?? toNum(item.quantity) * (toNum(item.unit_factor) || 1)), 0));
        const returnedBase = round2((invoice.items ?? []).reduce((sum, item, index) => sum + toNum(returned[String(index)]) * (toNum(item.unit_factor) || 1), 0));
        const remaining = round2(toNum(invoice.remaining_amount) - payableReduction);
        tx.update(invoiceRef, { supplier_id: supplierId, returned_quantities: returned, return_total: newTotal, return_status: returnedBase + 0.005 >= soldBase ? "full" : "partial", remaining_amount: remaining, status: deriveSupplierInvoiceStatus(invoice.paid_amount, remaining) });
        const supplierName = String(supplierSnap?.data()?.name || invoice.supplier_name || "مورد");
        tx.set(returnRef, { purchase_invoice_id: input.invoice_id, supplier_id: supplierId, supplier_name: supplierName, items, total_return: total, payable_reduction: payableReduction, receivable_amount: receivable, request_fingerprint: fingerprint, note: input.note ?? null, created_by: user, created_at: now });
        if (receivable > 0 && supplierId) tx.set(doc(db, "supplier_advances", input.id), { supplier_id: supplierId, supplier_name: supplierName, purchase_invoice_id: input.invoice_id, source_return_id: input.id, amount: receivable, remaining_amount: receivable, created_by: user, created_at: now });
        if (supplierId) {
          const baseline = !invoice.supplier_id || !summarySnap?.exists()
            ? { invoice_count: 1, total_purchases: round2(toNum(invoice.total_amount) - toNum(invoice.return_total)), outstanding_payable: toNum(invoice.remaining_amount), advance_receivable: toNum(invoice.advance_amount) }
            : null;
          writeSupplierSummaryDelta(tx, db, { supplier_id: supplierId, supplier_name: supplierName }, { invoice_count: baseline?.invoice_count, total_purchases: round2((baseline?.total_purchases ?? 0) - total), outstanding_payable: round2((baseline?.outstanding_payable ?? 0) - payableReduction), advance_receivable: round2((baseline?.advance_receivable ?? 0) + receivable) });
        }
        result = { ok: true, total, payableReduction, receivable };
      });
      useProductsStore().invalidateCache();
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("VALIDATION:")) return { ok: false, error: error.message.slice(11) };
      console.error(error);
      return { ok: false, error: "تعذر تسجيل مرتجع المورد." };
    }
  }

  return { fetchForInvoice, createReturn };
});
