import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateCustomerCredit,
  applyStockGroup,
  allocateSupplierCash,
  convertUnitPrice,
  grossProfitOf,
  invoiceEditCashOutflowError,
  invoiceEditCustomerChangeError,
  invoiceEditPaymentError,
  invoiceEditStockChanges,
  invoiceHasReturnHistory,
  isLowStock,
  purchasableUnitsForProduct,
  proposedSellingPrice,
  restoreGroupsForEdit,
  sellableUnitsForProduct,
  stockQuantityLabel,
  splitSupplierReturn,
  splitCustomerReturn,
  unitSellingPrice,
  unitsForProduct,
} from "../composables/finance.ts";
import { deriveSupplierInvoiceStatus, supplierInvoiceStatus } from "../types/finance.ts";
import { cairoDayStart, invoiceDayKey, invoiceMonthKey, invoicePaymentStatus, invoiceStatsDelta, invoiceStatsOf, netCollectedOf, netSalesOf } from "../composables/invoiceStats.ts";
import { formatePrice, formatInvoiceLineName } from "../composables/helpers.ts";

test("stock label decomposes quantities across configured units", () => {
  const product = { name: "مرقة", price: 2, cost_price: 1, stock_quantity: 99, base_unit_id: "cube", units: [
    { id: "cube", name: "مكعب", factor: 1, selling_price: 2, is_base: true },
    { id: "box", name: "علبة", factor: 30, selling_price: 50 },
    { id: "carton", name: "كرتونة", factor: 300, selling_price: 450 },
  ] };
  assert.equal(stockQuantityLabel(product), "3 علبة و9 مكعب");
  assert.equal(stockQuantityLabel(product, 60), "2 علبة");
  assert.equal(stockQuantityLabel(product, 334), "1 كرتونة و1 علبة و4 مكعب");
  assert.equal(stockQuantityLabel(product, 9), "9 مكعب");
  assert.equal(stockQuantityLabel({ ...product, units: [product.units[0]] }, 99), "99 مكعب");
  assert.equal(stockQuantityLabel({ ...product, stock_quantity: null }), "غير مُدخل");
});

test("invoice line name does not repeat an identical base unit", () => {
  assert.equal(formatInvoiceLineName("مكنة حلاقة", "مكنة حلاقة"), "مكنة حلاقة");
  assert.equal(formatInvoiceLineName("مكنة حلاقة", "علبة"), "علبة مكنة حلاقة");
});

test("supplier cash above invoice total becomes a separate advance", () => {
  assert.deepEqual(allocateSupplierCash(100, 150), { applied: 100, advance: 50, remaining: 0 });
  assert.deepEqual(allocateSupplierCash(100, 40), { applied: 40, advance: 0, remaining: 60 });
});

test("supplier returns reduce payable first and leave the rest as a receivable", () => {
  assert.deepEqual(splitSupplierReturn(40, 100), { payableReduction: 40, receivable: 0 });
  assert.deepEqual(splitSupplierReturn(100, 40), { payableReduction: 40, receivable: 60 });
  assert.deepEqual(splitSupplierReturn(25, 0), { payableReduction: 0, receivable: 25 });
});

test("sales and cash reports use net returns without treating debt relief as cash", () => {
  const sale = invoiceStatsOf({ products: [{ product_price: 5, product_quantity: 4, product_cost_price: 3 }], paid_amount: 20, remaining: 0 });
  assert.equal(netSalesOf({ ...sale, returns_total: 10 }), 10);
  assert.equal(netCollectedOf(sale.total_paid, 10), 10);
  const debtRelief = invoiceStatsOf({ products: [{ product_price: 5, product_quantity: 4, product_cost_price: 3 }], paid_amount: 10, remaining: 10 });
  assert.equal(netSalesOf({ ...debtRelief, returns_total: 10 }), 10);
  assert.equal(netCollectedOf(debtRelief.total_paid, 0), 10);
});

