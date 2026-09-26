import type { Invoice, InvoiceProductLine, Product, ProductUnit } from "~/types";

/** Round to 2 decimals (money). Single source — use everywhere. */
export function round2(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function round4(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

/** Lenient number coercion (mirrors legacy toNum). */
export function toNum(n: unknown): number {
  if (n === null || n === undefined || n === "") return 0;
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export interface InvoiceTotals {
  gross: number;
  discountValue: number;
  net: number;
  paid: number;
  remaining: number;
}

/** Canonical invoice totals. gross = lines + extras; net = gross - discount. */
export function invoiceTotals(
  inv: Pick<
    Invoice,
    "products" | "discount" | "discount_percentage" | "debt" | "delivery_price" | "amount_of_animal_feeds" | "amount_of_mahros" | "paid_amount"
  >,
): InvoiceTotals {
  const lines = Array.isArray(inv.products) ? inv.products : [];
  const gross =
    lines.reduce((s, l) => s + toNum(l.product_price) * toNum(l.product_quantity), 0) +
    toNum(inv.debt) +
    toNum(inv.delivery_price) +
    toNum(inv.amount_of_animal_feeds) +
    toNum(inv.amount_of_mahros);
  const discountValue = inv.discount_percentage
    ? (gross * toNum(inv.discount)) / 100
    : toNum(inv.discount);
  const net = gross - discountValue;
  const paid = toNum(inv.paid_amount);
  return { gross: round2(gross), discountValue: round2(discountValue), net: round2(net), paid: round2(paid), remaining: round2(net - paid) };
}

/** Single shared outstanding-debt rule (legacy-safe):
 *  - stored `remaining` exists → max(remaining, 0)
 *  - `paid_amount` missing/null/undefined → 0 (pre-feature invoices are paid)
 *  - otherwise computed remaining, clamped at 0. */
export function outstandingDebtOf(
  inv: Pick<
    Invoice,
    "remaining" | "paid_amount" | "products" | "discount" | "discount_percentage" | "debt" | "delivery_price" | "amount_of_animal_feeds" | "amount_of_mahros"
  >,
): number {
  if (inv.remaining !== null && inv.remaining !== undefined) {
    const r = round2(toNum(inv.remaining));
    return r > 0 ? r : 0;
  }
  if (inv.paid_amount === null || inv.paid_amount === undefined) return 0;
  return Math.max(0, invoiceTotals(inv).remaining);
}

/** Discount value for an invoice (replaces the local copies). */
export function discountValueOf(inv: Pick<Invoice, "discount" | "discount_percentage" | "products" | "debt" | "delivery_price" | "amount_of_animal_feeds" | "amount_of_mahros">): number {
  return invoiceTotals(inv).discountValue;
}

/** Gross realized profit of invoice lines: Σ(price − cost) × qty. */
export function grossProfitOf(
  lines: Pick<InvoiceProductLine, "product_price" | "product_cost_price" | "product_quantity" | "base_quantity">[] | null | undefined,
): number {
  if (!Array.isArray(lines)) return 0;
  return round2(
    lines.reduce((s, l) => s + toNum(l.product_price) * toNum(l.product_quantity) - toNum(l.product_cost_price) * toNum(l.base_quantity ?? l.product_quantity), 0),
  );
}

export function unitsForProduct(product: Product): ProductUnit[] {
  const configured = Array.isArray(product.units) ? product.units.filter((u) => u && Number.isFinite(Number(u.factor)) && Number(u.factor) > 0) : [];
  if (configured.length) return configured;
  const id = product.base_unit_id || "legacy-base";
  return [{ id, name: product.base_unit_name || "وحدة", factor: 1, selling_price: product.price, is_base: true }];
}

export function lineUnitFactor(line: Pick<InvoiceProductLine, "unit_factor">): number {
  const factor = Number(line.unit_factor);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function lineBaseQuantity(line: Pick<InvoiceProductLine, "product_quantity" | "unit_factor" | "base_quantity">): number {
  const snapshot = Number(line.base_quantity);
  return round2(Number.isFinite(snapshot) && snapshot >= 0 ? snapshot : toNum(line.product_quantity) * lineUnitFactor(line));
}

/** Estimated collected (cash-in-hand) share of gross profit.
 *  Proportional to the paid share of net total — an approximation, since
 *  payments are not tracked per product line. */
export function collectedProfitOf(
  lines: Pick<InvoiceProductLine, "product_price" | "product_cost_price" | "product_quantity">[] | null | undefined,
  paidAmount: unknown,
  netTotal: unknown,
): number {
  const profit = grossProfitOf(lines);
  const net = toNum(netTotal);
  if (profit <= 0 || net <= 0) return 0;
  const ratio = Math.min(Math.max(toNum(paidAmount) / net, 0), 1);
  return round2(profit * ratio);
}

/** Moving weighted average cost — the ONLY place this formula lives.
 *  newAvg = (curQty*curCost + addedQty*addedCost) / (curQty+addedQty).
 *  - addedQty <= 0 → current cost unchanged.
 *  - curQty <= 0 → addedCost (old cost is meaningless on empty stock).
 *  Monetary persistence should round2() the result (done by callers). */
export function movingAverageCost(
  currentQty: unknown,
  currentCost: unknown,
  addedQty: unknown,
  addedCost: unknown,
): number {
  const cur = toNum(currentQty);
  const add = toNum(addedQty);
  if (!(add > 0)) return toNum(currentCost);
  if (!(cur > 0)) return toNum(addedCost);
  return (cur * toNum(currentCost) + add * toNum(addedCost)) / (cur + add);
}

/** One atomic batch applied to a single product. THE canonical stock math —
 *  used by runtime writers AND by replay, so both produce bit-identical
 *  results. Takes leave cost untouched; cost-bearing inflows blend via the
 *  moving average using one combined rounding. */
export interface StockGroupEffect {
  takeQty: number;
  inflows: { qty: number; cost: number | null }[];
}
export function applyStockGroup(
  stock: number,
  avg: number | undefined,
  takeQty: number,
  inflows: { qty: number; cost: number | null }[],
): { stock: number; avg: number | undefined } {
  let s = round2(stock - takeQty);
  let costQty = 0;
  let costVal = 0;
  let plainQty = 0;
  for (const f of inflows) {
    if (f.cost === null || f.cost === undefined) {
      plainQty = round2(plainQty + f.qty);
    } else {
      costQty = round2(costQty + f.qty);
      costVal += f.qty * f.cost;
    }
  }
  let a = avg;
  if (costQty > 0) {
    a = round4(movingAverageCost(s, a ?? 0, costQty, costVal / costQty));
  }
  s = round2(s + costQty + plainQty);
  return { stock: s, avg: a };
}

/** Selling-price policy after a purchase (S2): keep the old markup rate
 *  over the new average. Returns nulls when no rate is derivable. */
export function proposedSellingPrice(
  oldCost: unknown,
  oldPrice: unknown,
  newAvg: unknown,
): { rate: number | null; proposed: number | null } {
  const oc = toNum(oldCost);
  const op = toNum(oldPrice);
  const na = toNum(newAvg);
  if (!(oc > 0) || !(op >= 0)) return { rate: null, proposed: null };
  const rate = (op - oc) / oc;
  return { rate, proposed: round2(na * (1 + rate)) };
}

/** Explicit selling-price decision for a purchase (S2/S5). */
export type PriceDecision =
  | { mode: "keep" }
  | { mode: "proposed"; approvedProposed: number; price?: number }
  | { mode: "custom"; price: number; approvedProposed?: number | null };

/** Firestore rule reads are limited per atomic request; keep headroom for
 *  both product→movement and movement→product links for every item. */
export const MAX_PURCHASE_ITEMS = 100;
export function estimatePurchaseOps(itemCount: number, newProductCount = 0): number {
  return 3 + itemCount * 3 + newProductCount;
}

/** Net ratio used to allocate discounts proportionally on returns. */
export function netRatioOf(inv: Parameters<typeof invoiceTotals>[0]): number {
  const t = invoiceTotals(inv);
  if (t.gross <= 0) return 1;
  return t.net / t.gross;
}

/** Refundable value of `qty` units of a line at its original sale price,
 *  reduced proportionally by the invoice discount (works for % and fixed). */
export function lineRefundValue(
  unitPrice: unknown,
  qty: unknown,
  netRatio: number,
): number {
  return round2(toNum(unitPrice) * toNum(qty) * netRatio);
}

/** Split a refund between unpaid debt and real cash (debt-first). */
export function splitRefund(refundValue: unknown, remainingDebt: unknown): { debtReduction: number; cashRefund: number } {
  const refund = round2(refundValue);
  const debt = round2(remainingDebt);
  const debtReduction = Math.min(Math.max(refund, 0), Math.max(debt, 0));
  return { debtReduction: round2(debtReduction), cashRefund: round2(refund - debtReduction) };
}

export interface StockDelta {
  product_id: string;
  product_name: string;
  delta: number; // +in / -out
  unit_cost?: number;
}

/** Restored units grouped by (product, historical cost), allocated from the
 *  OLD saved lines in order. Each group re-enters stock at its own cost —
 *  lines are never collapsed into a single cost. */
export interface RestoreGroup {
  product_id: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  unit_id?: string;
  unit_name?: string;
  unit_factor: number;
}
export function restoreGroupsForEdit(
  oldLines: Pick<InvoiceProductLine, "product_id" | "product_name" | "product_quantity" | "product_cost_price" | "unit_id" | "unit_name" | "unit_factor" | "base_quantity">[],
  newLines: Pick<InvoiceProductLine, "product_id" | "product_name" | "product_quantity" | "unit_factor" | "base_quantity">[],
): RestoreGroup[] {
  const oldTotal = new Map<string, number>();
  for (const l of oldLines) {
    if (!l.product_id) continue;
    oldTotal.set(l.product_id, round2((oldTotal.get(l.product_id) ?? 0) + lineBaseQuantity(l)));
  }
  const newTotal = new Map<string, number>();
  for (const l of newLines) {
    if (!l.product_id) continue;
    newTotal.set(l.product_id, round2((newTotal.get(l.product_id) ?? 0) + lineBaseQuantity(l)));
  }
  const out: RestoreGroup[] = [];
  for (const [pid, oldQty] of oldTotal) {
    let need = round2(oldQty - (newTotal.get(pid) ?? 0));
    if (!(need > 0)) continue;
    for (const l of oldLines) {
      if (need <= 0) break;
      if (l.product_id !== pid) continue;
      const lineQty = lineBaseQuantity(l);
      if (!(lineQty > 0)) continue;
      const take = Math.min(need, lineQty);
      out.push({
        product_id: pid,
        product_name: l.product_name,
        qty: round2(take),
        unit_cost: round4(toNum(l.product_cost_price)),
        unit_id: l.unit_id,
        unit_name: l.unit_name,
        unit_factor: lineUnitFactor(l),
      });
      need = round2(need - take);
    }
  }
  return out;
}

/** Diff old vs new invoice lines → per-product stock deltas.
 *  Positive delta = back to stock, negative = take from stock. */
export function stockDeltaForEdit(
  oldLines: Pick<InvoiceProductLine, "product_id" | "product_name" | "product_quantity" | "product_cost_price" | "unit_factor" | "base_quantity">[],
  newLines: Pick<InvoiceProductLine, "product_id" | "product_name" | "product_quantity" | "product_cost_price" | "unit_factor" | "base_quantity">[],
): StockDelta[] {
  const sum = (lines: typeof oldLines) => {
    const m = new Map<string, { qty: number; name: string; cost?: number }>();
    for (const l of lines) {
      if (!l.product_id) continue;
      const e = m.get(l.product_id) ?? { qty: 0, name: l.product_name, cost: toNum(l.product_cost_price) };
      e.qty += lineBaseQuantity(l);
      m.set(l.product_id, e);
    }
    return m;
  };
  const o = sum(oldLines);
  const n = sum(newLines);
  const ids = new Set([...o.keys(), ...n.keys()]);
  const out: StockDelta[] = [];
  for (const id of ids) {
    const delta = round2((o.get(id)?.qty ?? 0) - (n.get(id)?.qty ?? 0));
    if (delta !== 0) {
      const ref = n.get(id) ?? o.get(id)!;
      out.push({ product_id: id, product_name: ref.name, delta, unit_cost: ref.cost });
    }
  }
  return out;
}

/** Loan status derived from amounts (never stored redundantly). */
export function loanStatusOf(paid: unknown, remaining: unknown): "open" | "partial" | "paid" {
  const r = toNum(remaining);
  if (r <= 0) return "paid";
  if (toNum(paid) > 0) return "partial";
  return "open";
}

/** Inventory aggregates for the cashbox dashboard.
 *  Uses stock_quantity ONLY — legacy `count` means pieces-per-package. */
export function inventoryAggregates(products: Pick<Product, "stock_quantity" | "price" | "cost_price">[]): {
  costValue: number;
  saleValue: number;
  expectedProfit: number;
} {
  let cost = 0;
  let sale = 0;
  for (const p of products) {
    const c = toNum(p.stock_quantity);
    cost += c * toNum(p.cost_price);
    sale += c * toNum(p.price);
  }
  cost = round2(cost);
  sale = round2(sale);
  return { costValue: cost, saleValue: sale, expectedProfit: round2(sale - cost) };
}

/** Normalize a phone to digits only (migration matching). */
export function normalizePhone(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/** Low-stock threshold with default 5 for legacy products (S3). */
export function lowStockThresholdOf(p: Pick<Product, "low_stock_threshold">): number {
  const v = (p as { low_stock_threshold?: unknown }).low_stock_threshold;
  if (v === null || v === undefined || v === "") return 5;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/** Unified shortage rule (S3): stock < threshold. Never uses `count`. */
export function isLowStock(p: Pick<Product, "stock_quantity" | "low_stock_threshold">): boolean {
  return toNum(p.stock_quantity) - lowStockThresholdOf(p) < -1e-9;
}

/** Normalize a customer name: strip diacritics, collapse whitespace, trim. */
export function normalizeName(name: unknown): string {
  return String(name ?? "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const useFinance = () => ({
  round2,
  round4,
  toNum,
  invoiceTotals,
  discountValueOf,
  outstandingDebtOf,
  netRatioOf,
  movingAverageCost,
  applyStockGroup,
  grossProfitOf,
  collectedProfitOf,
  lineRefundValue,
  splitRefund,
  stockDeltaForEdit,
  restoreGroupsForEdit,
  loanStatusOf,
  proposedSellingPrice,
  MAX_PURCHASE_ITEMS,
  estimatePurchaseOps,
  inventoryAggregates,
  normalizePhone,
  normalizeName,
  lowStockThresholdOf,
  isLowStock,
  lineBaseQuantity,
  lineUnitFactor,
  unitsForProduct,
});
