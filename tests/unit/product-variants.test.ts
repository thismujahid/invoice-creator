import { describe, expect, it } from "vitest";
import { cloneVariantSettings, groupProductVariants, groupProductsByVariant, productSkuLabel } from "../../utils/productVariants";
import { repriceUnits, unitReferenceCost } from "../../functions/shared/unitPricing.mjs";
import type { Product } from "../../types";

const pasta: Product = {
  id: "curved", family_id: "pasta", family_name: "مكرونة فيروز", variant_name: "معوجة", name: "معوجة",
  cost_price: 80, last_purchase_base_cost: 100, base_unit_id: "kg", base_unit_name: "كيلو",
  inventory: { loose_base_quantity: 3, closed_packages: { carton: 2 } },
  units: [
    { id: "kg", name: "كيلو", factor: 1, stock_kind: "loose", is_base: true, selling_price: 120, purchase_price: 100 },
    { id: "half", name: "نصف كيلو", factor: 0.5, stock_kind: "loose", selling_price: 65, purchase_price: 50 },
    { id: "carton", name: "كرتونة", factor: 10, stock_kind: "package", selling_price: 1100, purchase_price: 1000 },
  ],
  inventory_alerts: { loose: { reorder_point: 5, target_level: 10 }, packages: { carton: { reorder_point: 2, target_level: 5 } } },
};

describe("product variants", () => {
  it("copies settings without identities, stock, costs or purchase history", () => {
    const clone = cloneVariantSettings(pasta);
    expect(clone.id).toBeUndefined();
    expect(clone.variant_name).toBe("");
    expect(clone.inventory).toEqual({ loose_base_quantity: 0, closed_packages: {} });
    expect(clone.cost_price).toBeNull();
    expect(clone.units?.map(unit => [unit.name, unit.factor, unit.selling_price, unit.purchase_price])).toEqual(pasta.units?.map(unit => [unit.name, unit.factor, unit.selling_price, unit.purchase_price]));
    clone.units![0]!.selling_price = 999;
    clone.inventory_alerts!.packages!.carton!.reorder_point = 99;
    expect(pasta.units![0]!.selling_price).toBe(120);
    expect(pasta.inventory_alerts!.packages!.carton!.reorder_point).toBe(2);
  });
  it("renders one product family containing independently identified variants", () => {
    const groups = groupProductVariants([pasta, { ...pasta, id: "spaghetti", variant_name: "سباجيتي" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("مكرونة فيروز");
    expect(groups[0]?.variants.map(variant => variant.id)).toEqual(["curved", "spaghetti"]);
  });
  it("groups independent package sizes by type without mixing their identities", () => {
    const tea = [
      { ...pasta, id: "green-quarter", inventory_mode: "independent" as const, variant_key: "green", variant_name: "أخضر", pack_size_name: "ربع", pack_size_order: 0 },
      { ...pasta, id: "green-eighth", inventory_mode: "independent" as const, variant_key: "green", variant_name: "أخضر", pack_size_name: "ثمن", pack_size_order: 1 },
      { ...pasta, id: "black-quarter", inventory_mode: "independent" as const, variant_key: "black", variant_name: "أسود", pack_size_name: "ربع", variant_order: 1 },
    ];
    const groups = groupProductsByVariant(tea);
    expect(groups.map(group => [group.name, group.products.map(product => product.pack_size_name)])).toEqual([["أخضر", ["ربع", "ثمن"]], ["أسود", ["ربع"]]]);
    expect(productSkuLabel(tea[0]!)).toBe("أخضر — ربع");
  });
});

describe("automatic unit prices", () => {
  it("converts carton 1100 / 10 into kilo 110 and half 55 while keeping each margin", () => {
    const updated = { ...pasta, last_purchase_base_cost: 1100 / 10 };
    expect(pasta.units!.map(unit => unitReferenceCost(updated, unit))).toEqual([110, 55, 1100]);
    expect(repriceUnits(pasta, 110).map(unit => unit.selling_price)).toEqual([132, 71.5, 1210]);
    expect(pasta.units![0]!.selling_price).toBe(120);
    expect(pasta.cost_price).toBe(80);
  });
  it("manual override establishes a new margin for subsequent purchases", () => {
    const units = repriceUnits(pasta, 110, { kg: { mode: "custom", price: 165 } });
    expect(units[0]?.profit_margin).toBe(0.5);
    expect(repriceUnits({ ...pasta, units, last_purchase_base_cost: 110 }, 120)[0]?.selling_price).toBe(180);
  });
  it("does not accumulate rounding drift or invent margins without a cost", () => {
    const first = repriceUnits(pasta, 100.031);
    const second = repriceUnits({ ...pasta, units: first, last_purchase_base_cost: 100.031 }, 200);
    expect(second.map(unit => unit.selling_price)).toEqual([240, 130, 2200]);
    expect(repriceUnits({ units: [{ id: "kg", factor: 1, selling_price: 15 }] }, 10)[0]?.selling_price).toBe(15);
    expect(() => repriceUnits(pasta, Number.NaN)).toThrow();
  });
});
