import { describe, expect, it } from "vitest";
import {
  addPurchase,
  baseQuantityFor,
  emptyInventory,
  inventoryLabel,
  inventoryTotal,
  lowStockComponents,
  movingAverage,
  removeInventory,
  replayMovementGroup,
  restoreSaleConsumption,
  roundMoney,
  sellInventory,
  setInventoryBucket,
  type InventoryProduct,
} from "../../functions/shared/inventoryCore.mjs";

const pasta: InventoryProduct = {
  id: "pasta-curved",
  base_unit_id: "kg",
  base_unit_name: "كيلو",
  units: [
    { id: "kg", name: "كيلو", factor: 1, stock_kind: "loose", is_base: true, allows_fractional: true },
    { id: "half", name: "نصف كيلو", factor: 0.5, stock_kind: "loose", allows_fractional: false },
    { id: "carton", name: "كرتونة", factor: 10, stock_kind: "package", allows_fractional: false },
    { id: "sack", name: "شيكارة", factor: 25, stock_kind: "package", allows_fractional: false },
  ],
  inventory_alerts: {
    loose: { reorder_point: 5, target_level: 10 },
    packages: {
      carton: { reorder_point: 4, target_level: 8 },
      sack: { reorder_point: 2, target_level: 5 },
    },
  },
};

