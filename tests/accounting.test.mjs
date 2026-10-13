import test from "node:test";
import assert from "node:assert/strict";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { ref, computed, watch, nextTick } from "vue";
import * as purchaseMath from "../composables/finance.ts";
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
  unitStockDisplay,
  stockQuantityLabel,
  sellableUnitsForProduct,
  purchasableUnitsForProduct,
  purchaseImportPreview,
  applyUnitPurchase,
  inventoryAggregates,
  inventoryDataIssues,
} from "../composables/finance.ts";
import { deriveSupplierInvoiceStatus } from "../types/finance.ts";
import { invoiceStatsOf } from "../composables/invoiceStats.ts";
const { safeProduct, saleAmounts, splitCustomerReturn } = createRequire(import.meta.url)("../functions/staffMath.cjs");

test("server return settlement preserves cash and customer credit separately", () => {
  assert.deepEqual(splitCustomerReturn(80, 20, 30, 0, 10), { debtReduction: 20, creditRestored: 30, cashRefund: 10, creditIssued: 20, settlement: 30 });
  assert.throws(() => splitCustomerReturn(20, 0, 0, 0, 21));
});

test("cashier catalog excludes cost and purchase prices", () => {
  const product = safeProduct("p1", {
    name: "مرقة دجاج", price: 1, cost_price: 0.7, stock_quantity: 99,
    units: [
      { id: "cube", name: "مكعب", factor: 1, selling_price: 1, purchase_price: 0.7, average_cost: 0.6, stock_quantity: 9, low_stock_threshold: 3, is_base: true },
      { id: "box", name: "علبة", factor: 30, selling_price: 43, purchase_price: 25, average_cost: 24, stock_quantity: 2.25, allows_fractional: true },
    ],
  });
  assert.equal(product.units[0].selling_price, 1);
  assert.equal(product.units[1].selling_price, 43);
  assert.equal(product.stock_quantity, 99);
  assert.equal(JSON.stringify(product).includes("cost_price"), false);
  assert.equal(JSON.stringify(product).includes("purchase_price"), false);
  assert.equal(JSON.stringify(product).includes("average_cost"), false);
  assert.equal(product.units[0].stock_quantity, 9);
  assert.equal(product.units[0].low_stock_threshold, 3);
  assert.equal(product.units[1].stock_quantity, 2.25);
  assert.equal(product.units[1].allows_fractional, true);
});

test("server sale accounting matches invoice stats with units, old debt and discount", () => {
  const lines = [
    { product_price: 43, product_quantity: 2, base_quantity: 60, product_cost_price: 0.8333 },
    { product_price: 1, product_quantity: 3, base_quantity: 3, product_cost_price: 0.8333 },
  ];
  const amounts = saleAmounts(lines, { previous: 20, delivery: 5, feeds: 0, mahros: 0, discount: 10, discountPercentage: false, paid: 50 });
  const invoice = {
    products: lines.map((line) => ({ ...line, cost_groups: [{ base_quantity: line.base_quantity, unit_cost: line.product_cost_price }] })),
    debt: 20, delivery_price: 5, discount: 10, discount_percentage: false, paid_amount: 50,
  };
  const expected = invoiceStatsOf(invoice);
  assert.equal(amounts.sales, expected.total_sales);
  assert.equal(amounts.cost, expected.total_cost);
  assert.equal(amounts.profit, expected.total_profit);
  assert.equal(amounts.remaining, expected.outstanding_customer_debt);
});

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

test("unit balances and moving averages remain independent", () => {
  const product = {
    units: [
      { id: "kg", name: "كيلو", factor: 1, stock_quantity: 2, average_cost: 40, selling_price: 55, purchase_price: 40, can_sell: true, can_purchase: true, allows_fractional: true },
      { id: "quarter", name: "ربع", factor: 1, stock_quantity: 5, average_cost: 12, selling_price: 18, purchase_price: 12, can_sell: true, can_purchase: true },
      { id: "eighth", name: "ثمن", factor: 1, stock_quantity: 3, average_cost: 7, selling_price: 0, purchase_price: 0, can_sell: true, can_purchase: true },
    ],
  };
  assert.equal(unitStockDisplay(product, product.units[0]), 2);
  assert.equal(unitAverageCost(product, product.units[1]), 12);
  assert.equal(stockQuantityLabel(product), "2 كيلو و 5 ربع و 3 ثمن");
  assert.deepEqual(sellableUnitsForProduct(product).map((unit) => unit.id), ["kg", "quarter"]);
  assert.deepEqual(purchasableUnitsForProduct(product).map((unit) => unit.id), ["kg", "quarter"]);
  const afterPurchase = applyStockGroup(2, 40, 0, [{ qty: 2, cost: 50 }]);
  assert.deepEqual(afterPurchase, { stock: 4, avg: 45 });
  const afterSale = applyStockGroup(afterPurchase.stock, afterPurchase.avg, 0.25, []);
  assert.deepEqual(afterSale, { stock: 3.75, avg: 45 });
});

