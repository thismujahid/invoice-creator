export type UserKey = 'su' | 'c_tarek' | 'c_saleh' | 'c_abanob' | string;

export interface ActiveUser {
  avatar_text: string;
  name: string;
  position: string;
}

export interface Product {
  id?: string;
  inventory_mode?: InventoryMode;
  uses_variants?: boolean;
  variant_order?: number;
  variant_key?: string | null;
  pack_size_name?: string | null;
  pack_size_order?: number;
  last_purchase_base_cost?: number | null;
  updated_at?: FirestoreTimestampLike | null;
  family_id?: string | null;
  variant_name?: string | null;
  family_name?: string | null;
  name: string;
  cost_price: number | null;
  stock_quantity?: number | null;
  inventory?: PhysicalInventory | null;
  inventory_alerts?: InventoryAlerts | null;
  base_unit_id?: string | null;
  base_unit_name?: string | null;
  units?: ProductUnit[];
  /** Soft archive flag: inactive products keep historical integrity. */
  is_active?: boolean | null;
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
  stock_kind: "loose" | "package";
  profit_margin?: number | null;
  selling_price: number | null;
  purchase_price?: number | null;
  /** Purchase-price history log for THIS unit (reference only):
   *  `"price-timestamp,price-timestamp,..."` with the latest entry first.
   *  Timestamps are client milliseconds. Bounded to MAX_PURCHASE_PRICE_HISTORY entries. */
  purchase_price_history?: string | null;
  allows_fractional?: boolean;
  is_base?: boolean;
  can_purchase?: boolean;
  can_sell?: boolean;
  archived?: boolean;
}

export interface ProductFamily {
  inventory_mode?: InventoryMode;
  uses_variants?: boolean;
  id?: string;
  name: string;
  is_active?: boolean;
  created_at?: Date | FirestoreTimestampLike | string | null;
  updated_at?: Date | FirestoreTimestampLike | string | null;
}

export type InventoryMode = "convertible" | "independent";

export interface PhysicalInventory {
  loose_base_quantity: number;
  closed_packages: Record<string, number>;
}

export interface InventoryComponentAlert {
  reorder_point: number;
  target_level?: number | null;
}

export interface InventoryAlerts {
  loose?: InventoryComponentAlert;
  packages?: Record<string, InventoryComponentAlert>;
}

export interface Customer {
  id?: string;
  name: string;
  phone?: string | number | null;
}

export interface InvoiceProductLine {
  line_id?: string;
  product_id?: string;
  product_name: string;
  product_price: number;
  product_cost_price?: number;
  product_quantity: number;
  family_id?: string | null;
  family_name?: string | null;
  variant_name?: string | null;
  variant_key?: string | null;
  pack_size_name?: string | null;
  inventory_mode?: InventoryMode;
  unit_id?: string;
  unit_name?: string;
  unit_factor?: number;
  stock_kind?: "loose" | "package";
  allows_fractional?: boolean;
  base_quantity?: number;
  base_cost_snapshot?: number;
  cost_groups?: { group_id?: string; base_quantity: number; unit_cost: number }[];
  component_deltas?: { loose_base_quantity: number; closed_packages: Record<string, number> };
  opened_packages?: { unit_id: string; unit_name: string; unit_factor: number; count: number }[];
  total?: number;
  option?: string;
  order?: number | null;
}

export type InvoiceDate = Date | FirestoreTimestampLike | string | null;

export interface Invoice {
  id?: string;
  edit_revision?: string;
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
  credit_used?: number;
  credit_restored?: number;
  remaining?: number | string | null;
  // Financial/inventory accounting (optional for legacy docs).
  customer_id?: string | null;
  legacy?: boolean;
  inventory_applied?: boolean;
  cashbox_applied?: boolean;
  inventory_effects?: Record<string, { loose_base_quantity: number; closed_packages: Record<string, number> }>;
  status?: "paid" | "partial" | "unpaid" | "cancelled";
  cancelled_at?: InvoiceDate;
  cancelled_by?: string;
  cancel_note?: string | null;
  // Returned quantities per product (maintained transactionally by returns flow).
  returned?: Record<string, number> | null;
  return_status?: "none" | "partial" | "full";
  returned_base_quantity?: number;
  debt_payment_count?: number;
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
