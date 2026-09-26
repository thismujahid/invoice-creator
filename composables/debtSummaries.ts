import { doc, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore";
import type { Invoice } from "~/types";
import { grossProfitOf, invoiceTotals, outstandingDebtOf } from "./finance";

/** Minimal debt summary per invoice — the ONLY invoice data the debt book loads.
 *  Full invoice documents (with product lines) are never preloaded (strict). */
export interface InvoiceDebtSummary {
  invoice_id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone?: string | number | null;
  date?: unknown;
  total: number;
  paid: number;
  remaining: number;
  profit: number;
}

type SummarySource = Pick<
  Invoice,
  | "customer_id"
  | "customer_name"
  | "customer_phone"
  | "date"
  | "products"
  | "discount"
  | "discount_percentage"
  | "debt"
  | "delivery_price"
  | "amount_of_animal_feeds"
  | "amount_of_mahros"
  | "paid_amount"
  | "remaining"
>;

/** Derive summary numbers from invoice data (same formulas everywhere). */
export function summarizeInvoice(inv: SummarySource): { total: number; paid: number; remaining: number; profit: number } {
  const t = invoiceTotals(inv);
  return { total: t.net, paid: t.paid, remaining: outstandingDebtOf(inv), profit: grossProfitOf(inv.products) };
}

/** Upsert the summary inside the caller's transaction (atomic with the op). */
export function writeDebtSummary(
  tx: Transaction,
  db: Firestore,
  input: Omit<InvoiceDebtSummary, "updated_at"> & { updated_at?: unknown },
): void {
  tx.set(
    doc(db, "invoice_debt_summaries", input.invoice_id),
    { ...input, updated_at: serverTimestamp() },
    { merge: true },
  );
}

/** Reference to an existing summary doc (for targeted reads). */
export function debtSummaryRef(db: Firestore, invoice_id: string) {
  return doc(db, "invoice_debt_summaries", invoice_id);
}
