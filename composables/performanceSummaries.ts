import { doc, increment, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore";
import type { Invoice } from "~/types";
import { normalizeName, normalizePhone } from "./finance";
import { invoiceDayKey, invoiceMonthKey, invoiceStatsDelta, sumInvoiceStats, type InvoiceStats } from "./invoiceStats";
export function writeInvoiceStatsDelta(
  tx: Transaction,
  db: Firestore,
  oldInvoice: Invoice | null,
  newInvoice: Invoice | null,
  returnDelta: { count: number; total: number; profit?: number } = { count: 0, total: 0 },
  returnDate?: unknown,
): void {
  const globalDelta = sumInvoiceStats(invoiceStatsDelta(oldInvoice, newInvoice), {
    return_count: returnDelta.count,
    returns_total: returnDelta.total,
    total_profit: -(returnDelta.profit ?? 0),
  });
  writeStatsDocumentDelta(tx, db, "store_stats", "current", globalDelta);

  const periodDeltas = new Map<string, Partial<InvoiceStats>>();
  const applyPeriod = (key: string | null, delta: Partial<InvoiceStats>) => {
    if (!key) return;
    periodDeltas.set(key, sumInvoiceStats(periodDeltas.get(key) ?? {}, delta));
  };
  if (oldInvoice) {
    const oldContribution = invoiceStatsDelta(oldInvoice, null);
    applyPeriod(invoiceDayKey(oldInvoice), oldContribution);
    applyPeriod(invoiceMonthKey(oldInvoice), oldContribution);
  }
  if (newInvoice) {
    const newContribution = invoiceStatsDelta(null, newInvoice);
    applyPeriod(invoiceDayKey(newInvoice), newContribution);
    applyPeriod(invoiceMonthKey(newInvoice), newContribution);
  }
  if (returnDelta.count || returnDelta.total) {
    const delta = { return_count: returnDelta.count, returns_total: returnDelta.total, total_profit: -(returnDelta.profit ?? 0) };
    const periodInvoice = returnDate === undefined ? newInvoice ?? oldInvoice : { date: returnDate } as Invoice;
    applyPeriod(periodInvoice ? invoiceDayKey(periodInvoice) : null, delta);
    applyPeriod(periodInvoice ? invoiceMonthKey(periodInvoice) : null, delta);
  }
  for (const [key, delta] of periodDeltas) {
    const isMonth = key.length === 7;
    writeStatsDocumentDelta(tx, db, isMonth ? "invoice_stats_monthly" : "invoice_stats_daily", key, delta);
  }
}

function writeStatsDocumentDelta(tx: Transaction, db: Firestore, collectionName: string, id: string, delta: Partial<InvoiceStats>): void {
  const changes: Record<string, unknown> = { updated_at: serverTimestamp() };
  for (const [key, value] of Object.entries(delta)) {
    if (value !== undefined && value !== 0) changes[key] = increment(value);
  }
  tx.set(doc(db, collectionName, id), changes, { merge: true });
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

export function writeStatsPaidDelta(
  tx: Transaction,
  db: Firestore,
  amount: number,
): void {
  if (!(amount > 0)) return;
  const delta = { total_paid: amount };
  writeStatsDocumentDelta(tx, db, "store_stats", "current", delta);
  const now = new Date();
  const day = invoiceDayKey({ date: now });
  const month = invoiceMonthKey({ date: now });
  if (day) writeStatsDocumentDelta(tx, db, "invoice_stats_daily", day, delta);
  if (month) writeStatsDocumentDelta(tx, db, "invoice_stats_monthly", month, delta);
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