test("customer credit settles an invoice without inflating cash collections or reducing sales", () => {
  const stats = invoiceStatsOf({ products: [{ product_price: 50, product_quantity: 2, product_cost_price: 30 }], paid_amount: 100, credit_used: 50, remaining: 0 });
  assert.equal(stats.total_sales, 100);
  assert.equal(stats.total_paid, 50);
  assert.equal(stats.outstanding_customer_debt, 0);
  assert.equal(netCollectedOf(stats.total_paid, 0), 50);
});

test("customer credit settles the oldest invoice and loan up to the available balance", () => {
  const obligations = [
    { id: "loan", type: "loan", remaining: 40, date: new Date("2026-10-02") },
    { id: "invoice", type: "invoice", remaining: 30, date: new Date("2026-10-01") },
  ];
  assert.deepEqual(allocateCustomerCredit(50, obligations), [
    { type: "invoice", reference_id: "invoice", amount: 30 },
    { type: "loan", reference_id: "loan", amount: 20 },
  ]);
  assert.deepEqual(allocateCustomerCredit(100, obligations), [
    { type: "invoice", reference_id: "invoice", amount: 30 },
    { type: "loan", reference_id: "loan", amount: 40 },
  ]);
  assert.deepEqual(allocateCustomerCredit(0, obligations), []);
});

test("customer return can reduce debt, restore spent credit, and defer or pay the rest", () => {
  assert.deepEqual(splitCustomerReturn(80, 20, 30, 0, 10), { debtReduction: 20, creditRestored: 30, cashRefund: 10, creditIssued: 20, settlement: 30 });
  assert.deepEqual(splitCustomerReturn(20, 0, 0, 0, 0), { debtReduction: 0, creditRestored: 0, cashRefund: 0, creditIssued: 20, settlement: 20 });
  assert.throws(() => splitCustomerReturn(20, 0, 0, 0, 21));
});

test("daily cash refunds use Cairo calendar bounds across time offsets", () => {
  assert.equal(cairoDayStart("2026-01-10").toISOString(), "2026-01-09T22:00:00.000Z");
  assert.equal(cairoDayStart("2026-10-10").toISOString(), "2026-10-09T21:00:00.000Z");
});

test("money display retains exactly two decimal places", () => {
  assert.equal(formatePrice(1), "1.00");
  assert.equal(formatePrice(0.5), "0.50");
  assert.equal(formatePrice(1234.567), "1,234.57");
});

test("moving weighted average stays aligned with sale and historical replay", () => {
  const afterFirstPurchase = applyStockGroup(0, undefined, 0, [{ qty: 10, cost: 100 }]);
  const afterSale = applyStockGroup(afterFirstPurchase.stock, afterFirstPurchase.avg, 8, []);
  const afterSecondPurchase = applyStockGroup(afterSale.stock, afterSale.avg, 0, [{ qty: 10, cost: 200 }]);

  assert.equal(afterSecondPurchase.stock, 12);
  assert.equal(Math.round(afterSecondPurchase.avg * 100) / 100, 183.33);
});

test("purchase-only packaging is excluded from sales and never inherits the base selling price", () => {
  const product = {
    price: 2,
    base_unit_id: "cube",
    base_unit_name: "مكعب",
    units: [
      { id: "cube", name: "مكعب", factor: 1, selling_price: 2, is_base: true, can_purchase: true, can_sell: true },
      { id: "carton", name: "كرتونة", factor: 30, selling_price: null, can_purchase: true, can_sell: false },
      { id: "box", name: "علبة", factor: 10, selling_price: 18, can_purchase: true, can_sell: true },
    ],
  };
  assert.deepEqual(purchasableUnitsForProduct(product).map((unit) => unit.id), ["cube", "carton", "box"]);
  assert.deepEqual(sellableUnitsForProduct(product).map((unit) => unit.id), ["cube", "box"]);
  assert.equal(unitSellingPrice(product, product.units[0]), 2);
  assert.equal(unitSellingPrice(product, product.units[1]), null);
  assert.equal(unitSellingPrice(product, product.units[2]), 18);
  assert.deepEqual(sellableUnitsForProduct({ price: 2, units: [{ id: "legacy-pack", name: "عبوة", factor: 12, selling_price: null }] }).map((unit) => unit.id), ["legacy-pack"]);
  assert.equal(unitSellingPrice({ price: 2 }, unitsForProduct({ price: 2, cost_price: 1 })[0]), 2);
});

