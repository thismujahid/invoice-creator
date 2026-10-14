import type { Invoice, InvoiceProductLine, Product, ProductUnit } from "~/types";
import { baseQuantityFor, inventoryTotal, inventoryLabel, lowStockComponents, movingAverage } from "../functions/shared/inventoryCore.mjs";

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

export function allocateSupplierCash(outstanding: number, cash: number): { applied: number; advance: number; remaining: number } {
  const applied = Math.min(round2(outstanding), round2(cash));
  return { applied, advance: round2(cash - applied), remaining: round2(outstanding - applied) };
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
  lines: Pick<InvoiceProductLine, "product_price" | "product_cost_price" | "product_quantity" | "base_quantity" | "cost_groups">[] | null | undefined,
): number {
  if (!Array.isArray(lines)) return 0;
  return round2(
    lines.reduce((s, l) => {
      const groups = Array.isArray(l.cost_groups) && l.cost_groups.length
        ? l.cost_groups.reduce((sum, group) => sum + toNum(group.base_quantity) * toNum(group.unit_cost), 0)
        : toNum(l.product_cost_price) * toNum(l.base_quantity ?? l.product_quantity);
      return s + toNum(l.product_price) * toNum(l.product_quantity) - groups;
    }, 0),
  );
}

export function unitsForProduct(product: Product): ProductUnit[] {
  return Array.isArray(product.units)
    ? product.units.filter((unit) => unit && String(unit.id || "").trim() && String(unit.name || "").trim() && Number(unit.factor) > 0 && (unit.stock_kind === "loose" || unit.stock_kind === "package"))
    : [];
}

/** Base unit of a product (is_base, else base_unit_id, else first). */
export function baseUnitOf(product: Product): ProductUnit {
  const units = unitsForProduct(product);
  const base = units.find((unit) => unit.is_base) ?? units.find((unit) => unit.id === product.base_unit_id);
  if (!base) throw new Error("PRODUCT_BASE_UNIT_MISSING");
  return base;
}

export function findUnit(product: Product, unitId?: string | null): ProductUnit | undefined {
  if (!unitId) return undefined;
  return unitsForProduct(product).find((u) => u.id === unitId);
}

/** Factor validation: finite, > 0. Base must be exactly 1. */
export function isValidFactor(factor: unknown): boolean {
  const f = Number(factor);
  return Number.isFinite(f) && f > 0;
}

export function validateUnitFactor(unit: Pick<ProductUnit, "factor" | "is_base">): string | null {
  const f = Number(unit.factor);
  if (!Number.isFinite(f) || f <= 0) return "معامل التحويل يجب أن يكون رقمًا موجبًا.";
  if (unit.is_base && f !== 1) return "معامل الوحدة الأساسية يجب أن يساوي 1.";
  return null;
}

export function purchasableUnitsForProduct(product: Product): ProductUnit[] {
  return unitsForProduct(product).filter((unit) => unit.can_purchase !== false && unit.archived !== true);
}

export function sellableUnitsForProduct(product: Product): ProductUnit[] {
  return unitsForProduct(product).filter((unit) => unit.can_sell !== false && unit.archived !== true && unit.selling_price !== null && unit.selling_price !== undefined && toNum(unit.selling_price) > 0);
}

export function unitSellingPrice(_product: Product, unit: ProductUnit): number | null {
  if (unit.selling_price === null || unit.selling_price === undefined) return null;
  return toNum(unit.selling_price);
}

/** Last purchase price in the unit's own denomination (reference only). */
export function unitPurchasePrice(_product: Product, unit: ProductUnit): number | null {
  if (unit.purchase_price === null || unit.purchase_price === undefined) return null;
  return toNum(unit.purchase_price);
}

/** Derived moving-average cost in the unit's own denomination
 *  (base average × factor). Computed on demand — never stored. */
export function unitAverageCost(product: Product, unit: ProductUnit): number | null {
  if (product.cost_price === null || product.cost_price === undefined) return null;
  const factor = Number(unit.factor);
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return round4(toNum(product.cost_price) * factor);
}

export function unitStockDisplay(product: Product, unit: ProductUnit): number {
  if (!product.inventory) return Number.NaN;
  if (unit.stock_kind === "package") return toNum(product.inventory?.closed_packages?.[unit.id]);
  const factor = Number(unit.factor);
  if (!Number.isFinite(factor) || factor <= 0) return 0;
  const quantity = inventoryTotal(product.inventory, unitsForProduct(product)) / factor;
  return unit.allows_fractional === true
    ? Math.floor((quantity + 1e-9) * 10000) / 10000
    : Math.floor(quantity + 1e-9);
}

/** Canonical stock breakdown, e.g. 63 KG with carton×20 → "3 كرتونة و3 كجم".
 *  Whole larger units first, remainder in base. No double counting. */
export function stockQuantityLabel(product: Product, quantity?: number | null | undefined): string {
  const displayed = quantity === undefined ? product.stock_quantity : quantity;
  if (displayed === null || displayed === undefined) return "غير مُدخل";
  if (!Number.isFinite(displayed)) return "—";
  if (quantity === undefined && !product.inventory) return "غير مُدخل";
  const inventory = quantity === undefined
    ? product.inventory!
    : { loose_base_quantity: round4(toNum(quantity)), closed_packages: {} };
  return inventoryLabel(inventory, product as never);
}

/** Machine-readable decomposition of canonical stock into whole larger
 *  units + base remainder. Pure — used by displays and tests. */
export function decomposeStock(product: Product, quantity?: number | null | undefined): { unit: ProductUnit; qty: number }[] {
  const units = unitsForProduct(product);
  const base = baseUnitOf(product);
  if (quantity === undefined && !product.inventory) return [];
  const inventory = quantity === undefined
    ? product.inventory!
    : { loose_base_quantity: round4(toNum(quantity)), closed_packages: {} };
  const out = units.filter((unit) => unit.stock_kind === "package" && toNum(inventory.closed_packages[unit.id]) > 0)
    .sort((a, b) => b.factor - a.factor)
    .map((unit) => ({ unit, qty: toNum(inventory.closed_packages[unit.id]) }));
  if (inventory.loose_base_quantity > 0 || out.length === 0) out.push({ unit: base, qty: round4(toNum(inventory.loose_base_quantity)) });
  return out;
}

