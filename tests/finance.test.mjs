import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStockGroup,
  isLowStock,
  proposedSellingPrice,
  restoreGroupsForEdit,
} from "../composables/finance.ts";

test("moving weighted average stays aligned with sale and historical replay", () => {
  const afterFirstPurchase = applyStockGroup(0, undefined, 0, [{ qty: 10, cost: 100 }]);
  const afterSale = applyStockGroup(afterFirstPurchase.stock, afterFirstPurchase.avg, 8, []);
  const afterSecondPurchase = applyStockGroup(afterSale.stock, afterSale.avg, 0, [{ qty: 10, cost: 200 }]);

  assert.equal(afterSecondPurchase.stock, 12);
  assert.equal(Math.round(afterSecondPurchase.avg * 100) / 100, 183.33);
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