test("package purchase price normalizes to the base-unit moving average", () => {
  const result = applyStockGroup(0, undefined, 0, [{ qty: 1 * 30, cost: 25 / 30 }]);
  assert.equal(result.stock, 30);
  assert.equal(Math.round(result.avg * 10000) / 10000, 0.8333);
});

test("switching purchase units preserves the equivalent base-unit cost", () => {
  const perCube = convertUnitPrice(25, 30, 1);
  const perCarton = convertUnitPrice(perCube, 1, 30);
  assert.equal(perCube, 0.8333);
  assert.equal(perCarton, 24.999);
});

test("invoice analytics use old-to-new deltas and transition payment status", () => {
  const original = {
    date: new Date(2026, 8, 10),
    products: [{ product_price: 100, product_cost_price: 30, product_quantity: 2 }],
    paid_amount: 100,
    remaining: 100,
  };
  const edited = {
    ...original,
    date: new Date(2026, 8, 11),
    products: [{ product_price: 120, product_cost_price: 30, product_quantity: 2 }],
    paid_amount: 240,
    remaining: 0,
  };

  const delta = invoiceStatsDelta(original, edited);
  assert.equal(delta.total_sales, 40);
  assert.equal(delta.total_paid, 140);
  assert.equal(delta.outstanding_customer_debt, -100);
  assert.equal(delta.total_cost, 0);
  assert.equal(delta.total_profit, 40);
  assert.equal(delta.invoice_count, 0);
  assert.equal(delta.partial_invoice_count, -1);
  assert.equal(delta.paid_invoice_count, 1);
  assert.equal(invoicePaymentStatus(original), "partial");
  assert.equal(invoicePaymentStatus(edited), "paid");
  assert.equal(invoiceDayKey(original), "2026-09-10");
  assert.equal(invoiceDayKey(edited), "2026-09-11");
  assert.equal(invoiceMonthKey(edited), "2026-09");
});

test("legacy invoice without paid_amount is counted as fully paid", () => {
  const stats = invoiceStatsOf({
    date: new Date(2026, 8, 27),
    products: [{ product_price: 50, product_cost_price: 20, product_quantity: 1 }],
  });
  assert.equal(stats.total_paid, 50);
  assert.equal(stats.outstanding_customer_debt, 0);
  assert.equal(stats.paid_invoice_count, 1);
});

test("invoice edits restore old lines in separate historical cost groups", () => {
  const groups = restoreGroupsForEdit(
    [
      { product_id: "p1", product_name: "A", product_quantity: 5, product_cost_price: 100 },
      { product_id: "p1", product_name: "A", product_quantity: 5, product_cost_price: 200 },
    ],
    [{ product_id: "p1", product_name: "A", product_quantity: 4 }],
  );

  assert.deepEqual(groups.map(({ qty, unit_cost }) => ({ qty, unit_cost })), [
    { qty: 5, unit_cost: 100 },
    { qty: 1, unit_cost: 200 },
  ]);
});