export function convertUnitPrice(unitCost: unknown, fromFactor: unknown, toFactor: unknown): number {
  const from = Number(fromFactor);
  const to = Number(toFactor);
  if (!(Number.isFinite(from) && from > 0 && Number.isFinite(to) && to > 0)) return 0;
  return round4((toNum(unitCost) / from) * to);
}

export function lineUnitFactor(line: Pick<InvoiceProductLine, "unit_factor">): number {
  const factor = Number(line.unit_factor);
  if (!Number.isFinite(factor) || factor <= 0) throw new Error("INVOICE_UNIT_FACTOR_INVALID");
  return factor;
}

export function lineBaseQuantity(line: Pick<InvoiceProductLine, "product_quantity" | "unit_factor" | "base_quantity">): number {
  const snapshot = Number(line.base_quantity);
  if (!Number.isFinite(snapshot) || snapshot < 0) throw new Error("INVOICE_BASE_QUANTITY_MISSING");
  return round4(snapshot);
}

/** Canonical unit conversion (base ↔ selected unit).
 *  factor means: 1 selected unit = factor × base units.
 *  Stock and average cost are always stored in BASE terms. */
export function toBaseQuantity(quantityInUnit: unknown, factor: unknown): number {
  const factorNum = Number(factor);
  if (!Number.isFinite(factorNum) || factorNum <= 0) throw new Error("معامل التحويل غير صالح.");
  try { return baseQuantityFor(Number(quantityInUnit), factorNum); }
  catch (error) {
    if (error instanceof Error && error.message === "BASE_QUANTITY_PRECISION_INVALID") throw new Error("الكمية بعد التحويل يجب أن تكون قابلة للتمثيل حتى أربع منازل عشرية.");
    throw new Error("الكمية أو معامل التحويل غير صالح.");
  }
}

export function toUnitQuantity(baseQuantity: unknown, factor: unknown): number {
  const factorNum = Number(factor);
  if (!Number.isFinite(factorNum) || factorNum <= 0) throw new Error("معامل التحويل غير صالح.");
  return round4(toNum(baseQuantity) / factorNum);
}

/** Validate a quantity in a unit's denomination: finite, > 0 (or >= 0 when
 *  allowZero), at most 4 decimals, integer when the unit forbids fractions. */
export function validateUnitQuantity(unit: Pick<ProductUnit, "allows_fractional">, quantity: unknown, opts?: { allowZero?: boolean }): string | null {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return "الكمية غير صالحة.";
  if (opts?.allowZero ? q < 0 : q <= 0) return "الكمية يجب أن تكون أكبر من صفر.";
  if (Math.abs(round4(q) - q) > 1e-9) return "الكمية تقبل أربع منازل عشرية كحد أقصى.";
  if (unit.allows_fractional !== true && !Number.isInteger(q)) return "هذه الوحدة لا تقبل كميات كسرية.";
  return null;
}

/** Canonical average cost of ONE BASE UNIT (Product.cost_price semantics). */
export function getBaseUnitCost(product: Pick<Product, "cost_price">): number {
  return toNum(product.cost_price);
}

/** Canonical derived average cost of ONE SELECTED UNIT:
 *  baseAverage × factor. Never persisted per-unit. */
export function getUnitAverageCost(baseAverageCost: unknown, factor: unknown): number | null {
  const factorNum = Number(factor);
  if (!Number.isFinite(factorNum) || factorNum <= 0) return null;
  return round4(toNum(baseAverageCost) * factorNum);
}

/** Selected-unit average cost for display/validation (same-unit compare). */
export function selectedUnitAverageCost(product: Pick<Product, "cost_price">, unit: Pick<ProductUnit, "factor">): number | null {
  return getUnitAverageCost(getBaseUnitCost(product), unit.factor);
}

/** True when a selected-unit selling price is below its own average cost. */
export function isBelowUnitCost(sellingPrice: unknown, baseAverageCost: unknown, factor: unknown): boolean {
  const avg = getUnitAverageCost(baseAverageCost, factor);
  if (avg === null) return false;
  return toNum(sellingPrice) - avg < -1e-9;
}

/** Line-level revenue/cost/profit (historical-cost aware). */
export function getLineRevenue(line: Pick<InvoiceProductLine, "product_price" | "product_quantity">): number {
  return round2(toNum(line.product_price) * toNum(line.product_quantity));
}

export function discountShareOf(inv: Parameters<typeof invoiceTotals>[0]): number {
  const t = invoiceTotals(inv);
  if (!(t.gross > 1e-9)) return 0;
  return t.discountValue / t.gross;
}

export function lineNetRevenue(line: Pick<InvoiceProductLine, "product_price" | "product_quantity">, share: number): number {
  return round2(getLineRevenue(line) * (1 - share));
}

export function merchandiseProfitOf(inv: Parameters<typeof getInvoiceBreakdown>[0]): number {
  const share = discountShareOf(inv);
  const lines = Array.isArray(inv.products) ? inv.products : [];
  return round2(lines.reduce((s, l) => s + getLineRevenue(l) * (1 - share) - getLineCost(l), 0));
}

export function getLineCost(line: Pick<InvoiceProductLine, "product_cost_price" | "product_quantity" | "base_quantity" | "cost_groups">): number {
  if (Array.isArray(line.cost_groups) && line.cost_groups.length) {
    return round2(line.cost_groups.reduce((sum, group) => sum + toNum(group.base_quantity) * toNum(group.unit_cost), 0));
  }
  return round2(toNum(line.product_cost_price) * lineBaseQuantity(line as InvoiceProductLine));
}

export function getLineProfit(line: Pick<InvoiceProductLine, "product_price" | "product_cost_price" | "product_quantity" | "base_quantity" | "cost_groups">): number {
  return round2(getLineRevenue(line) - getLineCost(line));
}

