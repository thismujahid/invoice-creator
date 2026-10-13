import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateCustomerCredit,
  applyStockGroup,
  allocateSupplierCash,
  convertUnitPrice,
  grossProfitOf,
  hasShortageAlert,
  manualPriceBaseOf,
  shortageAvgFormula,
  invoiceEditCashOutflowError,
  invoiceEditCustomerChangeError,
  invoiceEditPaymentError,
  invoiceEditStockChanges,
  invoiceHasReturnHistory,
  isLowStock,
  isUnitLowStock,
  lowStockThresholdOf,
  lowStockUnitsOf,
  parsePurchasePriceHistory,
  prependPurchasePriceHistory,
  productHasUnitThresholds,
  unitLowThresholdOf,
  unitThresholdDisplayOf,
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

test("unit-level thresholds replace the product-level threshold", () => {
  const base = { id: "pc", name: "قطعة", factor: 1, selling_price: 2, is_base: true };
  const pack = { id: "box", name: "علبة", factor: 12, selling_price: 20 };
  // No unit thresholds → legacy product-level rule.
  assert.equal(productHasUnitThresholds({ units: [base, pack] }), false);
  assert.equal(isLowStock({ stock_quantity: 3, low_stock_threshold: 5, units: [base, pack] }), true);
  // Pack threshold 10 packs (=120 base); stock 110 → pack is low, base has no alert.
  const withPack = { stock_quantity: 110, low_stock_threshold: 5, base_unit_id: "pc", units: [{ ...base }, { ...pack, low_stock_threshold: 10 }] };
  assert.equal(productHasUnitThresholds(withPack), true);
  assert.equal(unitLowThresholdOf(withPack.units[1]), 10);
  assert.equal(isUnitLowStock(withPack, withPack.units[1]), true);
  assert.equal(isUnitLowStock(withPack, withPack.units[0]), false);
  assert.equal(isLowStock(withPack), true);
  assert.deepEqual(lowStockUnitsOf(withPack).map((u) => u.id), ["box"]);
  assert.equal(unitThresholdDisplayOf(withPack.units[1]), "10 علبة");
  // Stock 130 → no unit breached even though legacy threshold would fire.
  const ok = { ...withPack, stock_quantity: 130 };
  assert.equal(isLowStock(ok), false);
  // Base-only threshold behaves like the legacy rule.
  const baseOnly = { stock_quantity: 4, low_stock_threshold: 99, base_unit_id: "pc", units: [{ ...base, low_stock_threshold: 5 }, { ...pack }] };
  assert.equal(isLowStock(baseOnly), true);
  assert.equal(isLowStock({ ...baseOnly, stock_quantity: 6 }), false);
  // Missing/invalid unit thresholds never fire; legacy default still applies.
  assert.equal(unitLowThresholdOf({}), null);
  assert.equal(unitLowThresholdOf({ low_stock_threshold: -1 }), null);
  assert.equal(isLowStock({ stock_quantity: 0, units: [{ ...base }, { ...pack }] }), true);
});

test("zero threshold mutes the shortage alert completely", () => {
  const base = { id: "pc", name: "قطعة", factor: 1, selling_price: 2, is_base: true };
  const pack = { id: "box", name: "علبة", factor: 12, selling_price: 20 };
  // Zero unit threshold → muted even at zero/negative stock.
  assert.equal(hasShortageAlert({ stock_quantity: 0, units: [{ ...base, low_stock_threshold: 0 }, { ...pack }] }), false);
  assert.equal(hasShortageAlert({ stock_quantity: -2, units: [{ ...base, low_stock_threshold: 0 }] }), false);
  // Positive unit threshold → alerting.
  assert.equal(hasShortageAlert({ stock_quantity: 0, units: [{ ...base, low_stock_threshold: 5 }] }), true);
  assert.equal(hasShortageAlert({ stock_quantity: 0, units: [{ ...base, low_stock_threshold: 0 }, { ...pack, low_stock_threshold: 2 }] }), true);
  // Legacy: zero mutes, missing keeps the default-5 fallback.
  assert.equal(hasShortageAlert({ stock_quantity: 0, low_stock_threshold: 0 }), false);
  assert.equal(hasShortageAlert({ stock_quantity: 0, low_stock_threshold: 5 }), true);
  assert.equal(hasShortageAlert({ stock_quantity: 0 }), true);
  assert.equal(hasShortageAlert({ stock_quantity: 0, units: [{ ...base }, { ...pack }] }), true);
});