test("increasing an edited line keeps original cost and prices only added base units at current cost", () => {
  const result = invoiceEditStockChanges(
    [{ line_id: "rice", product_id: "p1", product_name: "Rice", product_quantity: 2, unit_factor: 1, base_quantity: 2, product_price: 50, product_cost_price: 20 }],
    [{ line_id: "rice", product_id: "p1", product_name: "Rice", product_quantity: 5, unit_factor: 1, base_quantity: 5, product_price: 50 }],
    new Map([["p1", 30]]),
  );
  assert.deepEqual(result.lines[0].cost_groups, [
    { base_quantity: 2, unit_cost: 20 },
    { base_quantity: 3, unit_cost: 30 },
  ]);
  assert.equal(result.takes[0].delta, -3);
  assert.equal(result.takes[0].unit_cost, 30);
  assert.equal(grossProfitOf(result.lines), 120);
});

test("decreasing a mixed-cost line restores latest cost group first", () => {
  const result = invoiceEditStockChanges(
    [{ line_id: "p", product_id: "p1", product_name: "A", product_quantity: 5, base_quantity: 5, product_cost_price: 26, cost_groups: [
      { base_quantity: 2, unit_cost: 20 }, { base_quantity: 3, unit_cost: 30 },
    ] }],
    [{ line_id: "p", product_id: "p1", product_name: "A", product_quantity: 3, base_quantity: 3 }],
    new Map([["p1", 40]]),
  );
  assert.deepEqual(result.lines[0].cost_groups, [
    { base_quantity: 2, unit_cost: 20 }, { base_quantity: 1, unit_cost: 30 },
  ]);
  assert.deepEqual(result.restores.map(({ qty, unit_cost }) => ({ qty, unit_cost })), [{ qty: 2, unit_cost: 30 }]);
  assert.equal(result.takes.length, 0);
});

test("multiple lines of one product retain per-line additions and allow same-batch restore and sale", () => {
  const result = invoiceEditStockChanges(
    [
      { line_id: "a", product_id: "p1", product_name: "A", product_quantity: 5, base_quantity: 5, product_cost_price: 20 },
      { line_id: "b", product_id: "p1", product_name: "A", product_quantity: 5, base_quantity: 5, product_cost_price: 20 },
    ],
    [
      { line_id: "a", product_id: "p1", product_name: "A", product_quantity: 3, base_quantity: 3 },
      { line_id: "b", product_id: "p1", product_name: "A", product_quantity: 7, base_quantity: 7 },
    ],
    new Map([["p1", 30]]),
  );
  assert.equal(result.takes[0].delta, -2);
  assert.equal(result.restores[0].qty, 2);
  assert.equal(result.restores[0].unit_cost, 20);
  const after = applyStockGroup(0, 30, 2, [{ qty: 2, cost: 20 }]);
  assert.deepEqual(after, { stock: 0, avg: 20 });
});

test("removing a product restores every historical cost group and replacing it uses fresh cost", () => {
  const result = invoiceEditStockChanges(
    [{ line_id: "old", product_id: "old", product_name: "Old", product_quantity: 3, base_quantity: 3, product_cost_price: 10, cost_groups: [
      { base_quantity: 1, unit_cost: 5 }, { base_quantity: 2, unit_cost: 12 },
    ] }],
    [{ product_id: "new", product_name: "New", product_quantity: 4, base_quantity: 4, product_price: 20 }],
    new Map([["old", 99], ["new", 7]]),
  );
  assert.deepEqual(result.restores.map(({ qty, unit_cost }) => ({ qty, unit_cost })), [{ qty: 2, unit_cost: 12 }, { qty: 1, unit_cost: 5 }]);
  assert.deepEqual(result.takes.map(({ product_id, delta, unit_cost }) => ({ product_id, delta, unit_cost })), [{ product_id: "new", delta: -4, unit_cost: 7 }]);
  assert.deepEqual(result.lines[0].cost_groups, [{ base_quantity: 4, unit_cost: 7 }]);
});

