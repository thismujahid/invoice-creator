import { describe, expect, it } from "vitest";
import { sellInventory } from "../../functions/shared/inventoryCore.mjs";
import type { Product } from "../../types/index";
import {
  aggregatePurchaseByProduct,
  applyStockGroup,
  baseEquivalentSellingPrice,
  decomposeStock,
  getLineCost,
  inventoryAggregates,
  invoiceEditStockChanges,
  isLowStock,
  isOutOfStock,
  hasShortageAlert,
  movingAverageCost,
  previewBasePurchase,
  purchaseLineBaseCost,
  purchaseLineBaseQuantity,
  round2,
  round4,
  shortageAvgFormula,
  shortageUnitRowsOf,
  stockQuantityLabel,
  toBaseQuantity,
  toNum,
  toUnitQuantity,
  unitAverageCost,
  unitStockDisplay,
  validateUnitFactor,
  validateUnitQuantity,
} from "../../composables/finance";

function sugar(overrides: Partial<Product> = {}): Product {
  const quantity = Number(overrides.stock_quantity ?? 63);
  const inventory = overrides.inventory ?? {
    loose_base_quantity: round4(quantity % 20),
    closed_packages: { carton: Math.floor(quantity / 20) },
  };
  const units = overrides.units ?? [
    { id: "kg", name: "KG", factor: 1, stock_kind: "loose" as const, selling_price: 35, purchase_price: 25, is_base: true, can_purchase: true, can_sell: true },
    { id: "carton", name: "Carton", factor: 20, stock_kind: "package" as const, selling_price: 650, purchase_price: 600, is_base: false, can_purchase: true, can_sell: true },
  ];
  return {
    name: "Sugar",
    cost_price: 25,
    stock_quantity: quantity,
    inventory,
    inventory_alerts: { loose: { reorder_point: 3, target_level: 5 }, packages: { carton: { reorder_point: 3, target_level: 4 } } },
    base_unit_id: "kg",
    base_unit_name: "KG",
    units,
    ...overrides,
  };
}

