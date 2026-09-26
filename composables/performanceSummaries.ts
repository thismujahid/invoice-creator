import { doc, increment, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore";
import type { Invoice } from "~/types";
import { normalizeName, normalizePhone, round2 } from "./finance";
import { summarizeInvoice } from "./debtSummaries";

export interface StoreStatsDelta {
  total_sales?: number;
  outstanding_customer_debt?: number;
  total_profit?: number;
  invoice_count?: number;
  customer_count?: number;
}

export function legacyCustomerSummaryId(name: unknown, phone: unknown): string | null {
  const normalizedName = normalizeName(name);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedName || normalizedPhone.length < 7) return null;
  const value = `${normalizedName}|${normalizedPhone}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `legacy_${(hash >>> 0).toString(36)}`;
}

export function customerSummaryId(invoice: Pick<Invoice, "customer_id" | "customer_name" | "customer_phone">): string | null {
  if (invoice.customer_id) return invoice.customer_id;
  return legacyCustomerSummaryId(invoice.customer_name, invoice.customer_phone);
}

export function invoiceSummaryDelta(invoice: Invoice, multiplier: 1 | -1): StoreStatsDelta {
  const summary = summarizeInvoice(invoice);
  return {
    total_sales: round2(summary.total * multiplier),
    outstanding_customer_debt: round2(summary.remaining * multiplier),
    total_profit: round2(summary.profit * multiplier),
    invoice_count: multiplier,
  };
}

export function writeStoreStatsDelta(tx: Transaction, db: Firestore, delta: StoreStatsDelta): void {
  const changes: Record<string, unknown> = { updated_at: serverTimestamp() };
  for (const [key, value] of Object.entries(delta)) {
    if (value !== undefined && value !== 0) changes[key] = increment(value);
  }
  tx.set(doc(db, "store_stats", "current"), changes, { merge: true });
}

export function writeCustomerSummaryDelta(
  tx: Transaction,
  db: Firestore,
  invoice: Pick<Invoice, "customer_id" | "customer_name" | "customer_phone">,
  delta: { invoice_count?: number; total_sales?: number; outstanding_debt?: number },
): void {
  const id = customerSummaryId(invoice);
  if (!id) return;
  const changes: Record<string, unknown> = {
    customer_id: invoice.customer_id ?? null,
    customer_name: invoice.customer_name ?? null,
    customer_phone: invoice.customer_phone ?? null,
    updated_at: serverTimestamp(),
  };
  for (const [key, value] of Object.entries(delta)) {
    if (value !== undefined && value !== 0) changes[key] = increment(value);
  }
  tx.set(doc(db, "customer_summaries", id), changes, { merge: true });
}

export function writeSupplierSummaryDelta(
  tx: Transaction,
  db: Firestore,
  supplier: { supplier_id?: string | null; supplier_name?: string | null },
  delta: { invoice_count?: number; total_purchases?: number; outstanding_payable?: number },
): void {
  if (!supplier.supplier_id) return;
  const changes: Record<string, unknown> = {
    supplier_id: supplier.supplier_id,
    supplier_name: supplier.supplier_name ?? null,
    updated_at: serverTimestamp(),
  };
  for (const [key, value] of Object.entries(delta)) {
    if (value !== undefined && value !== 0) changes[key] = increment(value);
  }
  tx.set(doc(db, "supplier_summaries", supplier.supplier_id), changes, { merge: true });
}