test("Excel import keeps eighth and quarter selling prices on their own units", () => {
  const units = [
    { id: "eighth", name: "ثمن", factor: 125, stock_quantity: 0, average_cost: 0, purchase_price: 8.5, selling_price: 10, can_purchase: true, can_sell: true },
    { id: "quarter", name: "ربع", factor: 250, stock_quantity: 0, average_cost: 0, purchase_price: 49.75, selling_price: 50, can_purchase: true, can_sell: true },
  ];
  const rows = [{ quantity: 10, cost: 8.5, price: 10 }, { quantity: 10, cost: 49.75, price: 50 }];
  const saved = units.map((unit, index) => {
    const row = rows[index];
    const preview = purchaseImportPreview(unit, row.quantity, row.cost, row.price);
    const result = applyUnitPurchase(unit, row.quantity, row.cost, preview.pricing);
    assert.equal(result.average_cost, preview.average);
    assert.equal(result.selling_price, preview.sellingPrice);
    return result;
  });
  assert.deepEqual(saved.map((unit) => unit.average_cost), [8.5, 49.75]);
  assert.deepEqual(saved.map((unit) => unit.selling_price), [10, 50]);
  assert.deepEqual(saved.map((unit) => unit.stock_quantity), [10, 10]);
  assert.equal(rows.reduce((sum, row) => sum + row.quantity * row.cost, 0), 582.5);
  assert.equal(units[0].stock_quantity, 0);
});

test("Excel formula previews recalculate by unit and manual prices remain authoritative", () => {
  const unit = { id: "kg", name: "كيلو", factor: 1000, stock_quantity: 10, average_cost: 40, selling_price: 60, purchase_price: 50, allows_fractional: true };
  const preview = purchaseImportPreview(unit, 10, 50, null);
  assert.equal(preview.average, 45);
  assert.equal(preview.sellingPrice, 67.5);
  assert.equal(purchaseImportPreview(unit, 10, 50, 70).sellingPrice, 70);
  const saved = applyUnitPurchase(unit, 0.25, 50, { mode: "keep" });
  assert.equal(saved.stock_quantity, 10.25);
  assert.equal(saved.average_cost, 40.2439);
  const withoutPriceColumns = applyUnitPurchase(unit, 10, 50, { mode: "keep", approvedAverage: 999 });
  assert.equal(withoutPriceColumns.average_cost, 45);
  assert.equal(withoutPriceColumns.selling_price, 60);
  assert.throws(() => applyUnitPurchase({ ...unit, allows_fractional: false }, 0.25, 50, { mode: "keep" }));
  assert.throws(() => applyUnitPurchase(unit, 1, NaN, { mode: "keep" }));
  assert.throws(() => applyUnitPurchase(unit, 1, 50, { mode: "custom", price: NaN }));
});