describe("shared physical inventory core", () => {
  it("keeps bought package counts separate from loose purchases", () => {
    let inventory = emptyInventory();
    inventory = addPurchase(inventory, pasta, "sack", 2).inventory;
    inventory = addPurchase(inventory, pasta, "carton", 4).inventory;
    inventory = addPurchase(inventory, pasta, "kg", 3.5).inventory;

    expect(inventory).toEqual({ loose_base_quantity: 3.5, closed_packages: { sack: 2, carton: 4 } });
    expect(inventoryTotal(inventory, pasta.units)).toBe(93.5);
    expect(inventoryLabel(inventory, pasta)).toBe("2 شيكارة و 4 كرتونة و 3.5 كيلو");
  });

  it("opens the smallest available package atomically when loose stock is short", () => {
    const initial = { loose_base_quantity: 0.2, closed_packages: { carton: 4, sack: 2 } };
    const result = sellInventory(initial, pasta, "half", 1);

    expect(result.opened).toEqual([{ unit_id: "carton", unit_name: "كرتونة", unit_factor: 10, count: 1 }]);
    expect(result.inventory).toEqual({ loose_base_quantity: 9.7, closed_packages: { carton: 3, sack: 2 } });
    expect(result.changes).toEqual({ loose_base_quantity: 9.5, closed_packages: { carton: -1 } });
    expect(inventoryTotal(result.inventory, pasta.units)).toBe(89.7);
  });

  it("opens a carton into intact packs of the same independent size", () => {
    const quarterPacks: InventoryProduct = {
      id: "tea-quarter",
      base_unit_id: "piece",
      base_unit_name: "عبوة",
      units: [
        { id: "piece", name: "عبوة", factor: 1, stock_kind: "loose", is_base: true, allows_fractional: false },
        { id: "carton", name: "كرتونة ربع", factor: 12, stock_kind: "package", allows_fractional: false },
      ],
    };
    const result = sellInventory({ loose_base_quantity: 0, closed_packages: { carton: 1 } }, quarterPacks, "piece", 2);
    expect(result.inventory).toEqual({ loose_base_quantity: 10, closed_packages: { carton: 0 } });
    expect(result.opened).toEqual([{ unit_id: "carton", unit_name: "كرتونة ربع", unit_factor: 12, count: 1 }]);
    expect(() => sellInventory(result.inventory, quarterPacks, "piece", 0.5)).toThrow("FRACTION_NOT_ALLOWED");
  });

  it("uses existing loose stock before opening a package", () => {
    const initial = { loose_base_quantity: 3.5, closed_packages: { carton: 4, sack: 2 } };
    const result = sellInventory(initial, pasta, "half", 1);

    expect(result.opened).toEqual([]);
    expect(result.inventory).toEqual({ loose_base_quantity: 3, closed_packages: { carton: 4, sack: 2 } });
  });

  it("restores a loose sale without resealing a package opened by that sale", () => {
    const initial = { loose_base_quantity: 0, closed_packages: { carton: 1, sack: 0 } };
    const first = sellInventory(initial, pasta, "half", 1);
    const later = sellInventory(first.inventory, pasta, "kg", 1);
    const restored = restoreSaleConsumption(later.inventory, pasta, {
      unit_id: "half", unit_factor: 0.5, product_quantity: 1, base_quantity: 0.5,
    });
    expect(restored.inventory).toEqual({ loose_base_quantity: 9, closed_packages: { carton: 0, sack: 0 } });
  });

  it("rejects a conversion that rounds to zero and preserves valid half-unit quantities", () => {
    expect(baseQuantityFor(1, 0.5)).toBe(0.5);
    expect(() => baseQuantityFor(0.0001, 0.1)).toThrow("BASE_QUANTITY_PRECISION_INVALID");
    const tenth = { ...pasta, units: [{ id: "tenth", name: "عشر كيلو", is_base: false, factor: 0.1, stock_kind: "loose" as const, allows_fractional: true }] };
    expect(() => addPurchase(emptyInventory(), tenth, "tenth", 0.0001)).toThrow("BASE_QUANTITY_PRECISION_INVALID");
    expect(() => sellInventory({ loose_base_quantity: 1, closed_packages: {} }, tenth, "tenth", 0.0001)).toThrow("BASE_QUANTITY_PRECISION_INVALID");
  });

  it("replays a mixed atomic movement group using each historical movement cost", () => {
    const result = replayMovementGroup(10, 15, [
      { direction: "in", base_quantity: 5, unit_cost: 10 },
      { direction: "out", base_quantity: 5, unit_cost: 20 },
    ]);
    expect(result).toEqual({ stock: 10, average: 10, untrusted: false });
  });

  it("requires a sealed package for a package sale and rejects insufficient stock", () => {
    const inventory = { loose_base_quantity: 30, closed_packages: { carton: 0, sack: 1 } };
    expect(() => sellInventory(inventory, pasta, "carton", 1)).toThrow("STOCK_INSUFFICIENT");
    expect(() => sellInventory({ loose_base_quantity: 0, closed_packages: { carton: 1 } }, pasta, "carton", 0.5)).toThrow("FRACTION_NOT_ALLOWED");
  });

  it("removes supplier returns from the chosen physical component without opening packages", () => {
    const initial = { loose_base_quantity: 3, closed_packages: { carton: 2, sack: 1 } };
    const loose = removeInventory(initial, pasta, "loose", "kg", 1.5);
    expect(loose.inventory).toEqual({ loose_base_quantity: 1.5, closed_packages: { carton: 2, sack: 1 } });
    const carton = removeInventory(initial, pasta, "package", "carton", 10);
    expect(carton.inventory).toEqual({ loose_base_quantity: 3, closed_packages: { carton: 1, sack: 1 } });
    expect(() => removeInventory(initial, pasta, "loose", "kg", 4)).toThrow("STOCK_INSUFFICIENT");
    expect(() => removeInventory(initial, pasta, "package", "carton", 5)).toThrow("RETURN_NOT_WHOLE_PACKAGE");
  });

  it("tracks independent component alerts and lets an adjustment target one bucket", () => {
    const inventory = { loose_base_quantity: 2, closed_packages: { carton: 3, sack: 1 } };
    const alerts = lowStockComponents({ ...pasta, inventory });
    expect(alerts.map((row) => [row.bucket, row.unit_id])).toEqual([["loose", "kg"], ["package", "carton"], ["package", "sack"]]);

    const adjusted = setInventoryBucket(inventory, pasta, "package", "carton", 6);
    expect(adjusted.inventory).toEqual({ loose_base_quantity: 2, closed_packages: { carton: 6, sack: 1 } });
    expect(adjusted.changes.closed_packages).toEqual({ carton: 3 });
  });

  it("supports fractional conversion units and weighted average cost without early rounding", () => {
    const halves = addPurchase(emptyInventory(), pasta, "half", 3);
    expect(halves.base_quantity).toBe(1.5);
    expect(movingAverage(60, 25.12345678, 5, 151.23456789)).toBeCloseTo((60 * 25.12345678 + 151.23456789) / 65, 12);
    expect(roundMoney(1.005)).toBe(1.01);
  });
});
