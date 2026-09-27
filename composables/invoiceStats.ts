import type { Invoice } from "~/types";
import { grossProfitOf, invoiceTotals, lineBaseQuantity, outstandingDebtOf, round2, toNum } from "./finance.ts";

export interface InvoiceStats {
  total_sales: number;
  gross_sales: number;
  total_discount: number;
  total_paid: number;
  outstanding_customer_debt: number;
  total_cost: number;
  total_profit: number;
  invoice_count: number;
  return_count: number;
  returns_total: number;
  paid_invoice_count: number;
  partial_invoice_count: number;
  unpaid_invoice_count: number;
}

export type InvoicePaymentStatus = "paid" | "partial" | "unpaid";

const ZERO_INVOICE_STATS: InvoiceStats = {
  total_sales: 0, gross_sales: 0, total_discount: 0, total_paid: 0,
  outstanding_customer_debt: 0, total_cost: 0, total_profit: 0,
  invoice_count: 0, return_count: 0, returns_total: 0,
  paid_invoice_count: 0, partial_invoice_count: 0, unpaid_invoice_count: 0,
};

export function invoicePaymentStatus(invoice: Invoice): InvoicePaymentStatus {
  const remaining = outstandingDebtOf(invoice);
  if (remaining <= 0) return "paid";
  const paid = invoice.paid_amount === null || invoice.paid_amount === undefined
    ? invoiceTotals(invoice).net
    : toNum(invoice.paid_amount);
  return paid > 0 ? "partial" : "unpaid";
}

export function invoiceStatsOf(invoice: Invoice | null | undefined): InvoiceStats {
  if (!invoice) return { ...ZERO_INVOICE_STATS };
  const totals = invoiceTotals(invoice);
  const remaining = outstandingDebtOf(invoice);
  const paid = invoice.paid_amount === null || invoice.paid_amount === undefined
    ? round2(Math.max(0, totals.net - remaining))
    : round2(toNum(invoice.paid_amount));
  const totalCost = round2((invoice.products ?? []).reduce((sum, line) => {
    if (Array.isArray(line.cost_groups) && line.cost_groups.length) {
      return sum + line.cost_groups.reduce((groupSum, group) => groupSum + toNum(group.base_quantity) * toNum(group.unit_cost), 0);
    }
    return sum + toNum(line.product_cost_price) * lineBaseQuantity(line);
  }, 0));
  const status = invoicePaymentStatus(invoice);
  return {
    total_sales: totals.net,
    gross_sales: totals.gross,
    total_discount: totals.discountValue,
    total_paid: paid,
    outstanding_customer_debt: remaining,
    total_cost: totalCost,
    total_profit: grossProfitOf(invoice.products),
    invoice_count: 1,
    return_count: 0,
    returns_total: 0,
    paid_invoice_count: status === "paid" ? 1 : 0,
    partial_invoice_count: status === "partial" ? 1 : 0,
    unpaid_invoice_count: status === "unpaid" ? 1 : 0,
  };
}

function invoiceDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value !== null && "seconds" in value && typeof value.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function invoiceDayKey(invoice: { date?: unknown }): string | null {
  const date = invoiceDate(invoice.date);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function invoiceMonthKey(invoice: { date?: unknown }): string | null {
  const day = invoiceDayKey(invoice);
  return day ? day.slice(0, 7) : null;
}

export function invoiceStatsDelta(oldInvoice: Invoice | null, newInvoice: Invoice | null): InvoiceStats {
  const oldStats = invoiceStatsOf(oldInvoice);
  const newStats = invoiceStatsOf(newInvoice);
  const delta = {} as InvoiceStats;
  for (const key of Object.keys(ZERO_INVOICE_STATS) as (keyof InvoiceStats)[]) {
    delta[key] = key.endsWith("_count")
      ? newStats[key] - oldStats[key]
      : round2(newStats[key] - oldStats[key]);
  }
  return delta;
}

export function sumInvoiceStats(...values: Partial<InvoiceStats>[]): InvoiceStats {
  const result = { ...ZERO_INVOICE_STATS };
  for (const value of values) {
    for (const key of Object.keys(result) as (keyof InvoiceStats)[]) {
      const amount = Number(value[key] ?? 0);
      result[key] = key.endsWith("_count")
        ? result[key] + amount
        : round2(result[key] + amount);
    }
  }
  return result;
}