test("Excel purchase transaction saves separate unit prices and retry does not charge cash again", async () => {
  const records = new Map([
    ["products/tea", { name: "شاي العروسة", units: [
      { id: "eighth", name: "ثمن", factor: 125, stock_quantity: 0, average_cost: 0, purchase_price: 8.5, selling_price: 10 },
      { id: "quarter", name: "ربع", factor: 250, stock_quantity: 0, average_cost: 0, purchase_price: 49.75, selling_price: 50 },
    ] }],
    ["cashbox/current", { balance: 1000 }],
  ]);
  let nextId = 0;
  const cachedCashbox = { balance: 1000 };
  const collection = (_db, path) => ({ path });
  const doc = (...args) => {
    const path = args.length === 3 ? `${args[1]}/${args[2]}` : `${args[0].path}/generated-${++nextId}`;
    return { path, id: path.split("/").at(-1) };
  };
  const dependencies = {
    ...purchaseMath,
    collection,
    doc,
    deriveSupplierInvoiceStatus,
    defineStore: (_id, factory) => factory(),
    useFirebase: () => ({ db: {}, serverTimestamp: () => 123 }),
    useAuth: () => ({ currentUserKey: "admin" }),
    useProductsStore: () => ({ upsertCached: () => {} }),
    useCashbox: () => cachedCashbox,
    writeSupplierSummaryDelta: () => {},
    runTx: async (callback) => {
      const writes = [];
      await callback({
        get: async (ref) => ({ id: ref.id, ref, exists: () => records.has(ref.path), data: () => structuredClone(records.get(ref.path)) }),
        set: (ref, data, options) => writes.push({ ref, data, options }),
      });
      for (const { ref, data, options } of writes) records.set(ref.path, structuredClone(options?.merge ? { ...records.get(ref.path), ...data } : data));
    },
  };
  const source = readFileSync(new URL("../composables/usePurchasing.ts", import.meta.url), "utf8");
  const storeSource = source.slice(source.indexOf("export const usePurchasing")).replace("export const", "const");
  const factory = new Function(...Object.keys(dependencies), stripTypeScriptTypes(storeSource) + "\nreturn usePurchasing;");
  const store = factory(...Object.values(dependencies));
  const input = {
    idempotencyKey: "excel-unit-test", supplier_id: "supplier", supplier_name: "مورد", source: "excel_import", paidNow: 582.5,
    items: records.get("products/tea").units.map((unit) => ({
      product_id: "tea", unit_id: unit.id, quantity: 10, unit_cost: unit.purchase_price,
      pricing: { mode: "keep", approvedAverage: 999 },
    })),
  };
  assert.equal((await store.executePurchase(input)).ok, true);
  assert.deepEqual(records.get("products/tea").units.map((unit) => unit.selling_price), [10, 50]);
  assert.deepEqual(records.get("products/tea").units.map((unit) => unit.average_cost), [8.5, 49.75]);
  assert.deepEqual(records.get("products/tea").units.map((unit) => unit.stock_quantity), [10, 10]);
  assert.equal(records.get("purchase_invoices/excel-unit-test").total_amount, 582.5);
  assert.equal(cachedCashbox.balance, 417.5);
  assert.equal((await store.executePurchase(input)).duplicate, true);
  assert.equal(cachedCashbox.balance, 417.5);
  assert.equal(records.get("cashbox/current").balance, 417.5);
  assert.equal((await store.executePurchase({ ...input, paidNow: 100 })).ok, false);
  const staleItems = input.items.map((item) => ({ ...item, pricing: { mode: "keep", averageBasis: { stock: 0, cost: 0 } } }));
  assert.equal((await store.executePurchase({ ...input, items: staleItems, idempotencyKey: "stale", paidNow: 0 })).ok, false);
  assert.equal(records.has("purchase_invoices/stale"), false);
});