test("unit changes calculate stock in base units and legacy lines default to factor one", () => {
  const result = invoiceEditStockChanges(
    [{ line_id: "box", product_id: "p1", product_name: "Stock", product_quantity: 2, unit_factor: 24, base_quantity: 48, product_cost_price: 2 }],
    [{ line_id: "box", product_id: "p1", product_name: "Stock", product_quantity: 5, unit_factor: 12, product_price: 60 }],
    new Map([["p1", 3]]),
  );
  assert.equal(result.takes[0].delta, -12);
  assert.equal(result.lines[0].base_quantity, 60);
  assert.deepEqual(result.lines[0].cost_groups, [{ base_quantity: 48, unit_cost: 2 }, { base_quantity: 12, unit_cost: 3 }]);
  const legacy = invoiceEditStockChanges(
    [{ product_id: "legacy", product_name: "Legacy", product_quantity: 2, product_cost_price: 4 }],
    [{ product_id: "legacy", product_name: "Legacy", product_quantity: 3 }],
    new Map([["legacy", 6]]),
  );
  assert.equal(legacy.takes[0].delta, -1);
  assert.deepEqual(legacy.lines[0].cost_groups, [{ base_quantity: 2, unit_cost: 4 }, { base_quantity: 1, unit_cost: 6 }]);
});

test("invoice edit guards validate payment totals, customer ownership, and cash outflow", () => {
  const base = { products: [{ product_price: 100, product_quantity: 2 }], discount: 10, discount_percentage: false };
  assert.equal(invoiceEditPaymentError({ ...base, paid_amount: 190 }), null);
  assert.equal(invoiceEditPaymentError({ ...base, paid_amount: 191 }), "paid amount cannot exceed invoice total");
  assert.equal(invoiceEditPaymentError({ ...base, paid_amount: -1 }), "paid amount must be a valid non-negative number");
  assert.equal(invoiceEditCustomerChangeError("old", "new", true), "customer cannot change after a debt payment");
  assert.equal(invoiceEditCustomerChangeError("old", "new", false), null);
  assert.equal(invoiceEditCashOutflowError(100, -101), "cashbox balance is insufficient");
  assert.equal(invoiceEditCashOutflowError(100, -100), null);
  assert.equal(invoiceHasReturnHistory(false, 0, "none", {}), false);
  assert.equal(invoiceHasReturnHistory(false, 0, "partial", {}), true);
  assert.equal(invoiceHasReturnHistory(false, 1, undefined, {}), true);
  assert.equal(invoiceHasReturnHistory(false, 0, undefined, { p1: 1 }), true);
  assert.equal(invoiceHasReturnHistory(true, 0, "none", {}), true);
});

test("purchase price proposal preserves markup over cost", () => {
  assert.deepEqual(proposedSellingPrice(100, 102, 105), { rate: 0.02, proposed: 107.1 });
  assert.equal(proposedSellingPrice(0, 102, 105).proposed, null);
});

test("low stock comparison uses each product threshold and strict less-than", () => {
  assert.equal(isLowStock({ stock_quantity: 3, low_stock_threshold: 2 }), false);
  assert.equal(isLowStock({ stock_quantity: 3, low_stock_threshold: 5 }), true);
  assert.equal(isLowStock({ stock_quantity: 0, low_stock_threshold: 0 }), false);
});

test("supplier invoice status derives consistently and supports legacy documents", () => {
  assert.equal(deriveSupplierInvoiceStatus(0, 100), "unpaid");
  assert.equal(deriveSupplierInvoiceStatus(25, 75), "partial");
  assert.equal(deriveSupplierInvoiceStatus(100, 0), "paid");
  assert.equal(deriveSupplierInvoiceStatus(100, -1), "paid");
  assert.equal(deriveSupplierInvoiceStatus(20, undefined, 100), "partial");
  assert.equal(supplierInvoiceStatus({ paid_amount: 0, remaining_amount: 100, total_amount: 100 }), "unpaid");
  assert.equal(supplierInvoiceStatus({ paid_amount: 25, remaining_amount: 75, total_amount: 100, status: "partial" }), "partial");
});
