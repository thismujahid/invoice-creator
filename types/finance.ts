import type { Timestamp } from "firebase/firestore";

// ---------- Cashbox ----------

export interface Cashbox {
  balance: number;
  updated_at?: Timestamp | unknown;
}

export type CashTransactionType =
  | "opening_balance"
  | "manual_deposit"
  | "manual_withdrawal"
  | "invoice_sale"
  | "invoice_payment"
  | "invoice_refund"
  | "customer_loan"
  | "loan_payment"
  | "inventory_purchase"
  | "inventory_adjustment"
  | "supplier_return"
  | "supplier_payment";

export type CashDirection = "in" | "out";

export interface CashTransaction {
  id?: string;
  type: CashTransactionType;
  direction: CashDirection;
  amount: number;
  customer_id?: string | null;
  invoice_id?: string | null;
  return_id?: string | null;
  loan_id?: string | null;
  product_id?: string | null;
  purchase_invoice_id?: string | null;
  debt_payment_id?: string | null;
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

export const CASH_TYPE_LABELS: Record<CashTransactionType, string> = {
  opening_balance: "رصيد افتتاحي",
  manual_deposit: "إضافة أموال",
  manual_withdrawal: "سحب أموال",
  invoice_sale: "بيع فاتورة",
  invoice_payment: "تحصيل باقي فاتورة",
  invoice_refund: "مرتجع فاتورة",
  customer_loan: "سلفة لعميل",
  loan_payment: "تحصيل سلفة",
  inventory_purchase: "شراء مخزون",
  inventory_adjustment: "تسوية مخزون",
  supplier_return: "استرجاع منتجات للمورد",
  supplier_payment: "سداد مورد",
};

// ---------- Inventory ----------

export type InventoryTransactionType =
  | "opening_stock"
  | "purchase"
  | "sale"
  | "refund"
  | "manual_adjustment";

export interface InventoryTransaction {
  id?: string;
  type: InventoryTransactionType;
  product_id: string;
  product_name: string;
  quantity: number;
  direction: "in" | "out";
  unit_cost?: number | null;
  invoice_id?: string | null;
  return_id?: string | null;
  purchase_invoice_id?: string | null;
  /** Write order inside one atomic batch; replay sorts by (created_at, seq). */
  seq?: number | null;
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

// ---------- Purchase invoices & supplier debts (S5) ----------

export interface PurchaseInvoiceItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

export type SupplierInvoiceStatus = "unpaid" | "partial" | "paid";

export interface PurchaseInvoice {
  id?: string;
  product_ids?: string[];
  supplier_name: string | null;
  supplier_ref?: string | null;
  items: PurchaseInvoiceItem[];
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  payment_ids?: string[];
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

export function supplierInvoiceStatus(inv: Pick<PurchaseInvoice, "paid_amount" | "remaining_amount" | "total_amount">): SupplierInvoiceStatus {
  const rem = toNum(inv.remaining_amount);
  if (rem <= 0) return "paid";
  if (toNum(inv.paid_amount) > 0) return "partial";
  return "unpaid";
}

export const SUPPLIER_STATUS_LABELS: Record<SupplierInvoiceStatus, string> = {
  unpaid: "غير مسددة",
  partial: "مسددة جزئيًا",
  paid: "مسددة",
};

export interface SupplierPayment {
  id?: string;
  purchase_invoice_id: string;
  amount: number;
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

export interface ImportBatch {
  id?: string;
  file_hash: string;
  filename?: string | null;
  rows?: number | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

/** Atomic-batch size guard (§5.4): ~3 ops per item + fixed overhead. */
export const MAX_PURCHASE_ITEMS = 100;
export function estimatePurchaseOps(itemCount: number, newProductCount = 0): number {
  return 3 + itemCount * 3 + newProductCount;
}

// ---------- Returns ----------

export interface InvoiceReturnItem {
  product_id: string;
  product_name: string;
  quantity: number;
  original_unit_price: number;
  original_unit_cost?: number;
  source_line_index?: number;
  refund_amount: number;
}

export interface InvoiceReturn {
  id?: string;
  invoice_id: string;
  customer_id?: string | null;
  items: InvoiceReturnItem[];
  total_refund: number;
  debt_reduction?: number;
  cash_refund?: number;
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

// ---------- Loans & debt payments ----------

export interface CustomerLoan {
  id?: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string | number | null;
  amount: number;
  paid_amount: number;
  remaining: number;
  status: "open" | "partial" | "paid";
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

export interface DebtPaymentAllocation {
  type: "invoice" | "loan";
  reference_id: string;
  amount: number;
}

export interface DebtPayment {
  id?: string;
  customer_id: string;
  amount: number;
  allocations: DebtPaymentAllocation[];
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}