test("product editing loads actual unit names and preserves balances when renaming or deleting a unit", async () => {
  const product = { id: "tea", name: "شاي", units: [
    { id: "eighth", name: "ثمن", factor: 1, stock_quantity: 10, average_cost: 8.5, selling_price: 10, purchase_price: 9 },
    { id: "quarter", name: "ربع", factor: 1, stock_quantity: 3, average_cost: 49.75, selling_price: 50, purchase_price: 50 },
  ] };
  let saved;
  const dependencies = {
    ref, computed,
    defineProps: () => ({ edit: structuredClone(product), refresher: async () => {} }),
    defineEmits: () => () => {},
    useProductsStore: () => ({ list: [], updateProduct: async (_id, data) => { saved = data; } }),
    useAuth: () => ({}),
    useAppToast: () => ({ notify: () => {} }),
    useHelpers: () => ({ formatePrice: (value) => String(value) }),
    requiredRule: (value) => Boolean(value) || "required",
    watch: (_source, callback) => callback(),
  };
  const source = readFileSync(new URL("../components/Forms/Product.vue", import.meta.url), "utf8").match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const factory = new Function(...Object.keys(dependencies), stripTypeScriptTypes(source) + "\nreturn { productForm, additionalUnits, openUnitModal, unitDraft, confirmUnitModal, saveProduct, removeUnit };");
  const form = factory(...Object.values(dependencies));
  assert.equal(form.productForm.value.base_unit_name, "ثمن");
  assert.equal(form.productForm.value.base_unit_id, "eighth");
  assert.equal(form.additionalUnits.value.length, 1);
  form.openUnitModal("base");
  form.unitDraft.value.name = "ثمن شاي";
  form.confirmUnitModal();
  await form.saveProduct();
  assert.equal(saved.units[0].name, "ثمن شاي");
  assert.equal(saved.units[0].id, "eighth");
  assert.equal(saved.units[0].stock_quantity, 10);
  assert.equal(saved.units[0].average_cost, 8.5);
  assert.equal(saved.units[1].average_cost, 49.75);
  const deletion = factory(...Object.values(dependencies));
  deletion.removeUnit("base");
  assert.equal(deletion.productForm.value.base_unit_name, "ربع");
  assert.equal(deletion.additionalUnits.value.length, 0);
  deletion.removeUnit("base");
  await deletion.saveProduct();
  assert.equal(saved.units.length, 1);
  assert.equal(saved.units[0].id, "quarter");
  assert.equal(saved.units[0].stock_quantity, 3);
  assert.equal(saved.units[0].average_cost, 49.75);
});

test("purchase-order Excel exports only product, quantity, purchase cost and total columns", async () => {
  const unit = { id: "quarter", name: "ربع", factor: 1, average_cost: 40, purchase_price: 49.75, selling_price: 50 };
  let workbook;
  const source = readFileSync(new URL("../components/products/LowStockDialog.vue", import.meta.url), "utf8");
  const start = source.indexOf("async function exportOrder()");
  const end = source.indexOf("/** Clear the shortage", start);
  const exportSource = source.slice(start, end).replace('const XLSX = await import("xlsx/dist/xlsx.full.min.js");', "const XLSX = xlsx;").replace("XLSX.writeFile(", "captureWorkbook(");
  const factory = new Function("selectedRows", "unitPurchasePrice", "captureWorkbook", "xlsx", stripTypeScriptTypes(exportSource) + "\nreturn exportOrder;");
  await factory({ value: [{ product: { id: "tea", name: "شاي" }, unit }] }, purchaseMath.unitPurchasePrice, (value) => { workbook = value; }, createRequire(import.meta.url)("xlsx"))();
  const sheet = workbook.Sheets["طلب شراء"];
  assert.deepEqual(["A1", "B1", "C1", "D1", "E1"].map((cell) => sheet[cell].v), ["رقم المنتج", "اسم المنتج", "الكمية المطلوبة", "تكلفة شراء الوحدة", "الإجمالي"]);
  assert.equal(sheet.F1, undefined);
  assert.equal(sheet.B2.v, "شاي (ربع)");
  assert.equal(sheet.D2.v, 49.75);
  assert.equal(sheet.E2.f, 'IF(OR(C2="",D2=""),"",ROUND(C2*D2,2))');
  assert.equal(sheet.B3.v, "الإجمالي");
  assert.equal(sheet.E3.f, "SUM(E2:E2)");
});

