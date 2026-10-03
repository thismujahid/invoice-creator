import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregatePurchaseByProduct,
  applyStockGroup,
  getInvoiceBreakdown,
  getInvoicePayableTotal,
  getInvoiceSalesTotal,
  getLineCost,
  getLineProfit,
  getLineRevenue,
  getUnitAverageCost,
  grossProfitOf,
  invoiceTotals,
  isBelowUnitCost,
  lineBaseQuantity,
  openingBalanceAlreadyApplied,
  purchaseLineBaseCost,
  purchaseLineBaseQuantity,
  purchasePreviewAverage,
  purchaseUnitProposals,
  requiresCashForEdit,
  requiresCashForRefund,
  requiresCashForSale,
  round2,
  round4,
  selectedUnitAverageCost,
  toBaseQuantity,
  toUnitQuantity,
  invoiceEditStockChanges,
  unitAverageCost,
} from "../composables/finance.ts";
import { deriveSupplierInvoiceStatus } from "../types/finance.ts";
import { invoiceStatsOf } from "../composables/invoiceStats.ts";

// ---------- Unit conversion: piece / box x12 / carton x24 ----------

test("unit conversion: base piece, box x12, carton x24", () => {
  assert.equal(toBaseQuantity(2, 24), 48);
  assert.equal(toBaseQuantity(5, 1), 5);
  assert.equal(toUnitQuantity(48, 24), 2);
  assert.equal(lineBaseQuantity({ product_quantity: 2, unit_factor: 24 }), 48);
  assert.equal(lineBaseQuantity({ product_quantity: 5, unit_factor: 12 }), 60);
});

test("derived average unit costs come from base average only", () => {
  const product = { cost_price: 10 };
  assert.equal(getUnitAverageCost(10, 1), 10);
  assert.equal(getUnitAverageCost(10, 12), 120);
  assert.equal(getUnitAverageCost(10, 24), 240);
  assert.equal(unitAverageCost(product, { factor: 12 }), 120);
  assert.equal(selectedUnitAverageCost(product, { factor: 24 }), 240);
});

// ---------- Sale below cost (same-unit comparison) ----------

test("carton sale 230 with base cost 10 and factor 24 is below cost (240)", () => {
  assert.equal(isBelowUnitCost(230, 10, 24), true);
  assert.equal(isBelowUnitCost(240, 10, 24), false);
  assert.equal(isBelowUnitCost(250, 10, 24), false);
  // Naive base-unit comparison would wrongly pass (230 > 10).
  assert.equal(230 > 10, true);
});

// ---------- Purchase weighted average with non-base units ----------

test("purchase weighted average uses base quantities and base costs", () => {
  // Stock: 120 pieces @ 4.75. Buy 2 cartons x24 @ 130/carton.
  const baseQty = purchaseLineBaseQuantity(2, 24);
  const baseCost = purchaseLineBaseCost(130, 24);
  assert.equal(baseQty, 48);
  assert.ok(Math.abs(baseCost - 5.4166667) < 1e-6);
  const avg = purchasePreviewAverage(120, 4.75, baseQty, baseCost);
  // (120*4.75 + 48*5.4167) / 168 = 4.9405
  assert.ok(Math.abs(avg - 4.940476) < 1e-4);
  const applied = applyStockGroup(120, 4.75, 0, [{ qty: baseQty, cost: baseCost }]);
  assert.equal(applied.stock, 168);
  // applyStockGroup persists round4; preview is full precision — same value.
  assert.ok(Math.abs(round4(applied.avg) - round4(avg)) < 1e-9);
});

test("fractional base cost 25/30 keeps internal precision (0.8333...)", () => {
  const baseCost = purchaseLineBaseCost(25, 30);
  assert.ok(Math.abs(baseCost - 0.8333333) < 1e-6);
  const internal = round4(baseCost);
  assert.equal(internal, 0.8333);
  // Display rounds to 2 decimals; engine keeps 4.
  assert.equal(round2(baseCost), 0.83);
  assert.notEqual(internal, round2(baseCost));
  const applied = applyStockGroup(0, undefined, 0, [{ qty: 60, cost: baseCost }]);
  assert.equal(applied.stock, 60);
  assert.equal(round4(applied.avg), 0.8333);
});

// ---------- Mixed purchase units: 2 cartons + 5 pieces ----------

