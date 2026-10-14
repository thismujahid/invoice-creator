import type { Invoice } from "~/types";
import { getLineCost, invoiceTotals, merchandiseProfitOf, round2 } from "~/composables/finance";

/**
 * Canonical invoice figures shared by save, preview, print and Excel export.
 * gross = lines + debt + delivery + feeds + mahros; the discount base always
 * includes the extras (legacy commercial policy, preserved — never changed
 * silently). Cost always prefers historical cost_groups.
 */
export interface InvoiceExportFigures {
  linesSubtotal: number;
  gross: number;
  discountValue: number;
  invoiceTotal: number;
  totalCost: number;
  profit: number;
}

export function invoiceExportFigures(inv: Pick<Invoice, "products" | "discount" | "discount_percentage" | "debt" | "delivery_price" | "amount_of_animal_feeds" | "amount_of_mahros">): InvoiceExportFigures {
  const lines = Array.isArray(inv.products) ? inv.products : [];
  const totals = invoiceTotals(inv);
  const totalCost = round2(lines.reduce((sum, line) => sum + getLineCost(line), 0));
  const linesSubtotal = round2(lines.reduce((sum, line) => sum + Number(line.product_price || 0) * Number(line.product_quantity || 0), 0));
  return {
    linesSubtotal,
    gross: totals.gross,
    discountValue: totals.discountValue,
    invoiceTotal: totals.net,
    totalCost,
    profit: merchandiseProfitOf(inv as Invoice),
  };
}

/** Lines-only subtotal (informational column, never the discount base). */
export function invoiceLinesSubtotal(inv: Pick<Invoice, "products">): number {
  const lines = Array.isArray(inv.products) ? inv.products : [];
  return round2(lines.reduce((sum, line) => sum + Number(line.product_price || 0) * Number(line.product_quantity || 0), 0));
}

export function withLinesSubtotal(figures: InvoiceExportFigures, inv: Pick<Invoice, "products">): InvoiceExportFigures {
  return { ...figures, linesSubtotal: invoiceLinesSubtotal(inv) };
}