/** Canonical invoice breakdown separating previous debt from current sales.
 *  - currentSaleSubtotal: Σ line revenue (selected-unit price × qty)
 *  - invoiceExtras: delivery + feeds + mahros (current charges)
 *  - previousBalance: debt field (old customer balance, NOT new sales)
 *  - gross = current + extras + previous
 *  - discountValue computed on gross (legacy behavior preserved)
 *  - invoicePayable = gross - discount
 *  - salesNet: current sale after proportional discount allocation
 *    (previous debt never inflates sales/revenue/profit). */
export interface InvoiceBreakdown {
  currentSaleSubtotal: number;
  invoiceExtras: number;
  previousBalance: number;
  gross: number;
  discountValue: number;
  invoicePayable: number;
  salesNet: number;
  salesGross: number;
  paid: number;
  remaining: number;
}

export function getInvoiceBreakdown(
  inv: Pick<Invoice, "products" | "discount" | "discount_percentage" | "debt" | "delivery_price" | "amount_of_animal_feeds" | "amount_of_mahros" | "paid_amount">,
): InvoiceBreakdown {
  const lines = Array.isArray(inv.products) ? inv.products : [];
  const currentSaleSubtotal = round2(lines.reduce((s, l) => s + toNum(l.product_price) * toNum(l.product_quantity), 0));
  const invoiceExtras = round2(toNum(inv.delivery_price) + toNum(inv.amount_of_animal_feeds) + toNum(inv.amount_of_mahros));
  const previousBalance = round2(toNum(inv.debt));
  const gross = round2(currentSaleSubtotal + invoiceExtras + previousBalance);
  const discountValue = inv.discount_percentage
    ? round2((gross * toNum(inv.discount)) / 100)
    : round2(toNum(inv.discount));
  const invoicePayable = round2(gross - discountValue);
  const currentGross = round2(currentSaleSubtotal + invoiceExtras);
  let salesNet = round2(currentGross - discountValue);
  if (gross > 1e-9 && currentGross > 0) {
    // Allocate discount proportionally so debt discount never becomes sales.
    salesNet = round2(currentGross - (discountValue * currentGross) / gross);
  } else if (gross <= 1e-9) {
    salesNet = 0;
  }
  const paid = round2(toNum(inv.paid_amount));
  return {
    currentSaleSubtotal,
    invoiceExtras,
    previousBalance,
    gross,
    discountValue,
    invoicePayable,
    salesNet,
    salesGross: currentGross,
    paid,
    remaining: round2(invoicePayable - paid),
  };
}

/** Current-sale total (lines + extras, after proportional discount).
 *  Use for sales/revenue statistics — never invoiceTotals().net. */
export function getInvoiceSalesTotal(inv: Parameters<typeof getInvoiceBreakdown>[0]): number {
  return getInvoiceBreakdown(inv).salesNet;
}

/** Amount the customer must settle (current sale + previous balance - discount). */
export function getInvoicePayableTotal(inv: Parameters<typeof getInvoiceBreakdown>[0]): number {
  return getInvoiceBreakdown(inv).invoicePayable;
}

/** Purchase-line canonical math (selected unit → base terms, full precision).
 *  Same helper for preview AND committed transaction. */
export function purchaseLineBaseQuantity(quantity: unknown, factor: unknown): number {
  return toBaseQuantity(quantity, factor);
}

export function purchaseLineBaseCost(unitCost: unknown, factor: unknown): number {
  const factorNum = Number(factor);
  if (!Number.isFinite(factorNum) || factorNum <= 0) throw new Error("معامل التحويل غير صالح.");
  return toNum(unitCost) / factorNum;
}

export function purchasePreviewAverage(currentStock: unknown, currentAvg: unknown, addedBaseQty: unknown, addedBaseCost: unknown): number {
  return movingAverage(toNum(currentStock), toNum(currentAvg), toNum(addedBaseQty), toNum(addedBaseQty) * toNum(addedBaseCost)) ?? toNum(currentAvg);
}

/** Canonical purchase preview for ONE line in its selected unit:
 *  converts to base terms, then blends with the canonical stock/average. */
export function previewBasePurchase(
  currentStockBase: unknown,
  currentAvgBase: unknown,
  quantityInUnit: unknown,
  unitCost: unknown,
  factor: unknown,
): { baseQty: number; baseCost: number; newAvg: number; lineTotal: number } {
  const f = Number(factor);
  if (!Number.isFinite(f) || f <= 0) throw new Error("معامل التحويل غير صالح.");
  const baseQty = round4(toNum(quantityInUnit) * f);
  const baseCost = toNum(unitCost) / f;
  return {
    baseQty,
    baseCost,
    newAvg: round4(movingAverage(toNum(currentStockBase), currentAvgBase == null ? null : toNum(currentAvgBase), baseQty, baseQty * baseCost) ?? toNum(currentAvgBase)),
    lineTotal: round2(toNum(quantityInUnit) * toNum(unitCost)),
  };
}

/** Aggregate multi-unit purchase lines of one product into base terms so the
 *  weighted average stays correct and deterministic. */
export function aggregatePurchaseByProduct(
  lines: { product_id: string; baseQty: number; lineTotal: number }[],
): Map<string, { baseQty: number; totalCost: number; baseCost: number }> {
  const map = new Map<string, { baseQty: number; totalCost: number; baseCost: number }>();
  const sorted = [...lines].sort((a, b) => String(a.product_id).localeCompare(String(b.product_id)));
  for (const line of sorted) {
    const entry = map.get(line.product_id) ?? { baseQty: 0, totalCost: 0, baseCost: 0 };
    entry.baseQty = round4(entry.baseQty + toNum(line.baseQty));
    entry.totalCost = entry.totalCost + toNum(line.lineTotal);
    map.set(line.product_id, entry);
  }
  for (const entry of map.values()) {
    entry.baseCost = entry.baseQty > 0 ? entry.totalCost / entry.baseQty : 0;
  }
  return map;
}

/** Selling-price proposals for EVERY sellable unit after an average-cost
 *  change. Each unit preserves its own previous margin:
 *  oldUnitAvg = oldBaseAvg × factor, newUnitAvg = newBaseAvg × factor. */
