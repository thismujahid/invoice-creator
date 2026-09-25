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
  count?: number | null;
  date?: Date | FirestoreTimestampLike | string | null;
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
