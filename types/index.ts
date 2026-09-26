export type UserKey = 'su' | 'c_tarek' | 'c_saleh' | 'c_abanob' | string;

export interface ActiveUser {
  avatar_text: string;
  name: string;
  position: string;
}

export interface Product {
  id?: string;
  name: string;
  price: number | null;
  cost_price: number | null;
  /** Legacy meaning preserved: pieces contained in one sold package. NOT stock. */
  count?: number | null;
  /** Real on-hand stock. Unset/zero until opening stock is entered. */
  stock_quantity?: number | null;
  /** Low-stock alert threshold (default 5 when missing). Fractional allowed. */
  low_stock_threshold?: number | null;
  base_unit_id?: string | null;
  base_unit_name?: string | null;
  units?: ProductUnit[];
  /** Latest inventory movement linked to a stock change. */
  last_inventory_transaction_id?: string | null;
  /** Purchase invoice that authorizes the latest purchase stock/cost update. */
  last_purchase_invoice_id?: string | null;
  /** All movement documents written for the latest atomic stock change. */
  last_inventory_transaction_ids?: string[];
  /** Latest audited cost correction. */
  last_cost_adjustment_id?: string | null;
  date?: Date | FirestoreTimestampLike | string | null;
}

export interface ProductUnit {
  id: string;
  name: string;
  factor: number;
  selling_price: number | null;
  is_base?: boolean;
}

export interface Customer {
  id?: string;
  name: string;
  phone?: string | number | null;
}

export interface InvoiceProductLine {
  product_id?: string;
  product_name: string;
  product_price: number;
  product_cost_price?: number;
  product_quantity: number;
  unit_id?: string;
  unit_name?: string;
  unit_factor?: number;
  base_quantity?: number;
  base_cost_snapshot?: number;
  total?: number;
  option?: string;
  order?: number | null;
}

export type InvoiceDate = Date | FirestoreTimestampLike | string | null;

export interface Invoice {
  id?: string;
  customer_name: string | null;
  customer_phone?: string | number | null;
  debt?: number | string | null;
  delivery_price?: number | string | null;
  discount?: number | string | null;
  discount_percentage?: boolean;
  discount_for?: string | null;
  amount_of_animal_feeds?: number | string | null;
  amount_of_mahros?: number | string | null;
  // HOME delta: paid/remaining (debts feature).
  paid_amount?: number | string | null;
  remaining?: number | string | null;
  // Financial/inventory accounting (optional for legacy docs).
  customer_id?: string | null;
  legacy?: boolean;
  inventory_applied?: boolean;
  cashbox_applied?: boolean;
  // Returned quantities per product (maintained transactionally by returns flow).
  returned?: Record<string, number> | null;
  created_by?: UserKey | null;
  products: InvoiceProductLine[];
  date?: InvoiceDate;
  time?: Date | string | null;
}

export interface FirestoreTimestampLike {
  seconds: number;
  nanoseconds?: number;
}

export function toDateSafe(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const ts = value as FirestoreTimestampLike;
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? null : d;
}