export function purchaseUnitProposals(
  product: Pick<Product, "cost_price" | "units" | "base_unit_id">,
  newBaseAvg: unknown,
): { unitId: string; unitName: string; factor: number; oldAvg: number | null; oldPrice: number | null; newAvg: number | null; rate: number | null; proposed: number | null }[] {
  const units = unitsForProduct(product as Product).filter((u) => u.can_sell !== false);
  const newAvg = toNum(newBaseAvg);
  return units.map((unit) => {
    const factor = Number(unit.factor);
    if (!Number.isFinite(factor) || factor <= 0) throw new Error("PRODUCT_UNIT_FACTOR_INVALID");
    const oldAvg = product.cost_price === null || product.cost_price === undefined ? null : round4(toNum(product.cost_price) * factor);
    const oldPrice = unitSellingPrice(product as Product, unit);
    const newUnitAvg = round4(newAvg * factor);
    if (oldAvg === null || oldPrice === null) {
      return { unitId: unit.id, unitName: unit.name, factor, oldAvg, oldPrice, newAvg: newUnitAvg, rate: null, proposed: null };
    }
    const { rate, proposed } = proposedSellingPrice(oldAvg, oldPrice, newUnitAvg);
    return { unitId: unit.id, unitName: unit.name, factor, oldAvg, oldPrice, newAvg: newUnitAvg, rate, proposed };
  });
}

/** Excel formula for the editable "new average cost (base)" cell of a
 *  purchase-order row. Columns: C = order qty (preferred unit), D = unit cost
 *  (preferred unit). Baked constants: stockBase (base stock), oldBase (base
 *  avg), factor (preferred unit factor). newAvgBase =
 *  (stockBase*oldBase + C*D) / (stockBase + C*factor); empty qty keeps old;
 *  empty stock takes the row's base cost (D/factor). Pure string builder. */
export function shortageAvgFormula(args: {
  ownRow: number;
  oldBaseAvg: number;
  stockBase: number;
  factor: number;
}): string {
  const { ownRow, oldBaseAvg, stockBase, factor } = args;
  const f = Number(factor);
  if (!Number.isFinite(f) || f <= 0) throw new Error("PRODUCT_UNIT_FACTOR_INVALID");
  const weighted = `(${stockBase}*${oldBaseAvg}+C${ownRow}*D${ownRow})/(${stockBase}+C${ownRow}*${f})`;
  const rowBaseCost = `(D${ownRow}/${f})`;
  return `IF(OR(C${ownRow}="",C${ownRow}=0),${oldBaseAvg},ROUND(IF(${stockBase}<=0,${rowBaseCost},${weighted}),4))`;
}

/** Margin rate implied by recorded prices for a purchase-order unit row:
 *  over the recorded average when one exists, else over the last purchase
 *  cost reference. null = no margin derivable (price cell stays = average /
 *  manual entry). Shared by the export price formula and the import
 *  fresh-price check so both always agree. */
export function orderMarginRate(
  oldUnitAvg: number,
  unitPrice: number | null | undefined,
  costRef: number,
): number | null {
  if (unitPrice === null || unitPrice === undefined) return null;
  const base = oldUnitAvg > 0 ? oldUnitAvg : toNum(costRef);
  if (!(base > 0)) return null;
  return (toNum(unitPrice) - base) / base;
}

/** Base-converted manual selling price of one import row, or null when the
 *  row carries no genuine manual price: untouched (equals recorded), or —
 *  for multi-row products only — following its own average cell by its
 *  implied margin (recorded average, else last purchase cost, else the cell
 *  itself). Export-fresh rows are ignored, never conflicts: each unit
 *  preserves its own margin, so margins legitimately differ across units and
 *  must not be compared in base terms. Single-row behavior is exactly the
 *  legacy rule. */
export function manualPriceBaseOf(
  product: Pick<Product, "cost_price" | "units">,
  row: { priceOverride: number | null | undefined; avgOverride: number | null | undefined; unitId?: string; unitFactor?: number | null },
  siblingCount: number,
): number | null {
  if (row.priceOverride === null || row.priceOverride === undefined) return null;
  const full = product as Product;
  const unit = (full.units ?? []).find((u) => u.id === row.unitId);
  const oldUnitPrice = unit ? unitSellingPrice(full, unit) : null;
  if (oldUnitPrice !== null && Math.abs(toNum(row.priceOverride) - oldUnitPrice) <= 0.005) return null;
  if (siblingCount > 1 && oldUnitPrice !== null) {
    const factor = Number(unit?.factor ?? row.unitFactor);
    if (!Number.isFinite(factor) || factor <= 0) return null;
    const oldUnitAvg = round4(toNum(full.cost_price) * factor);
    const lastCost = unit ? unitPurchasePrice(full, unit) : null;
    const costRefLike = lastCost ?? oldUnitAvg;
    const rate = orderMarginRate(oldUnitAvg, oldUnitPrice, costRefLike);
    if (rate !== null) {
      const eUsed =
        row.avgOverride !== null && row.avgOverride !== undefined
          ? toNum(row.avgOverride)
          : oldUnitAvg > 0
            ? oldUnitAvg
            : toNum(costRefLike);
      if (Math.abs(toNum(row.priceOverride) - round2(eUsed * (1 + rate))) <= 0.02) return null;
    }
    // No recorded average/rate (the export then writes F=E): fresh iff the
    // price follows its own average cell. This also covers stale margins —
    // the decision path preserves recorded margins anyway, so a deviating
    // manual intent cannot smuggle through here; only E-breaking values
    // surface as conflicts.
    if (
      row.avgOverride !== null &&
      row.avgOverride !== undefined &&
      Math.abs(toNum(row.priceOverride) - toNum(row.avgOverride)) <= 0.02
    )
      return null;
  }
  return round4(toNum(row.priceOverride) / (Number(row.unitFactor) > 0 ? Number(row.unitFactor) : 1));
}

/** Import row shape needed for sibling-conflict classification. */
export interface ImportConflictRow {
  avgOverride: number | null | undefined;
  priceOverride: number | null | undefined;
  unitId?: string;
  unitFactor?: number | null;
}