describe("unified canonical inventory (base-unit single source of truth)", () => {
  it("1. purchasing base units increases stock and blends the average", () => {
    const p = sugar();
    const { baseQty, baseCost, newAvg } = previewBasePurchase(p.stock_quantity, p.cost_price, 5, 30, 1);
    expect(baseQty).toBe(5);
    expect(baseCost).toBe(30);
    expect(newAvg).toBeCloseTo((63 * 25 + 5 * 30) / 68, 4);
    const r = applyStockGroup(63, 25, 0, [{ qty: baseQty, cost: baseCost }]);
    expect(r.stock).toBe(68);
    expect(r.avg).toBeCloseTo(newAvg, 4);
  });

  it("2. purchasing larger units converts via factor (2 cartons = 40 KG)", () => {
    const p = sugar();
    const { baseQty, baseCost, newAvg } = previewBasePurchase(p.stock_quantity, p.cost_price, 2, 600, 20);
    expect(baseQty).toBe(40);
    expect(baseCost).toBe(30);
    expect(newAvg).toBeCloseTo((63 * 25 + 40 * 30) / 103, 4);
  });

  it("3. selling base units decreases stock without touching the average", () => {
    const r = applyStockGroup(63, 25, 5, []);
    expect(r.stock).toBe(58);
    expect(r.avg).toBe(25);
  });

  it("4. selling larger units decreases by factor (1 carton = 20 KG)", () => {
    const r = applyStockGroup(63, 25, toBaseQuantity(1, 20), []);
    expect(r.stock).toBe(43);
    expect(r.avg).toBe(25);
  });

  it("5. mixed-unit purchases aggregate deterministically", () => {
    const map = aggregatePurchaseByProduct([
      { product_id: "sugar", baseQty: 40, lineTotal: 1200 },
      { product_id: "sugar", baseQty: 5, lineTotal: 150 },
    ]);
    const agg = map.get("sugar")!;
    expect(agg.baseQty).toBe(45);
    expect(agg.totalCost).toBe(1350);
    expect(agg.baseCost).toBeCloseTo(30, 9);
    expect(movingAverageCost(63, 25, agg.baseQty, agg.baseCost)).toBeCloseTo((63 * 25 + 45 * 30) / 108, 9);
  });

  it("6. mixed-unit sales sum in base terms", () => {
    const need = round4(toBaseQuantity(1, 20) + toBaseQuantity(5, 1));
    expect(need).toBe(25);
    const r = applyStockGroup(63, 25, need, []);
    expect(r.stock).toBe(38);
  });

  it("7. stock decomposition is exact (no 2.9-carton ambiguity)", () => {
    expect(stockQuantityLabel(sugar())).toBe("3 Carton و 3 KG");
    expect(stockQuantityLabel(sugar({ stock_quantity: 58 }))).toBe("2 Carton و 18 KG");
    expect(stockQuantityLabel(sugar({ stock_quantity: 40 }))).toBe("2 Carton");
    expect(stockQuantityLabel(sugar({ stock_quantity: 5 }))).toBe("5 KG");
    const parts = decomposeStock(sugar());
    expect(parts).toEqual([
      { unit: expect.objectContaining({ id: "carton" }), qty: 3 },
      { unit: expect.objectContaining({ id: "kg" }), qty: 3 },
    ]);
  });

  it("8. weighted-average matches the spec example (26.2048/KG, 524.0964/carton)", () => {
    const avg = movingAverageCost(63, 25, 20, 30);
    expect(avg).toBeCloseTo(26.2048192771, 6);
    expect(round4(avg)).toBeCloseTo(26.2048, 4);
    const carton = unitAverageCost(sugar({ cost_price: round4(avg) }), { id: "carton", name: "Carton", factor: 20, stock_kind: "package", selling_price: 650 });
    expect(carton).toBeCloseTo(524.096, 3);
  });

  it("9. purchasing into zero stock adopts the new base cost", () => {
    expect(movingAverageCost(0, 0, 20, 30)).toBe(30);
    expect(movingAverageCost(0, null as unknown as number, 20, 30)).toBe(30);
    const r = applyStockGroup(0, undefined, 0, [{ qty: 20, cost: 30 }]);
    expect(r.avg).toBe(30);
  });

  it("10. selling prices stay independent per unit", () => {
    const p = sugar();
    const kg = p.units!.find((u) => u.id === "kg")!;
    const carton = p.units!.find((u) => u.id === "carton")!;
    expect(kg.selling_price).toBe(35);
    expect(carton.selling_price).toBe(650);
    expect(carton.selling_price).not.toBe(kg.selling_price! * 20);
  });

  it("11. historical COGS snapshots survive edits (cost_groups)", () => {
    const line = {
      product_price: 35,
      product_quantity: 5,
      base_quantity: 5,
      cost_groups: [{ base_quantity: 5, unit_cost: 25 }],
    };
    expect(getLineCost(line)).toBe(125);
  });

  it("12. invoice edits retain front cost groups and report takes/restores", () => {
    const oldLines = [{
      line_id: "l1", product_id: "sugar", product_name: "Sugar", product_price: 35,
      product_quantity: 5, unit_factor: 1, base_quantity: 5, product_cost_price: 25,
      base_cost_snapshot: 25, cost_groups: [{ base_quantity: 5, unit_cost: 25 }],
    }];
    const grown = invoiceEditStockChanges(oldLines, [{
      line_id: "l1", product_id: "sugar", product_name: "Sugar", product_price: 35,
      product_quantity: 8, unit_factor: 1, base_quantity: 8,
    }], new Map([["sugar", 26]]));
    expect(grown.takes).toHaveLength(1);
    expect(grown.takes[0]!.delta).toBe(-3);
    expect(grown.restores).toHaveLength(0);
    const shrunk = invoiceEditStockChanges(oldLines, [{
      line_id: "l1", product_id: "sugar", product_name: "Sugar", product_price: 35,
      product_quantity: 2, unit_factor: 1, base_quantity: 2,
    }], new Map([["sugar", 26]]));
    expect(shrunk.takes).toHaveLength(0);
    expect(shrunk.restores.reduce((s, g) => s + g.qty, 0)).toBe(3);
  });

  it("13. customer returns restock at historical cost and blend the average", () => {
    // Sold 5 KG @25 from 63 → 58; return 2 KG @25 → 60, avg stays 25.
    const afterSale = applyStockGroup(63, 25, 5, []);
    const afterReturn = applyStockGroup(afterSale.stock, afterSale.avg, 0, [{ qty: 2, cost: 25 }]);
    expect(afterReturn.stock).toBe(60);
    expect(afterReturn.avg).toBe(25);
    // Return at a different historical cost blends like a purchase.
    const blended = applyStockGroup(58, 25, 0, [{ qty: 2, cost: 30 }]);
    expect(blended.avg).toBeCloseTo((58 * 25 + 2 * 30) / 60, 4);
  });

  it("14. supplier returns take stock only — cost untouched", () => {
    const r = applyStockGroup(68, 26.2, 20, []);
    expect(r.stock).toBe(48);
    expect(r.avg).toBe(26.2);
  });

  it("15. manual adjustments: inbound carries current avg, outbound is take-only", () => {
    const inbound = applyStockGroup(58, 25, 0, [{ qty: 2, cost: 25 }]);
    expect(inbound).toEqual({ stock: 60, avg: 25 });
    const outbound = applyStockGroup(60, 25, 3, []);
    expect(outbound).toEqual({ stock: 57, avg: 25 });
    // Costless inbound is tracked as plain qty (repair treats it untrusted).
    const plain = applyStockGroup(58, 25, 0, [{ qty: 2, cost: null }]);
    expect(plain.stock).toBe(60);
    expect(plain.avg).toBe(25);
  });

  it("16. concurrent takes + inflows apply in one deterministic batch", () => {
    const a = applyStockGroup(60, 25, 10, [{ qty: 20, cost: 30 }]);
    const b = applyStockGroup(60, 25, 10, [{ qty: 20, cost: 30 }]);
    expect(a).toEqual(b);
    expect(a.stock).toBe(70);
    expect(a.avg).toBeCloseTo((50 * 25 + 20 * 30) / 70, 4);
  });

  it("17. insufficient stock is detectable before commit", () => {
    const p = sugar({ stock_quantity: 58 });
    const need = toBaseQuantity(4, 20); // 4 cartons = 80 KG
    expect(need - toNum(p.stock_quantity)).toBeGreaterThan(0);
    expect(toBaseQuantity(2, 20) - toNum(p.stock_quantity)).toBeLessThanOrEqual(0);
  });

  it("18. low-stock: one product = one alert; zero mutes", () => {
    expect(isLowStock(sugar())).toBe(false); // 3 loose KG and 3 cartons meet their component points
    expect(isLowStock(sugar({ stock_quantity: 58 }))).toBe(true);
    expect(isOutOfStock(sugar({ stock_quantity: 0 }))).toBe(true);
    expect(hasShortageAlert(sugar())).toBe(true);
    expect(hasShortageAlert(sugar({ inventory_alerts: { loose: { reorder_point: 0 }, packages: { carton: { reorder_point: 0 } } }, stock_quantity: 0 }))).toBe(false);
    const rows = shortageUnitRowsOf([
      sugar({ stock_quantity: 22 }),
      sugar({ id: "x", name: "Rice", stock_quantity: 100, inventory_alerts: { loose: { reorder_point: 0 }, packages: { carton: { reorder_point: 0 } } } }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.product.name).toBe("Sugar");
    expect(new Set(rows.map((row) => row.bucket))).toEqual(new Set(["loose", "package"]));
  });

  it("19. Excel average formula agrees with app math", () => {
    const f = shortageAvgFormula({ ownRow: 2, oldBaseAvg: 25, stockBase: 63, factor: 20 });
    expect(f).toContain("C2");
    expect(f).toContain("D2");
    expect(f).toContain("63");
    expect(f).toContain("*20");
    // Excel semantics: (63*25 + 2*600) / (63 + 2*20) for 2 cartons @600.
    const excelValue = (63 * 25 + 2 * 600) / (63 + 2 * 20);
    expect(excelValue).toBeCloseTo(movingAverageCost(63, 25, 40, 30), 9);
    // Empty stock takes the row base cost (D/factor).
    expect(600 / 20).toBe(30);
  });

  it("20. financial valuation is consistent (cost = stock × avg)", () => {
    const agg = inventoryAggregates([sugar(), sugar({ id: "r", name: "Rice", stock_quantity: 10, cost_price: 20, inventory: { loose_base_quantity: 10, closed_packages: {} }, units: [{ id: "kg", name: "KG", factor: 1, stock_kind: "loose", selling_price: 30, is_base: true }] })]);
    expect(agg.costValue).toBe(round2(63 * 25 + 10 * 20));
    // Sugar base-equivalent price: base KG sells at 35 → forecast uses 35.
    expect(baseEquivalentSellingPrice(sugar())).toBe(35);
    expect(agg.saleValue).toBe(round2(63 * 35 + 10 * 30));
    expect(agg.expectedProfit).toBe(round2(agg.saleValue - agg.costValue));
  });

  it("21. fractional quantities respect per-unit permissions", () => {
    expect(validateUnitQuantity({ allows_fractional: true }, 2.5)).toBeNull();
    expect(validateUnitQuantity({ allows_fractional: false }, 2.5)).not.toBeNull();
    expect(validateUnitQuantity({}, 2)).toBeNull();
    expect(validateUnitQuantity({}, 0)).not.toBeNull();
    expect(unitStockDisplay(sugar({ stock_quantity: 63, inventory: { loose_base_quantity: 63, closed_packages: {} } }), { id: "carton", name: "Carton", factor: 20, stock_kind: "package", selling_price: 650 })).toBe(0);
    expect(toUnitQuantity(63, 20)).toBeCloseTo(3.15, 9);
  });

  it("22. conversion factors are validated (base = 1, others > 0)", () => {
    expect(validateUnitFactor({ factor: 1, is_base: true })).toBeNull();
    expect(validateUnitFactor({ factor: 2, is_base: true })).not.toBeNull();
    expect(validateUnitFactor({ factor: 20 })).toBeNull();
    expect(validateUnitFactor({ factor: 0 })).not.toBeNull();
    expect(validateUnitFactor({ factor: -3 })).not.toBeNull();
    expect(() => toBaseQuantity(2, 0)).toThrow();
    expect(purchaseLineBaseQuantity(2, 20)).toBe(40);
    expect(purchaseLineBaseCost(600, 20)).toBe(30);
  });
});


describe("unit availability including unopened packages", () => {
  it("shows one carton as ten kilos or twenty half kilos and opens it on sale", () => {
    const units = [
      { id: "kg", name: "KG", factor: 1, stock_kind: "loose" as const, selling_price: 40, is_base: true },
      { id: "half", name: "Half", factor: 0.5, stock_kind: "loose" as const, selling_price: 20 },
      { id: "carton", name: "Carton", factor: 10, stock_kind: "package" as const, selling_price: 400 },
    ];
    const product = sugar({ units, inventory: { loose_base_quantity: 0, closed_packages: { carton: 1 } } });
    expect(units.map((unit) => unitStockDisplay(product, unit))).toEqual([10, 20, 1]);
    const sale = sellInventory(product.inventory!, { base_unit_id: "kg", units }, "kg", 1);
    const remaining = { ...product, inventory: sale.inventory };
    expect(units.map((unit) => unitStockDisplay(remaining, unit))).toEqual([9, 18, 0]);
  });
  it("does not offer fractional counts for indivisible loose units", () => {
    const product = sugar({ inventory: { loose_base_quantity: 1.5, closed_packages: {} } });
    expect(unitStockDisplay(product, product.units![0]!)).toBe(1);
    expect(unitStockDisplay(product, { ...product.units![0]!, allows_fractional: true })).toBe(1.5);
  });
});


it("shows five sealed cartons rather than the base balance in an invoice", () => {
  const product = sugar({ stock_quantity: 85, inventory: { loose_base_quantity: 5, closed_packages: { carton: 5 } }, units: [
    { id: "kg", name: "KG", factor: 1, stock_kind: "loose", selling_price: 12, is_base: true },
    { id: "carton", name: "Carton", factor: 16, stock_kind: "package", selling_price: 190 },
  ] });
  expect(unitStockDisplay(product, product.units![1]!)).toBe(5);
  expect(unitStockDisplay(product, product.units![0]!)).toBe(85);
});
