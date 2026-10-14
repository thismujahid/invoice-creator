import { collection, getDocs, limit as fsLimit, orderBy, query, where } from "firebase/firestore";
import type { InvoiceReturn } from "~/types/finance";
import type { Invoice } from "~/types";
import { round2, round4 } from "./finance";
import { callStaff } from "./staffApi";

export interface ReturnLineInput {
  line_id: string;
  quantity: number;
  return_bucket: "loose" | "package";
  return_unit_id?: string | null;
}

export interface ReturnPackageUnit {
  id: string;
  name: string;
  factor: number;
}

export interface ReturnRow {
  key: string;
  line_id: string;
  product_id: string;
  product_name: string;
  inventory_mode: "convertible" | "independent";
  unit_price: number;
  unit_id: string;
  unit_name: string;
  loose_unit_name: string;
  unit_factor: number;
  stock_kind: "loose" | "package";
  allows_fractional: boolean;
  soldQty: number;
  returnedQty: number;
  maxQty: number;
  qty: number;
  return_bucket: "loose" | "package";
  return_unit_id: string | null;
  return_units: ReturnPackageUnit[];
}

export interface ReturnPreview {
  remaining: number;
  ratio: number;
  creditUsed: number;
  creditRestored: number;
  creditBalance: number;
  rows: Omit<ReturnRow, "qty" | "return_bucket" | "return_unit_id">[];
}

export const useInvoiceReturns = defineStore("invoiceReturns", () => {
  const { db } = useFirebase();
  let pendingReturn: { fingerprint: string; requestId: string } | null = null;

  const byId = (row: ReturnRow) => row.line_id;

  async function fetchRecentReturns(max = 500): Promise<InvoiceReturn[]> {
    try {
      const snapshot = await getDocs(query(collection(db, "invoice_returns"), orderBy("created_at", "desc"), fsLimit(max)));
      return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as object) }) as InvoiceReturn);
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  async function fetchReturnsForInvoice(invoiceId: string): Promise<InvoiceReturn[]> {
    try {
      const snapshot = await getDocs(query(collection(db, "invoice_returns"), where("invoice_id", "==", invoiceId)));
      return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as object) }) as InvoiceReturn);
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  async function fetchForInvoices(invoiceIds: string[]): Promise<InvoiceReturn[]> {
    const ids = [...new Set(invoiceIds.filter(Boolean))];
    const result: InvoiceReturn[] = [];
    for (let index = 0; index < ids.length; index += 30) {
      const snapshot = await getDocs(query(collection(db, "invoice_returns"), where("invoice_id", "in", ids.slice(index, index + 30))));
      result.push(...snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as object) }) as InvoiceReturn));
    }
    return result;
  }

  async function previewReturn(invoiceId: string): Promise<ReturnPreview> {
    return callStaff<{ id: string }, ReturnPreview>("getStaffReturnPreview", { id: invoiceId });
  }

  async function createReturn(
    invoice: Invoice,
    items: ReturnLineInput[],
    note?: string | null,
    cashRefundRequested = 0,
  ): Promise<{ ok: true; id: string; debtReduction: number; cashRefund: number; creditIssued: number; creditRestored: number } | { ok: false; error: string }> {
    if (!invoice.id) return { ok: false, error: "الفاتورة غير صالحة." };
    const wanted = items.filter((item) => item.line_id && Number(item.quantity) > 0);
    if (!wanted.length) return { ok: false, error: "حدد صنفاً واحداً على الأقل بكمية أكبر من صفر." };
    const payload = {
      id: invoice.id,
      items: wanted.map((item) => ({ line_id: item.line_id, quantity: round4(item.quantity), return_bucket: item.return_bucket, return_unit_id: item.return_unit_id ?? null })),
      note: note?.trim() || null,
      cashRefund: round2(cashRefundRequested),
    };
    try {
      const fingerprint = JSON.stringify(payload);
      if (pendingReturn?.fingerprint !== fingerprint) pendingReturn = { fingerprint, requestId: crypto.randomUUID() };
      const result = await callStaff<typeof payload & { requestId: string }, { id: string; debtReduction: number; cashRefund: number; creditIssued: number; creditRestored: number }>("createStaffReturn", { ...payload, requestId: pendingReturn.requestId });
      pendingReturn = null;
      useProductsStore().invalidateCache();
      return { ok: true, ...result };
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "";
      return { ok: false, error: message || "تعذر حفظ المرتجع." };
    }
  }

  return { byId, fetchRecentReturns, fetchReturnsForInvoice, fetchForInvoices, previewReturn, createReturn };
});