/** Conflict message for one import row against its same-product siblings, or
 *  null when clean. Average cells are NEVER compared: each file row shows a
 *  per-row estimate, while the approved average is always aggregated from all
 *  rows' quantities/costs — so disagreeing per-row values cannot block the
 *  import. Only genuinely manual selling prices are compared (via
 *  manualPriceBaseOf). Pure — the dialog delegates its per-row check to it. */
export function siblingRowConflict(
  product: Pick<Product, "cost_price" | "units">,
  row: ImportConflictRow,
  siblings: ImportConflictRow[],
): string | null {
  const full = product as Product;
  const priceMine = manualPriceBaseOf(full, row, siblings.length);
  for (const other of siblings) {
    if (other === row) continue;
    const otherPrice = manualPriceBaseOf(full, other, siblings.length);
    if (
      priceMine !== null &&
      otherPrice !== null &&
      Math.abs(priceMine - otherPrice) > 0.005
    )
      return "قيم سعر البيع مختلفة لنفس المنتج في الملف.";
  }
  return null;
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
  let s = round4(stock - takeQty);
  let costQty = 0;
  let costVal = 0;
  let plainQty = 0;
  for (const f of inflows) {
    if (f.cost === null || f.cost === undefined) {
      plainQty = round4(plainQty + f.qty);
    } else {
      costQty = round4(costQty + f.qty);
      costVal += f.qty * f.cost;
    }
  }
  let a = avg;
  if (costQty > 0) {
    a = s > 0
      ? movingAverageCost(s, a ?? 0, costQty, costVal / costQty)
      : costVal / costQty;
  }
  s = round4(s + costQty + plainQty);
  return { stock: s, avg: a };
}

/** Cash-movement requirements (atomicity invariants, tested pure):
 *  - A sale with paid > 0 MUST move cash; missing cashbox rejects the op.
 *  - An edit with any paid delta MUST move cash; missing cashbox rejects it.
 *  - A cash refund (returns) with amount > 0 requires an initialized cashbox. */
export function requiresCashForSale(paidAmount: unknown): boolean {
  return toNum(paidAmount) > 0;
}

export function requiresCashForEdit(paidDelta: unknown): boolean {
  return Math.abs(toNum(paidDelta)) > 1e-9;
}

export function requiresCashForRefund(cashRefund: unknown): boolean {
  return toNum(cashRefund) > 0;
}

/** Opening-balance idempotency guard (transactional): existence of the cashbox
 *  doc itself is the lock — client flags must never be the authority. */
export function openingBalanceAlreadyApplied(cashboxExists: boolean): boolean {
  return cashboxExists;
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

/** Explicit selling-price decision for a purchase (S2/S5).
 *  `approvedAverage` (base-unit terms, with the `averageBasis` snapshot it was
 *  derived from) lets a dialog hand the user an editable average cost: the
 *  transaction re-checks the snapshot against fresh reads and saves the
 *  approved value instead of recomputing the moving average. Absent = the
 *  transaction computes the canonical weighted average itself. */
export interface AverageOverride {
  approvedAverage?: number | null;
  averageBasis?: { stock: number; cost: number } | null;
}
export type PriceDecision =
  | ({ mode: "auto" | "keep" } & AverageOverride)
  | ({ mode: "proposed"; approvedProposed: number; price?: number } & AverageOverride)
  | ({ mode: "custom"; price: number; approvedProposed?: number | null } & AverageOverride);

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

export function splitCustomerReturn(refundValue: number, remainingDebt: number, creditUsed: number, creditRestoredBefore: number, cashRequested: number): { debtReduction: number; creditRestored: number; cashRefund: number; creditIssued: number; settlement: number } {
  const split = splitRefund(refundValue, remainingDebt);
  const creditRestored = round2(Math.min(split.cashRefund, Math.max(0, round2(creditUsed - creditRestoredBefore))));
  const settlement = round2(split.cashRefund - creditRestored);
  if (!Number.isFinite(cashRequested) || cashRequested < 0 || cashRequested - settlement > 0.005) throw new Error("Invalid cash refund amount.");
  const cashRefund = round2(cashRequested);
  return { debtReduction: split.debtReduction, creditRestored, cashRefund, creditIssued: round2(settlement - cashRefund), settlement };
}

export function allocateCustomerCredit(creditBalance: number, obligations: { id: string; type: "invoice" | "loan"; remaining: number; date: Date | null }[]): { type: "invoice" | "loan"; reference_id: string; amount: number }[] {
  let available = Math.max(0, round2(creditBalance));
  const allocations: { type: "invoice" | "loan"; reference_id: string; amount: number }[] = [];
  for (const item of [...obligations].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))) {
    if (available <= 0 || allocations.length >= 50) break;
    const amount = round2(Math.min(available, Math.max(0, round2(item.remaining))));
    if (amount <= 0) continue;
    allocations.push({ type: item.type, reference_id: item.id, amount });
    available = round2(available - amount);
  }
  return allocations;
}