/** Minimal Excel evaluator for the purchase-order formulas: IF (lazy),
// AND/OR/ABS/ROUND, comparisons (Excel `=`), arithmetic, cell refs and the
// empty-string literal. Enough to execute shortageAvgFormula output. */
function evalExcel(formula, cells) {
  let i = 0;
  const s = formula;
  function skip() {
    while (s[i] === " " || s[i] === "\t") i++;
  }
  function parseExpr() {
    return parseComp();
  }
  function parseComp() {
    const left = parseArith();
    skip();
    for (const op of ["<=", ">=", "<", ">", "="]) {
      if (s.startsWith(op, i)) {
        i += op.length;
        const right = parseArith();
        if (op === "<=") return left <= right;
        if (op === ">=") return left >= right;
        if (op === "<") return left < right;
        if (op === ">") return left > right;
        return left === right;
      }
    }
    return left;
  }
  function parseArith() {
    let value = parseTerm();
    for (;;) {
      skip();
      if (s[i] === "+") {
        i++;
        value += parseTerm();
      } else if (s[i] === "-") {
        i++;
        value -= parseTerm();
      } else break;
    }
    return value;
  }
  function parseTerm() {
    let value = parseFactor();
    for (;;) {
      skip();
      if (s[i] === "*") {
        i++;
        value *= parseFactor();
      } else if (s[i] === "/") {
        i++;
        value /= parseFactor();
      } else break;
    }
    return value;
  }
  function parseFactor() {
    skip();
    if (s[i] === "-") {
      i++;
      return -parseFactor();
    }
    if (s[i] === "(") {
      i++;
      const value = parseExpr();
      skip();
      if (s[i] !== ")") throw new Error(`missing ) in: ${formula}`);
      i++;
      return value;
    }
    if (s[i] === "'") {
      if (s.startsWith("''", i)) {
        i += 2;
        return "";
      }
      throw new Error(`bad string in: ${formula}`);
    }
    const call = s.slice(i).match(/^([A-Z]+)\(/);
    if (call) {
      const name = call[1];
      i += name.length + 1;
      if (name === "IF") {
        // JS arithmetic never throws (0/0 is NaN), so both branches can be
        // parsed eagerly; only the taken value is returned.
        const cond = parseExpr();
        skip();
        if (s[i] !== ",") throw new Error(`bad IF in: ${formula}`);
        i++;
        const thenVal = parseExpr();
        skip();
        if (s[i] !== ",") throw new Error(`bad IF in: ${formula}`);
        i++;
        const elseVal = parseExpr();
        skip();
        if (s[i] !== ")") throw new Error(`bad IF end in: ${formula}`);
        i++;
        return cond ? thenVal : elseVal;
      }
      const args = [];
      skip();
      if (s[i] !== ")") {
        for (;;) {
          args.push(parseExpr());
          skip();
          if (s[i] === ",") {
            i++;
            continue;
          }
          break;
        }
      }
      skip();
      if (s[i] !== ")") throw new Error(`bad call ${name} in: ${formula}`);
      i++;
      if (name === "AND") return args.every(Boolean);
      if (name === "OR") return args.some(Boolean);
      if (name === "ABS") return Math.abs(args[0]);
      if (name === "ROUND") {
        const p = 10 ** args[1];
        return Math.round((args[0] + Number.EPSILON) * p) / p;
      }
      throw new Error(`unknown fn ${name}`);
    }
    const cell = s.slice(i).match(/^[A-Z]+[0-9]+/);
    if (cell) {
      i += cell[0].length;
      const v = cells[cell[0]];
      return v === undefined || v === null ? "" : v;
    }
    const num = s.slice(i).match(/^[0-9]+(\.[0-9]+)?/);
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    throw new Error(`unexpected token at ${i} in: ${formula}`);
  }
  // Helper for the not-taken IF branch: parse without returning.
  function parseExprAt(pos, discard) {
    void discard;
    const saved = i;
    i = pos;
    const v = parseExpr();
    i = saved;
    return v;
  }
  const out = parseExpr();
  skip();
  if (i !== s.length) throw new Error(`trailing input in: ${formula}`);
  return out;
}

test("shortage export averages aggregate sibling unit rows", () => {
  const self = [{ row: 2, factor: 1, costRef: 10 }];
  const single = shortageAvgFormula({
    ownRow: 2, oldUnitAvg: 10, costRef: 10, stockUnit: 0, factor: 1,
    siblings: self, stockBase: 0, oldBase: 10,
  });
  // Single-row output keeps the legacy per-row shape byte-identical.
  assert.equal(
    single,
    "IF(ABS(D2-10)<0.005,10,ROUND(IF(OR(C2=\"\",C2=0),(10+D2)/2,IF(0<=0,(10+D2)/2,(0*10+C2*D2)/(0+C2))),2))",
  );
  assert.equal(evalExcel(single, { C2: "", D2: 12 }), 11);
  // Two unit rows of one product (piece ×1 at row 2, pack ×12 at row 3).
  const sibs = [
    { row: 2, factor: 1, costRef: 10 },
    { row: 3, factor: 12, costRef: 120 },
  ];
  const piece = shortageAvgFormula({
    ownRow: 2, oldUnitAvg: 10, costRef: 10, stockUnit: 0, factor: 1,
    siblings: sibs, stockBase: 0, oldBase: 10,
  });
  const pack = shortageAvgFormula({
    ownRow: 3, oldUnitAvg: 120, costRef: 120, stockUnit: 0, factor: 12,
    siblings: sibs, stockBase: 0, oldBase: 10,
  });
  // Untouched file → recorded averages.
  assert.equal(evalExcel(piece, { C2: "", D2: 10, C3: "", D3: 120 }), 10);
  assert.equal(evalExcel(pack, { C2: "", D2: 10, C3: "", D3: 120 }), 120);
  // Edited costs + quantities: both rows imply the SAME base average
  // (batch aggregate (120+280)/(10+24) = 11.7647…), so the import never sees
  // a "different averages" conflict. The old per-row math gave 11 vs 10.833.
  const ePiece = evalExcel(piece, { C2: 10, D2: 12, C3: 2, D3: 140 });
  const ePack = evalExcel(pack, { C2: 10, D2: 12, C3: 2, D3: 140 });
  assert.ok(Math.abs(ePiece - 11.76) < 0.005, `piece ${ePiece}`);
  assert.ok(Math.abs(ePack / 12 - ePiece) < 0.02, `pack ${ePack} vs piece ${ePiece}`);
  // With stock on hand the aggregate blends with it: (200+200)/(20+17).
  const sPiece = shortageAvgFormula({
    ownRow: 2, oldUnitAvg: 10, costRef: 10, stockUnit: 20, factor: 1,
    siblings: sibs, stockBase: 20, oldBase: 10,
  });
  const sPack = shortageAvgFormula({
    ownRow: 3, oldUnitAvg: 120, costRef: 120, stockUnit: 20 / 12, factor: 12,
    siblings: sibs, stockBase: 20, oldBase: 10,
  });
  const vPiece = evalExcel(sPiece, { C2: 5, D2: 12, C3: 1, D3: 140 });
  const vPack = evalExcel(sPack, { C2: 5, D2: 12, C3: 1, D3: 140 });
  assert.ok(Math.abs(vPiece - 10.81) < 0.02, `stock piece ${vPiece}`);
  assert.ok(Math.abs(vPack / 12 - vPiece) < 0.02, `stock pack ${vPack} vs ${vPiece}`);
  // No recorded average: siblings' own cost references anchor the blend.
  const zPiece = shortageAvgFormula({
    ownRow: 2, oldUnitAvg: 0, costRef: 10, stockUnit: 5, factor: 1,
    siblings: sibs, stockBase: 5, oldBase: 0,
  });
  assert.equal(evalExcel(zPiece, { C2: "", D2: 12, C3: "", D3: 140 }), 11);
});

test("manual import prices ignore export-fresh multi-row margins", () => {
  const product = {
    cost_price: 10,
    units: [
      { id: "pc", name: "قطعة", factor: 1, selling_price: 12 },
      { id: "box", name: "علبة", factor: 12, selling_price: 140 },
    ],
  };
  // Untouched → never manual.
  assert.equal(manualPriceBaseOf(product, { priceOverride: 12, avgOverride: 10, unitId: "pc", unitFactor: 1 }, 2), null);
  assert.equal(manualPriceBaseOf(product, { priceOverride: null, avgOverride: 11, unitId: "pc", unitFactor: 1 }, 2), null);
  // Export-fresh (F follows own E by recorded margin) → ignored multi-row…
  assert.equal(manualPriceBaseOf(product, { priceOverride: 13.2, avgOverride: 11, unitId: "pc", unitFactor: 1 }, 2), null);
  assert.equal(manualPriceBaseOf(product, { priceOverride: 151.67, avgOverride: 130, unitId: "box", unitFactor: 12 }, 2), null);
  // …but kept single-row (legacy: the file value decides).
  assert.equal(manualPriceBaseOf(product, { priceOverride: 13.2, avgOverride: 11, unitId: "pc", unitFactor: 1 }, 1), 13.2);
  // Genuine manual edits still surface in base terms.
  assert.equal(manualPriceBaseOf(product, { priceOverride: 15, avgOverride: 11, unitId: "pc", unitFactor: 1 }, 2), 15);
  assert.equal(manualPriceBaseOf(product, { priceOverride: 150, avgOverride: 130, unitId: "box", unitFactor: 12 }, 2), 12.5);
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

test("purchase-price history log keeps latest first and stays bounded", () => {
  assert.deepEqual(parsePurchasePriceHistory(null), []);
  assert.deepEqual(parsePurchasePriceHistory(""), []);
  assert.deepEqual(parsePurchasePriceHistory("10.5-1728844800000,9-1728758400000"), [
    { price: 10.5, at: 1728844800000 },
    { price: 9, at: 1728758400000 },
  ]);
  assert.deepEqual(parsePurchasePriceHistory("bad,10-abc,7-123"), [{ price: 7, at: 123 }]);
  let log = prependPurchasePriceHistory(null, 9, 1000);
  assert.equal(log, "9-1000");
  log = prependPurchasePriceHistory(log, 10.5, 2000);
  assert.equal(log, "10.5-2000,9-1000");
  assert.deepEqual(parsePurchasePriceHistory(log)[0], { price: 10.5, at: 2000 });
  let long = null;
  for (let i = 1; i <= 25; i++) long = prependPurchasePriceHistory(long, i, i * 1000);
  assert.equal(parsePurchasePriceHistory(long).length, 20);
  assert.deepEqual(parsePurchasePriceHistory(long)[0], { price: 25, at: 25000 });
});