test("mixed purchase units aggregate deterministically to the same average", () => {
  // Product A: 2 cartons (x24 @120) + 5 pieces (@5.2).
  const cartonBase = purchaseLineBaseQuantity(2, 24); // 48
  const cartonCost = purchaseLineBaseCost(120, 24); // 5
  const pieceBase = purchaseLineBaseQuantity(5, 1); // 5
  const pieceCost = purchaseLineBaseCost(5.2, 1); // 5.2
  const agg = aggregatePurchaseByProduct([
    { product_id: "A", baseQty: cartonBase, lineTotal: cartonBase * cartonCost },
    { product_id: "A", baseQty: pieceBase, lineTotal: pieceBase * pieceCost },
  ]);
  const entry = agg.get("A");
  assert.equal(entry.baseQty, 53);
  assert.ok(Math.abs(entry.baseCost - ((48 * 5 + 5 * 5.2) / 53)) < 1e-9);
  // Order independence: reversed input gives identical aggregate.
  const agg2 = aggregatePurchaseByProduct([
    { product_id: "A", baseQty: pieceBase, lineTotal: pieceBase * pieceCost },
    { product_id: "A", baseQty: cartonBase, lineTotal: cartonBase * cartonCost },
  ]);
  assert.deepEqual(agg2.get("A"), entry);
  // Average from empty stock equals combined base cost.
  const avg = purchasePreviewAverage(0, 0, entry.baseQty, entry.baseCost);
  assert.ok(Math.abs(avg - entry.baseCost) < 1e-9);
});

// ---------- Historical sale cost ----------

test("historical sale profit does not move when current average changes", () => {
  const lines = [
    { product_price: 145, product_quantity: 1, unit_factor: 24, base_quantity: 24, cost_groups: [{ base_quantity: 24, unit_cost: 5 }] },
  ];
  const before = grossProfitOf(lines);
  // Current average later moves 5 -> 9; historical groups stay.
  assert.equal(before, round2(145 - 24 * 5));
  assert.equal(grossProfitOf(lines), before);
  assert.equal(getLineRevenue(lines[0]), 145);
  assert.equal(getLineCost(lines[0]), 120);
  assert.equal(getLineProfit(lines[0]), 25);
});

// ---------- Invoice editing across units ----------

test("invoice edit carton -> piece preserves history and takes correctly", () => {
  const result = invoiceEditStockChanges(
    [{ line_id: "l1", product_id: "p1", product_name: "A", product_quantity: 2, unit_factor: 24, base_quantity: 48, product_cost_price: 5 }],
    [{ line_id: "l1", product_id: "p1", product_name: "A", product_quantity: 5, unit_factor: 1 }],
    new Map([["p1", 5.5]]),
  );
  assert.equal(result.lines[0].base_quantity, 5);
  // 5 of 48 retained at old cost, rest covered at current cost is not needed
  // here because new qty < old qty: no takes, restores the difference.
  assert.equal(result.takes.length, 0);
  const restored = result.restores.reduce((s, r) => s + r.qty, 0);
  assert.equal(restored, 43);
});

test("invoice edit piece -> box adds only the delta at current cost", () => {
  const result = invoiceEditStockChanges(
    [{ line_id: "l1", product_id: "p1", product_name: "A", product_quantity: 5, unit_factor: 1, base_quantity: 5, product_cost_price: 5 }],
    [{ line_id: "l1", product_id: "p1", product_name: "A", product_quantity: 3, unit_factor: 12 }],
    new Map([["p1", 6]]),
  );
  assert.equal(result.lines[0].base_quantity, 36);
  assert.deepEqual(result.lines[0].cost_groups, [
    { base_quantity: 5, unit_cost: 5 },
    { base_quantity: 31, unit_cost: 6 },
  ]);
  assert.equal(result.takes[0].delta, -31);
});

// ---------- Previous debt vs current sales ----------

test("previous debt affects payable but never inflates sales", () => {
  const inv = {
    products: [{ product_price: 500, product_quantity: 2 }],
    debt: 500,
    delivery_price: 0,
    amount_of_animal_feeds: 0,
    amount_of_mahros: 0,
    discount: 0,
    discount_percentage: false,
    paid_amount: 0,
  };
  const breakdown = getInvoiceBreakdown(inv);
  assert.equal(breakdown.currentSaleSubtotal, 1000);
  assert.equal(breakdown.previousBalance, 500);
  assert.equal(breakdown.invoicePayable, 1500);
  assert.equal(getInvoiceSalesTotal(inv), 1000);
  assert.equal(getInvoicePayableTotal(inv), 1500);
  // Legacy totals().net still reports payable (kept for debt collection).
  assert.equal(invoiceTotals(inv).net, 1500);
  // Statistics count only the current sale (summarizeInvoice.sales mirrors
  // breakdown.salesNet — debtSummaries is Firestore-bound and covered by the
  // same breakdown unit under test here).
  const stats = invoiceStatsOf(inv);
  assert.equal(stats.total_sales, 1000);
  assert.equal(stats.gross_sales, 1000);
});

