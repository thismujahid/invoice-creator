import { collection, getDocs, query, where } from "firebase/firestore";
import type { PurchaseInvoice, SupplierReturn } from "~/types/finance";
import { toDateSafe } from "~/types";
import { round2, toNum } from "./finance";
import { callStaff } from "./staffApi";

export interface SupplierReturnSelection {
  line_index: number;
  quantity: number;
  return_bucket: "loose" | "package";
  return_unit_id?: string | null;
}

export const useSupplierReturns = defineStore("supplierReturns", () => {
  const { db } = useFirebase();

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
    const seen = new Set<number>();
    for (const item of input.items) {
      if (!Number.isInteger(item.line_index) || !Number.isFinite(item.quantity) || item.quantity <= 0
        || Math.abs(item.quantity - Math.round(item.quantity * 10000) / 10000) > 1e-9
        || (item.return_bucket !== "loose" && item.return_bucket !== "package")
        || seen.has(item.line_index)) return { ok: false, error: "بيانات مكوّن المرتجع أو كميته غير صالحة." };
      seen.add(item.line_index);
    }
    try {
      const result = await callStaff<{
        requestId: string;
        id: string;
        invoice_id: string;
        items: SupplierReturnSelection[];
        supplier_id?: string | null;
        note?: string | null;
      }, { ok: true; total: number; payableReduction: number; receivable: number; duplicate?: boolean }>("createStaffSupplierReturn", {
        requestId: input.id,
        ...input,
      });
      useProductsStore().invalidateCache();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر تسجيل مرتجع المورد.";
      return { ok: false, error: message.replace(/^\w+:\s*/, "") };
    }
  }

  return { fetchForInvoice, createReturn };
});