export function splitSupplierReturn(returnValue: unknown, remainingPayable: unknown): { payableReduction: number; receivable: number } {
  const total = round2(returnValue);
  const payableReduction = round2(Math.min(Math.max(total, 0), Math.max(0, round2(remainingPayable))));
  return { payableReduction, receivable: round2(total - payableReduction) };
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
export interface EditStockChanges {
  lines: InvoiceProductLine[];
  takes: StockDelta[];
  restores: RestoreGroup[];
}

function lineCostGroups(line: InvoiceProductLine): { base_quantity: number; unit_cost: number }[] {
  if (Array.isArray(line.cost_groups) && line.cost_groups.length) {
    return line.cost_groups
      .map((group) => ({ base_quantity: round4(toNum(group.base_quantity)), unit_cost: toNum(group.unit_cost) }))
      .filter((group) => group.base_quantity > 0);
  }
  const quantity = lineBaseQuantity(line);
  return quantity > 0 ? [{
    base_quantity: quantity,
    unit_cost: toNum(line.base_cost_snapshot ?? line.product_cost_price),
  }] : [];
}

/** Build transaction-fresh invoice lines and per-cost stock effects. Existing cost groups
 * are retained from the front; removed quantity is restored newest-group-first. */
export function invoiceEditStockChanges(
  oldLines: InvoiceProductLine[],
  requestedLines: InvoiceProductLine[],
  currentCostByProduct: Map<string, number>,
): EditStockChanges {
  const oldById = new Map<string, number>();
  oldLines.forEach((line, index) => { if (line.line_id) oldById.set(line.line_id, index); });
  const usedOld = new Set<number>();
  const matched = new Map<number, number>();
  const lines = requestedLines.map((line, requestedIndex) => {
    let oldIndex = line.line_id ? oldById.get(line.line_id) : undefined;
    if (oldIndex !== undefined && oldLines[oldIndex]?.product_id !== line.product_id) oldIndex = undefined;
    if (oldIndex === undefined || usedOld.has(oldIndex)) {
      const productId = line.product_id ?? "";
      const candidates = oldLines.map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate, index }) => candidate.product_id === productId && !candidate.line_id && !usedOld.has(index));
      oldIndex = candidates[0]?.index;
    }
    const totalBaseQuantity = lineBaseQuantity(line);
    const currentCost = toNum(currentCostByProduct.get(line.product_id ?? ""));
    if (oldIndex === undefined || !line.product_id) {
      return {
        ...line,
        line_id: line.line_id || `edit-${requestedIndex}`,
        base_quantity: totalBaseQuantity,
        product_cost_price: currentCost,
        base_cost_snapshot: currentCost,
        cost_groups: totalBaseQuantity > 0 ? [{ base_quantity: totalBaseQuantity, unit_cost: currentCost }] : [],
      };
    }
    usedOld.add(oldIndex);
    matched.set(oldIndex, requestedIndex);
    const oldLine = oldLines[oldIndex]!;
    let keep = totalBaseQuantity;
    const retained: { base_quantity: number; unit_cost: number }[] = [];
    for (const group of lineCostGroups(oldLine)) {
      if (keep <= 1e-9) break;
      const quantity = Math.min(keep, group.base_quantity);
      if (quantity > 0) retained.push({ base_quantity: round4(quantity), unit_cost: group.unit_cost });
      keep = round4(keep - quantity);
    }
    if (keep > 1e-9) retained.push({ base_quantity: round4(keep), unit_cost: currentCost });
    const costTotal = retained.reduce((sum, group) => sum + group.base_quantity * group.unit_cost, 0);
    const averageCost = totalBaseQuantity > 0 ? costTotal / totalBaseQuantity : currentCost;
    return {
      ...line,
      line_id: oldLine.line_id || line.line_id || `edit-${requestedIndex}`,
      base_quantity: totalBaseQuantity,
      product_cost_price: averageCost,
      base_cost_snapshot: averageCost,
      cost_groups: retained,
    };
  });

  const restores: RestoreGroup[] = [];
  for (const [oldIndex, oldLine] of oldLines.entries()) {
    if (!oldLine.product_id) continue;
    const oldGroups = lineCostGroups(oldLine);
    const newIndex = matched.get(oldIndex);
    const retainedGroups = newIndex === undefined ? [] : lines[newIndex]?.cost_groups ?? [];
    const remainingRetained = retainedGroups.map((group) => ({ ...group }));
    const restoredGroups: { base_quantity: number; unit_cost: number }[] = [];
    for (const group of oldGroups) {
      let retained = 0;
      for (const keep of remainingRetained) {
        if (Math.abs(keep.unit_cost - group.unit_cost) > 1e-9) continue;
        const take = Math.min(group.base_quantity - retained, keep.base_quantity);
        retained += take;
        keep.base_quantity = round4(keep.base_quantity - take);
        if (retained >= group.base_quantity - 1e-9) break;
      }
      const restore = round4(group.base_quantity - retained);
      if (restore > 0) restoredGroups.push({ base_quantity: restore, unit_cost: group.unit_cost });
    }
    for (const group of restoredGroups.reverse()) {
      restores.push({
        product_id: oldLine.product_id,
        product_name: oldLine.product_name,
        qty: group.base_quantity,
        unit_cost: group.unit_cost,
        unit_id: oldLine.unit_id,
        unit_name: oldLine.unit_name,
        unit_factor: lineUnitFactor(oldLine),
      });
    }
  }

  const oldIndexByNew = new Map<number, number>();
  for (const [oldIndex, newIndex] of matched) oldIndexByNew.set(newIndex, oldIndex);
  const addedByProduct = new Map<string, number>();
  for (const [newIndex, line] of lines.entries()) {
    if (!line.product_id) continue;
    const oldIndex = oldIndexByNew.get(newIndex);
    const oldQuantity = oldIndex === undefined ? 0 : lineBaseQuantity(oldLines[oldIndex]!);
    const addedQuantity = Math.max(0, round4(lineBaseQuantity(line) - oldQuantity));
    if (addedQuantity > 0) addedByProduct.set(line.product_id, round4((addedByProduct.get(line.product_id) ?? 0) + addedQuantity));
  }
  const takes: StockDelta[] = [];
  for (const [productId, quantity] of addedByProduct) {
    const line = lines.find((candidate) => candidate.product_id === productId) ?? oldLines.find((candidate) => candidate.product_id === productId)!;
    takes.push({ product_id: productId, product_name: line.product_name, delta: -quantity, unit_cost: round4(toNum(currentCostByProduct.get(productId))) });
  }
  return { lines, takes, restores };
}

export function invoiceEditPaymentError(inv: Parameters<typeof invoiceTotals>[0]): string | null {
  const payable = invoiceTotals({ ...inv, paid_amount: 0 }).net;
  const paid = Number(inv.paid_amount ?? 0);
  if (!Number.isFinite(paid) || paid < 0) return "paid amount must be a valid non-negative number";
  if (paid - payable > 1e-9) return "paid amount cannot exceed invoice total";
  return null;
}

export function invoiceEditCustomerChangeError(oldCustomerId: string | null, newCustomerId: string | null, hasPaymentHistory: boolean): string | null {
  return oldCustomerId !== newCustomerId && hasPaymentHistory
    ? "customer cannot change after a debt payment"
    : null;
}