test("shortage export keeps only explicitly selected rows after the list updates", async () => {
  const source = readFileSync(new URL("../components/products/LowStockDialog.vue", import.meta.url), "utf8");
  const selectionStart = source.indexOf("watch(\n  () => orderRows.value.map");
  const exportStart = source.indexOf("async function exportOrder()");
  const exportEnd = source.indexOf("/** Clear the shortage", exportStart);
  const selectionSource = source.slice(selectionStart, exportStart);
  const exportSource = source.slice(exportStart, exportEnd).replace('const XLSX = await import("xlsx/dist/xlsx.full.min.js");', "const XLSX = xlsx;").replace("XLSX.writeFile(", "captureWorkbook(");
  const rows = [
    { key: "tea__eighth", product: { id: "tea", name: "شاي" }, unit: { id: "eighth", name: "ثمن", purchase_price: 8.5 } },
    { key: "tea__quarter", product: { id: "tea", name: "شاي" }, unit: { id: "quarter", name: "ربع", purchase_price: 49.75 } },
  ];
  const orderRows = ref(rows);
  const selectedKeys = ref([]);
  let workbook;
  let stopWatch;
  const dependencies = {
    selectedKeys, orderRows, filteredRows: computed(() => orderRows.value), computed,
    watch: (...args) => { stopWatch = watch(...args); },
    unitPurchasePrice: purchaseMath.unitPurchasePrice,
    captureWorkbook: (value) => { workbook = value; },
    xlsx: createRequire(import.meta.url)("xlsx"),
  };
  const factory = new Function(...Object.keys(dependencies), stripTypeScriptTypes(selectionSource + exportSource) + "\nreturn { toggleRow, selectedRows, exportOrder };");
  const selection = factory(...Object.values(dependencies));
  assert.equal(selection.selectedRows.value.length, 0);
  selection.toggleRow("tea__eighth");
  selection.toggleRow("tea__quarter");
  selection.toggleRow("tea__quarter");
  orderRows.value = [...rows].reverse();
  await nextTick();
  assert.deepEqual(selectedKeys.value, ["tea__eighth"]);
  await selection.exportOrder();
  const sheet = workbook.Sheets["طلب شراء"];
  assert.equal(sheet.B2.v, "شاي (ثمن)");
  assert.equal(sheet.B3.v, "الإجمالي");
  assert.equal(sheet.B4, undefined);
  stopWatch();
});

test("cashbox values independent unit stocks without false missing-data warnings", () => {
  const product = { name: "شاي", units: [
    { id: "eighth", name: "ثمن", factor: 1, stock_quantity: 2, average_cost: 8.5, selling_price: 10 },
    { id: "quarter", name: "ربع", factor: 1, stock_quantity: 10, average_cost: 49.75, selling_price: 50 },
    { id: "reference", name: "مرجع", factor: 1, stock_quantity: 0, average_cost: null, selling_price: 0 },
  ] };
  assert.deepEqual(inventoryAggregates([product]), { costValue: 514.5, saleValue: 520, expectedProfit: 5.5 });
  assert.deepEqual(inventoryDataIssues([product]), { valuation: 0, forecast: 0 });
  const purchaseOnly = { name: "شراء فقط", units: [{ id: "carton", name: "كرتونة", factor: 1, stock_quantity: 5, average_cost: 20, selling_price: 0, can_sell: false }] };
  assert.deepEqual(inventoryAggregates([product, purchaseOnly]), { costValue: 614.5, saleValue: 520, expectedProfit: 5.5 });
  assert.deepEqual(inventoryDataIssues([purchaseOnly]), { valuation: 0, forecast: 0 });
  assert.deepEqual(inventoryDataIssues([{ name: "ناقص", units: [{ id: "u", name: "قطعة", factor: 1, stock_quantity: 2, selling_price: 5 }] }]), { valuation: 1, forecast: 1 });
});

