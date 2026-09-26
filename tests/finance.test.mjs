import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStockGroup,
  isLowStock,
  proposedSellingPrice,
  restoreGroupsForEdit,
} from "../composables/finance.ts";
import { deriveSupplierInvoiceStatus, supplierInvoiceStatus } from "../types/finance.ts";
import { invoiceDayKey, invoiceMonthKey, invoicePaymentStatus, invoiceStatsDelta, invoiceStatsOf } from "../composables/invoiceStats.ts";

test("moving weighted average stays aligned with sale and historical replay", () => {
  const afterFirstPurchase = applyStockGroup(0, undefined, 0, [{ qty: 10, cost: 100 }]);
  const afterSale = applyStockGroup(afterFirstPurchase.stock, afterFirstPurchase.avg, 8, []);
  const afterSecondPurchase = applyStockGroup(afterSale.stock, afterSale.avg, 0, [{ qty: 10, cost: 200 }]);

  assert.equal(afterSecondPurchase.stock, 12);
  assert.equal(Math.round(afterSecondPurchase.avg * 100) / 100, 183.33);
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