export function invoiceHasReturnHistory(
  hasReturnDocument: boolean,
  returnedBaseQuantity: unknown,
  returnStatus: unknown,
  returned: Record<string, unknown> | null | undefined,
): boolean {
  return hasReturnDocument
    || toNum(returnedBaseQuantity) > 0
    || (returnStatus !== undefined && returnStatus !== null && returnStatus !== "none")
    || Object.values(returned ?? {}).some((quantity) => toNum(quantity) > 0);
}

export function invoiceEditCashOutflowError(balance: unknown, outflow: unknown): string | null {
  return toNum(balance) + toNum(outflow) < -1e-9 ? "cashbox balance is insufficient" : null;
}
export function restoreGroupsForEdit(
  oldLines: Pick<InvoiceProductLine, "product_id" | "product_name" | "product_quantity" | "product_cost_price" | "unit_id" | "unit_name" | "unit_factor" | "base_quantity">[],
  newLines: Pick<InvoiceProductLine, "product_id" | "product_name" | "product_quantity" | "unit_factor" | "base_quantity">[],
): RestoreGroup[] {
  const oldTotal = new Map<string, number>();
  for (const l of oldLines) {
    if (!l.product_id) continue;
    oldTotal.set(l.product_id, round4((oldTotal.get(l.product_id) ?? 0) + lineBaseQuantity(l)));
  }
  const newTotal = new Map<string, number>();
  for (const l of newLines) {
    if (!l.product_id) continue;
    newTotal.set(l.product_id, round4((newTotal.get(l.product_id) ?? 0) + lineBaseQuantity(l)));
  }
  const out: RestoreGroup[] = [];
  for (const [pid, oldQty] of oldTotal) {
    let need = round4(oldQty - (newTotal.get(pid) ?? 0));
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
        qty: round4(take),
        unit_cost: toNum(l.product_cost_price),
        unit_id: l.unit_id,
        unit_name: l.unit_name,
        unit_factor: lineUnitFactor(l),
      });
      need = round4(need - take);
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
    const delta = round4((o.get(id)?.qty ?? 0) - (n.get(id)?.qty ?? 0));
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

/** Inventory aggregates for the cashbox dashboard — canonical base model.
 *  - costValue: Σ base stock × base average cost (reliable accounting value).
 *  - saleValue: Σ base stock × base-equivalent selling price (forecast).
 *    Base-equivalent price = base unit price when sellable, else first
 *    sellable unit's price ÷ factor. Products with multiple sale units may
 *    realize different prices — this is an expectation, not realized sales. */
export function inventoryAggregates(products: Pick<Product, "stock_quantity" | "cost_price" | "units">[]): {
  costValue: number;
  saleValue: number;
  expectedProfit: number;
} {
  let cost = 0;
  let sale = 0;
  let saleCost = 0;
  for (const p of products) {
    const full = p as Product;
    const stock = toNum(full.stock_quantity);
    const avg = toNum(full.cost_price);
    cost += stock * avg;
    const basePrice = baseEquivalentSellingPrice(full);
    if (basePrice !== null && basePrice > 0) {
      sale += stock * basePrice;
      saleCost += stock * avg;
    }
  }
  cost = round2(cost);
  sale = round2(sale);
  return { costValue: cost, saleValue: sale, expectedProfit: round2(sale - saleCost) };
}

/** Base-equivalent selling price: base unit price if sellable, else first
 *  sellable unit's price converted to base terms (price ÷ factor). */
export function baseEquivalentSellingPrice(product: Product): number | null {
  const units = unitsForProduct(product);
  const base = baseUnitOf(product);
  if (base && base.can_sell !== false && base.selling_price !== null && base.selling_price !== undefined && toNum(base.selling_price) > 0) {
    return toNum(base.selling_price);
  }
  for (const u of units) {
    if (u.can_sell === false) continue;
    if (u.selling_price === null || u.selling_price === undefined || !(toNum(u.selling_price) > 0)) continue;
    const f = Number(u.factor);
    if (!Number.isFinite(f) || f <= 0) continue;
    return toNum(u.selling_price) / f;
  }
  return null;
}

export function inventoryDataIssues(products: Product[]): { valuation: number; forecast: number } {
  let valuation = 0;
  let forecast = 0;
  for (const product of products) {
    const stock = product.stock_quantity;
    const missingStock = stock === null || stock === undefined || !Number.isFinite(Number(stock));
    const missingCost = product.cost_price === null || product.cost_price === undefined || !Number.isFinite(Number(product.cost_price));
    if (missingStock || (toNum(stock) !== 0 && missingCost)) valuation++;
    if (product.is_active !== false && toNum(stock) > 0 && (baseEquivalentSellingPrice(product) === null || missingCost)) forecast++;
  }
  return { valuation, forecast };
}