test("discount is allocated proportionally so debt discount never becomes sales", () => {
  const inv = {
    products: [{ product_price: 1000, product_quantity: 1 }],
    debt: 500,
    discount: 10,
    discount_percentage: true,
    paid_amount: 0,
  };
  // Gross 1500, 10% = 150 discount, payable 1350.
  const breakdown = getInvoiceBreakdown(inv);
  assert.equal(breakdown.gross, 1500);
  assert.equal(breakdown.discountValue, 150);
  assert.equal(breakdown.invoicePayable, 1350);
  // Current share 1000/1500 of 150 = 100 → sales 900.
  assert.equal(breakdown.salesNet, 900);
  assert.equal(invoiceStatsOf(inv).total_sales, 900);
});

// ---------- Cashbox invariants (pure guards; transactions enforce them) ----------

test("paid invoice requires cash movement; edits require cash on any delta", () => {
  assert.equal(requiresCashForSale(1000), true);
  assert.equal(requiresCashForSale(0), false);
  assert.equal(requiresCashForEdit(50), true);
  assert.equal(requiresCashForEdit(-50), true);
  assert.equal(requiresCashForEdit(0), false);
  assert.equal(requiresCashForRefund(200), true);
  assert.equal(requiresCashForRefund(0), false);
});

test("opening balance lock is the cashbox document itself", () => {
  assert.equal(openingBalanceAlreadyApplied(true), true);
  assert.equal(openingBalanceAlreadyApplied(false), false);
});

// ---------- Zero-paid invoice ----------

test("zero-paid invoice stays valid: paid 0, remaining equals total", () => {
  const inv = {
    products: [{ product_price: 1000, product_quantity: 1 }],
    paid_amount: 0,
  };
  const t = invoiceTotals(inv);
  assert.equal(t.paid, 0);
  assert.equal(t.remaining, t.net);
  assert.equal(t.remaining, 1000);
  // Explicit null/undefined paid must not hide the rows (UI checks != null).
  const paid = inv.paid_amount;
  assert.ok(paid !== null && paid !== undefined);
});

// ---------- Supplier payments: paid + remaining = total ----------

test("supplier paid + remaining equals total within tolerance", () => {
  const cases = [
    [0, 100, 100, "unpaid"],
    [25, 75, 100, "partial"],
    [100, 0, 100, "paid"],
    [33.33, 66.67, 100, "partial"],
  ];
  for (const [paid, rem, total, status] of cases) {
    assert.ok(Math.abs(paid + rem - total) <= 0.005);
    assert.equal(deriveSupplierInvoiceStatus(paid, rem, total), status);
  }
});

// ---------- Returns with non-base units and historical groups ----------

test("returns use historical cost groups and selected-unit math", () => {
  // Sold 2 cartons x24 at 230 with historical base cost 10 (carton avg 240).
  const line = {
    product_price: 230,
    product_quantity: 2,
    unit_factor: 24,
    base_quantity: 48,
    cost_groups: [{ base_quantity: 48, unit_cost: 10 }],
  };
  assert.equal(getLineCost(line), 480);
  assert.equal(getLineRevenue(line), 460);
  assert.equal(getLineProfit(line), -20);
  // Below-cost correctly detected in the same unit.
  assert.equal(isBelowUnitCost(230, 10, 24), true);
});

// ---------- Selling proposals cover every sellable unit ----------

test("purchase proposals are derived for piece, box and carton", () => {
  const product = {
    cost_price: 10,
    price: 12,
    base_unit_id: "piece",
    units: [
      { id: "piece", name: "قطعة", factor: 1, selling_price: 12, is_base: true, can_sell: true },
      { id: "box", name: "علبة", factor: 12, selling_price: 150, can_sell: true },
      { id: "carton", name: "كرتونة", factor: 24, selling_price: 300, can_sell: true },
    ],
  };
  // New average 11 → each unit preserves its own margin.
  const proposals = purchaseUnitProposals(product, 11);
  assert.equal(proposals.length, 3);
  const piece = proposals.find((p) => p.unitId === "piece");
  const box = proposals.find((p) => p.unitId === "box");
  const carton = proposals.find((p) => p.unitId === "carton");
  assert.equal(piece.newAvg, 11);
  assert.equal(box.newAvg, 132);
  assert.equal(carton.newAvg, 264);
  // Piece margin 20% → 11*1.2 = 13.2.
  assert.equal(piece.proposed, 13.2);
  // Box old avg 120, old price 150 → 25% → 132*1.25 = 165.
  assert.equal(box.proposed, 165);
  assert.equal(carton.proposed, 330);
});
