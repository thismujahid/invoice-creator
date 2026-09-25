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
  | "inventory_adjustment";

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
  note?: string | null;
  created_by?: string | null;
  created_at?: Timestamp | unknown;
}

// ---------- Returns ----------

export interface InvoiceReturnItem {
  product_id: string;
  product_name: string;
  quantity: number;
  original_unit_price: number;
  original_unit_cost?: number;
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