test("server sale, invoice edit and return use unit stocks and historical costs", async () => {
  const records = new Map([
    ["customers/customer", { name: "عميل", phone: "01000000000" }],
    ["cashbox/current", { balance: 1000 }],
    ["products/tea", { name: "شاي", units: [
      { id: "eighth", name: "ثمن", factor: 1, stock_quantity: 10, average_cost: 8.5, selling_price: 10, purchase_price: 8.5 },
      { id: "quarter", name: "ربع", factor: 1, stock_quantity: 10, average_cost: 49.75, selling_price: 50, purchase_price: 49.75 },
    ] }],
  ]);
  let nextId = 0;
  const doc = (path) => ({ path, id: path.split("/").at(-1), get: async () => snapshot(path) });
  const snapshot = (path) => ({ id: path.split("/").at(-1), ref: doc(path), exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const collection = (path, filters = []) => ({
    doc: (id = `generated-${++nextId}`) => doc(`${path}/${id}`),
    where: (field, op, value) => collection(path, [...filters, { field, op, value }]),
    get: async () => {
      const docs = [...records.keys()].filter((key) => key.startsWith(`${path}/`) && filters.every(({ field, value }) => records.get(key)[field] === value)).map(snapshot);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const db = { doc, collection, runTransaction: async (callback) => {
    const writes = [];
    const result = await callback({ get: async (ref) => snapshot(ref.path), create: (ref, data) => writes.push({ ref, data }), set: (ref, data, options) => writes.push({ ref, data, merge: options?.merge }), update: (ref, data) => writes.push({ ref, data, merge: true }) });
    for (const { ref, data, merge } of writes) {
      const old = records.get(ref.path) ?? {};
      const updated = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value?.increment !== undefined ? (old[key] ?? 0) + value.increment : value]));
      records.set(ref.path, structuredClone(merge ? { ...old, ...updated } : updated));
    }
    return result;
  } };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const admin = { getFirestore: () => db, FieldValue: { serverTimestamp: () => new Date(), increment: (increment) => ({ increment }) }, FieldPath: { documentId: () => "id" }, Timestamp: { now: () => new Date() } };
  const nativeRequire = createRequire(import.meta.url);
  const load = (filename) => {
    const module = { exports: {} };
    const require = (name) => name === "firebase-functions/v2/https" ? { onCall: (callback) => callback, HttpsError }
      : name === "firebase-admin/firestore" ? admin
      : name === "./staffMath.cjs" ? nativeRequire("../functions/staffMath.cjs")
      : name === "./staffInvoiceActions.cjs" ? load("staffInvoiceActions.cjs") : nativeRequire(name);
    new Function("require", "module", "exports", readFileSync(new URL(`../functions/${filename}`, import.meta.url), "utf8"))(require, module, module.exports);
    return module.exports;
  };
  const staff = load("staff.cjs");
  const auth = { uid: "admin", token: { email: "mohamed.mojahead@gmail.com" } };
  const saleInput = { requestId: "sale-operation-001", customer_id: "customer", paid_amount: 70, discount: 0, products: [
    { product_id: "tea", unit_id: "eighth", product_quantity: 2, product_price: 10 },
    { product_id: "tea", unit_id: "quarter", product_quantity: 1, product_price: 50 },
  ] };
  const sale = await staff.createStaffSale({ auth, data: saleInput });
  assert.deepEqual(records.get("products/tea").units.map((unit) => unit.stock_quantity), [8, 9]);
  assert.equal(records.get("cashbox/current").balance, 1070);
  assert.equal(records.get("store_stats/current").total_profit, 3.25);
  await staff.createStaffSale({ auth, data: saleInput });
  assert.equal(records.get("cashbox/current").balance, 1070);
  records.get("products/tea").units[1].average_cost = 60;
  const original = records.get(`invoices/${sale.id}`);
  assert.equal(original.products[1].product_cost_price, 49.75);
  records.set("staff_users/cashier", { role: "cashier", active: true, email: "cashier@example.com" });
  const cashierInvoice = await staff.getCashierInvoice({ auth: { uid: "cashier", token: { email: "cashier@example.com" } }, data: { id: sale.id } });
  assert.equal(cashierInvoice.inventory_applied, true);
  assert.equal(cashierInvoice.products[0].product_cost_price, undefined);
  const editable = await staff.getCashierInvoice({ auth, data: { id: sale.id } });
  await staff.updateStaffInvoice({ auth, data: {
    ...editable, requestId: "edit-operation-001", paid_amount: 100,
    products: [
      { ...editable.products[0], unit_id: "quarter", product_quantity: 1, product_price: 50 },
      editable.products[1],
    ],
  } });
  assert.deepEqual(records.get("products/tea").units.map((unit) => unit.stock_quantity), [10, 8]);
  assert.equal(records.get("cashbox/current").balance, 1100);
  const edited = records.get(`invoices/${sale.id}`);
  assert.deepEqual(edited.products.map((line) => line.product_cost_price), [60, 49.75]);
  assert.equal(records.get("store_stats/current").total_cost, 109.75);
  await staff.createStaffReturn({ auth, data: { id: sale.id, requestId: "return-operation-001", cashRefund: 50, items: [{ rowKey: "1:0", quantity: 1 }] } });
  assert.equal(records.get("products/tea").units[1].stock_quantity, 9);
  assert.equal(records.get("products/tea").units[1].average_cost, 58.8611);
  assert.equal(records.get("cashbox/current").balance, 1050);
  assert.equal(records.get(`invoices/${sale.id}`).products[1].product_cost_price, 49.75);
});