/** Normalize a phone to digits only (migration matching). */
export function normalizePhone(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/** Loose-stock threshold in base-unit terms. Zero disables this component's alert. */
export function lowStockThresholdOf(product: Pick<Product, "inventory_alerts">): number {
  const value = Number(product.inventory_alerts?.loose?.reorder_point ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Loose-stock target level in base-unit terms. */
export function targetStockLevelOf(product: Pick<Product, "inventory_alerts">): number | null {
  const value = product.inventory_alerts?.loose?.target_level;
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

/** Cap for the per-unit purchase-price history log. */
export const MAX_PURCHASE_PRICE_HISTORY = 20;

export interface PurchasePriceRecord { price: number; at: number }

/** Parse a unit's purchase-price history log (`"price-ts,price-ts,..."`,
 *  latest first) into records. Anything malformed is skipped. */
export function parsePurchasePriceHistory(history: unknown): PurchasePriceRecord[] {
  if (typeof history !== "string" || !history.trim()) return [];
  const out: PurchasePriceRecord[] = [];
  for (const chunk of history.split(",")) {
    const [priceRaw, atRaw] = chunk.split("-");
    const price = Number((priceRaw ?? "").trim());
    const at = Number((atRaw ?? "").trim());
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(at) || at <= 0) continue;
    out.push({ price: round4(price), at: Math.floor(at) });
  }
  return out;
}

/** Prepend a purchase price to the history log (latest first), keeping the
 *  log bounded. The numeric `purchase_price` mirror stays untouched here. */
export function prependPurchasePriceHistory(existing: unknown, price: number, at: number, cap: number = MAX_PURCHASE_PRICE_HISTORY): string {
  const records = parsePurchasePriceHistory(existing);
  records.unshift({ price: round4(toNum(price)), at: Math.floor(toNum(at)) });
  return records
    .filter((r) => Number.isFinite(r.price) && r.price >= 0 && Number.isFinite(r.at) && r.at > 0)
    .slice(0, Math.max(1, Math.floor(cap)))
    .map((r) => `${r.price}-${r.at}`)
    .join(",");
}

/** True when at least one component has an enabled shortage rule. */
export function hasShortageAlert(product: Pick<Product, "inventory_alerts">): boolean {
  const value = product as Product;
  const loose = lowStockThresholdOf(value) > 0;
  const packages = Object.values(value.inventory_alerts?.packages || {}).some((rule) => toNum(rule.reorder_point) > 0);
  return loose || packages;
}

/** One shortage row per physical inventory component. */
export interface ShortageUnit {
  product: Product;
  unit: ProductUnit;
  bucket: "loose" | "package";
  key: string;
  current: number;
  reorder_point: number;
  target_level: number | null;
}

/** Units with an active component alert. */
export function shortageDisplayUnitsOf(product: Product): ProductUnit[] {
  const rows = lowStockComponents(product as never);
  return rows.map((row) => row.bucket === "package"
    ? unitsForProduct(product).find((unit) => unit.id === row.unit_id)!
    : baseUnitOf(product));
}

/** Every low-stock product — THE single source for the dialog table, its
 *  Excel export, and the shortage count, so all three always agree.
 *  Counts are per product, never duplicated per unit. */
export function shortageUnitRowsOf(products: Product[]): ShortageUnit[] {
  return products
    .filter((product) => product.is_active !== false)
    .flatMap((product) => lowStockComponents(product as never).flatMap((component) => {
      const unit = component.bucket === "package"
        ? unitsForProduct(product).find((entry) => entry.id === component.unit_id)
        : baseUnitOf(product);
      if (!unit) return [];
      return [{
        product,
        unit,
        bucket: component.bucket,
        key: `${product.id || product.name}:${component.bucket}:${component.unit_id || "loose"}`,
        current: component.current,
        reorder_point: component.reorder_point,
        target_level: component.target_level,
      }];
    }))
    .sort((a, b) => a.current - b.current || a.product.name.localeCompare(b.product.name) || a.unit.name.localeCompare(b.unit.name));
}

/** A product is low when at least one physical component is below its own point. */
export function isLowStock(p: Pick<Product, "inventory" | "inventory_alerts" | "units" | "is_active">): boolean {
  if ((p as { is_active?: unknown }).is_active === false) return false;
  return lowStockComponents(p as never).length > 0;
}

export function isOutOfStock(p: Pick<Product, "stock_quantity" | "is_active">): boolean {
  if ((p as { is_active?: unknown }).is_active === false) return false;
  if (p.stock_quantity === null || p.stock_quantity === undefined || !Number.isFinite(Number(p.stock_quantity))) return false;
  return toNum((p as Product).stock_quantity) <= 0;
}

export function isNegativeStock(p: Pick<Product, "stock_quantity" | "is_active">): boolean {
  if ((p as { is_active?: unknown }).is_active === false) return false;
  if (p.stock_quantity === null || p.stock_quantity === undefined || !Number.isFinite(Number(p.stock_quantity))) return false;
  return toNum((p as Product).stock_quantity) < -1e-9;
}

/** Human display of the reorder point in base-unit terms. Math stays base. */
export function thresholdDisplayOf(p: Pick<Product, "inventory_alerts" | "base_unit_name" | "units">): string {
  const base = lowStockThresholdOf(p);
  const unit = unitsForProduct(p as Product).find((entry) => entry.is_base) ?? unitsForProduct(p as Product)[0];
  return `${String(round4(base))} ${unit?.name || p.base_unit_name || "وحدة"}`;
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
  allocateSupplierCash,
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
  splitCustomerReturn,
  stockDeltaForEdit,
  restoreGroupsForEdit,
  loanStatusOf,
  proposedSellingPrice,
  MAX_PURCHASE_ITEMS,
  estimatePurchaseOps,
  inventoryAggregates,
  baseEquivalentSellingPrice,
  inventoryDataIssues,
  normalizePhone,
  normalizeName,
  lowStockThresholdOf,
  targetStockLevelOf,
  thresholdDisplayOf,
  hasShortageAlert,
  shortageDisplayUnitsOf,
  shortageUnitRowsOf,
  shortageAvgFormula,
  manualPriceBaseOf,
  orderMarginRate,
  siblingRowConflict,
  MAX_PURCHASE_PRICE_HISTORY,
  parsePurchasePriceHistory,
  prependPurchasePriceHistory,
  isLowStock,
  isOutOfStock,
  isNegativeStock,
  lineBaseQuantity,
  lineUnitFactor,
  unitsForProduct,
  purchasableUnitsForProduct,
  sellableUnitsForProduct,
  unitSellingPrice,
  unitPurchasePrice,
  unitAverageCost,
  unitStockDisplay,
  stockQuantityLabel,
  convertUnitPrice,
  toBaseQuantity,
  toUnitQuantity,
  getBaseUnitCost,
  getUnitAverageCost,
  selectedUnitAverageCost,
  isBelowUnitCost,
  getLineRevenue,
  getLineCost,
  getLineProfit,
  discountShareOf,
  lineNetRevenue,
  merchandiseProfitOf,
  getInvoiceBreakdown,
  getInvoiceSalesTotal,
  getInvoicePayableTotal,
  purchaseLineBaseQuantity,
  purchaseLineBaseCost,
  purchasePreviewAverage,
  previewBasePurchase,
  aggregatePurchaseByProduct,
  purchaseUnitProposals,
  baseUnitOf,
  findUnit,
  isValidFactor,
  validateUnitFactor,
  validateUnitQuantity,
  decomposeStock,
  requiresCashForSale,
  requiresCashForEdit,
  requiresCashForRefund,
  openingBalanceAlreadyApplied,
});
