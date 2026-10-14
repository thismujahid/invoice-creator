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
  | "invoice_cancel"
  | "invoice_payment"
  | "invoice_refund"
  | "customer_credit_payout"
  | "invoice_edit_adjustment"
  | "customer_loan"
  | "loan_payment"
  | "inventory_purchase"
  | "inventory_adjustment"
  | "supplier_return"
  | "supplier_payment"
  | "supplier_advance_refund";

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
  reference_type?: "invoice" | "supplier_invoice" | "loan" | "return" | "customer_credit" | "product" | "manual" | null;
  reference_id?: string | null;
  reference_label?: string | null;
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

export const CASH_TYPE_LABELS: Record<CashTransactionType, string> = {
  opening_balance: "رصيد افتتاحي",
  manual_deposit: "إضافة أموال",
  manual_withdrawal: "سحب أموال",
  invoice_sale: "بيع فاتورة",
  invoice_cancel: "عكس قبض فاتورة ملغاة",
  invoice_payment: "تحصيل باقي فاتورة",
  invoice_refund: "مرتجع فاتورة",
  customer_credit_payout: "صرف رصيد عميل",
  invoice_edit_adjustment: "تسوية تعديل فاتورة",
  customer_loan: "سلفة لعميل",
  loan_payment: "تحصيل سلفة",
  inventory_purchase: "شراء مخزون",
  inventory_adjustment: "تسوية مخزون",
  supplier_return: "استرجاع منتجات للمورد",
  supplier_payment: "سداد مورد",
  supplier_advance_refund: "استرداد سلفة مورد",
};

// ---------- Inventory ----------

export type InventoryTransactionType =
  | "opening_stock"
  | "purchase"
  | "sale"
  | "refund"
  | "supplier_return"
  | "manual_adjustment";

export interface InventoryTransaction {
  id?: string;
  type: InventoryTransactionType;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_id?: string | null;
  unit_name?: string | null;
  unit_factor?: number | null;
  stock_kind?: "loose" | "package";
  allows_fractional?: boolean;
  unit_quantity?: number | null;
  base_quantity?: number | null;
  component_deltas?: { loose_base_quantity: number; closed_packages: Record<string, number> };
  opened_packages?: Array<{ unit_id: string; unit_name: string; unit_factor: number; count: number }>;
  return_bucket?: "loose" | "package" | null;
  return_unit_id?: string | null;
  direction: "in" | "out";
  unit_cost?: number | null;
  invoice_id?: string | null;
  return_id?: string | null;
  purchase_invoice_id?: string | null;
  operation_id?: string | null;
  reason?: string | null;
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
  unit_id?: string | null;
  unit_name?: string | null;
  unit_factor?: number | null;
  stock_kind?: "loose" | "package";
  allows_fractional?: boolean;
  base_quantity?: number | null;
  base_unit_cost?: number | null;
  line_total: number;
}

export type SupplierInvoiceStatus = "unpaid" | "partial" | "paid";

export interface PurchaseInvoice {
  id?: string;
  product_ids?: string[];
  supplier_name: string | null;
  supplier_id?: string | null;
  supplier_ref?: string | null;
  invoice_number?: string | null;
  source?: "manual" | "excel_import" | "repeat";
  pinned?: boolean;
  items: PurchaseInvoiceItem[];
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status?: SupplierInvoiceStatus;
  payment_ids?: string[];
  advance_amount?: number;
  return_total?: number;
  return_status?: "partial" | "full";
  returned_quantities?: Record<string, number>;
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

export interface SupplierAdvance {
  id?: string;
  supplier_id: string;
  supplier_name: string;
  purchase_invoice_id: string;
  amount: number;
  remaining_amount: number;
  source_return_id?: string | null;
  created_at?: Timestamp | unknown;
}

export interface Supplier {
  id?: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  created_at?: Timestamp | unknown;
}

function finiteAmount(value: unknown): number {
  const amount = value === null || value === undefined || value === "" ? 0 : Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function deriveSupplierInvoiceStatus(paidAmount: unknown, remainingAmount: unknown, totalAmount?: unknown): SupplierInvoiceStatus {
  const paid = finiteAmount(paidAmount);
  const hasRemaining = remainingAmount !== null && remainingAmount !== undefined && remainingAmount !== "" && Number.isFinite(Number(remainingAmount));
  const rem = hasRemaining ? Number(remainingAmount) : Math.max(0, finiteAmount(totalAmount) - paid);
  if (rem <= 0) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

export function supplierInvoiceStatus(inv: Pick<PurchaseInvoice, "paid_amount" | "remaining_amount" | "total_amount" | "status">): SupplierInvoiceStatus {
  if (inv.status === "paid" || inv.status === "partial" || inv.status === "unpaid") return inv.status;
  return deriveSupplierInvoiceStatus(inv.paid_amount, inv.remaining_amount, inv.total_amount);
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
  cash_amount?: number;
  advance_amount?: number;
  return_id?: string | null;
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
  line_id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_id?: string | null;
  unit_name?: string | null;
  unit_factor?: number | null;
  base_quantity?: number | null;
  original_unit_price: number;
  original_unit_cost?: number;
  source_line_index?: number;
  source_cost_group_index?: number;
  cost_allocations?: Array<{ cost_group_id: string; base_quantity: number; unit_cost: number }>;
  return_bucket?: "loose" | "package";
  return_unit_id?: string | null;
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
  credit_issued?: number;
  credit_restored?: number;
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

export interface SupplierReturnItem {
  line_index: number;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_name: string | null;
  unit_factor: number;
  base_quantity: number;
  unit_cost: number;
  amount: number;
  inventory_unit_cost?: number;
  inventory_amount?: number;
  cost_variance?: number;
  return_bucket?: "loose" | "package";
  return_unit_id?: string | null;
  return_unit_name?: string | null;
}

export interface SupplierReturn {
  id?: string;
  purchase_invoice_id: string;
  supplier_id: string | null;
  supplier_name: string;
  items: SupplierReturnItem[];
  total_return: number;
  inventory_amount?: number;
  cost_variance?: number;
  payable_reduction: number;
  receivable_amount: number;
  cash_received?: number;
  request_fingerprint?: string;
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
  source?: "cash" | "credit";
  cash_amount?: number;
  allocations: DebtPaymentAllocation[];
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}
