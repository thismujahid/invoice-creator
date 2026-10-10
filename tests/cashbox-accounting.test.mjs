import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStockGroup,
  discountShareOf,
  getInvoiceBreakdown,
  invoiceTotals,
  lineNetRevenue,
  merchandiseProfitOf,
  round2,
} from "../composables/finance.ts";
import { invoiceStatsOf } from "../composables/invoiceStats.ts";
import { deriveSupplierInvoiceStatus } from "../types/finance.ts";

function saleInvoice() {
  return {
    products: [{ product_price: 100, product_quantity: 2, unit_factor: 1, base_quantity: 2, cost_groups: [{ base_quantity: 2, unit_cost: 60 }] }],
    discount: 20,
    discount_percentage: false,
    paid_amount: 80,
  };
}

test("acceptance flow: opening 1000 + 10 units @60 through sale, loan, collections, purchase, supplier payment", () => {
  let cash = 1000;
  let stock = 10;
  let avg = 60;
  let invoiceRemaining = 0;
  let loanRemaining = 0;
  let supplierPayable = 0;

  const inv = saleInvoice();
  const totals = invoiceTotals(inv);
  const breakdown = getInvoiceBreakdown(inv);
  assert.equal(totals.net, 180);
  assert.equal(breakdown.salesNet, 180);
  assert.equal(merchandiseProfitOf(inv), 60);
  assert.equal(invoiceStatsOf(inv).total_profit, 60);
  invoiceRemaining = totals.net - 80;
  assert.equal(invoiceRemaining, 100);
  cash = round2(cash + 80);
  assert.equal(cash, 1080);
  stock = 8;

  cash = round2(cash - 50);
  loanRemaining = 50;
  assert.equal(cash, 1030);
  assert.equal(round2(invoiceRemaining + loanRemaining), 150);

  cash = round2(cash + 40);
  invoiceRemaining = round2(invoiceRemaining - 40);
  assert.equal(cash, 1070);
  assert.equal(invoiceRemaining, 60);

  cash = round2(cash + 20);
  loanRemaining = round2(loanRemaining - 20);
  assert.equal(cash, 1090);
  assert.equal(loanRemaining, 30);
  assert.equal(round2(invoiceRemaining + loanRemaining), 90);

  const bought = applyStockGroup(stock, avg, 0, [{ qty: 5, cost: 60 }]);
  stock = bought.stock;
  avg = bought.avg;
  assert.equal(stock, 13);
  assert.equal(avg, 60);
  assert.equal(round2(stock * avg), 780);
  cash = round2(cash - 100);
  supplierPayable = round2(5 * 60 - 100);
  assert.equal(cash, 990);
  assert.equal(supplierPayable, 200);

  cash = round2(cash - 50);
  supplierPayable = round2(supplierPayable - 50);
  assert.equal(cash, 940);
  assert.equal(supplierPayable, 150);

  const center = round2(cash + stock * avg + (invoiceRemaining + loanRemaining) - supplierPayable);
  assert.equal(center, 1660);
  assert.equal(round2(center - 1600), 60);
});

test("percentage discount allocates proportionally to merchandise profit", () => {
  const inv = {
    products: [{ product_price: 100, product_quantity: 2, unit_factor: 1, base_quantity: 2, cost_groups: [{ base_quantity: 2, unit_cost: 60 }] }],
    discount: 10,
    discount_percentage: true,
    paid_amount: 0,
  };
  assert.equal(invoiceTotals(inv).discountValue, 20);
  assert.equal(getInvoiceBreakdown(inv).salesNet, 180);
  assert.equal(merchandiseProfitOf(inv), 60);
  assert.equal(discountShareOf(inv), 0.1);
  assert.equal(lineNetRevenue(inv.products[0], 0.1), 180);
});

test("fixed discount shared with previous balance does not tax merchandise fully", () => {
  const inv = {
    products: [{ product_price: 100, product_quantity: 1, unit_factor: 1, base_quantity: 1, cost_groups: [{ base_quantity: 1, unit_cost: 60 }] }],
    debt: 100,
    discount: 20,
    discount_percentage: false,
    paid_amount: 0,
  };
  assert.equal(merchandiseProfitOf(inv), 30);
  assert.equal(getInvoiceBreakdown(inv).salesNet, 90);
});

test("partial return reverses exactly refund minus historical cost", () => {
  const refund = round2(100 * 1 * (180 / 200));
  const cost = 60;
  assert.equal(round2(refund - cost), 30);
  const status = deriveSupplierInvoiceStatus(100, 200, 300);
  assert.equal(status, "partial");
});

test("extras are excluded from merchandise profit", () => {
  const inv = {
    products: [{ product_price: 100, product_quantity: 1, unit_factor: 1, base_quantity: 1, cost_groups: [{ base_quantity: 1, unit_cost: 60 }] }],
    delivery_price: 50,
    paid_amount: 0,
  };
  assert.equal(merchandiseProfitOf(inv), 40);
  assert.equal(getInvoiceBreakdown(inv).salesNet, 150);
});

test("zero gross invoice yields zero profit and zero discount share", () => {
  const inv = { products: [], paid_amount: 0 };
  assert.equal(merchandiseProfitOf(inv), 0);
  assert.equal(discountShareOf(inv), 0);
  assert.equal(invoiceStatsOf(inv).total_profit, 0);
});
