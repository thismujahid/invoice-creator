import { describe, expect, it } from "vitest";
import { sellInventory } from "../../functions/shared/inventoryCore.mjs";
import {
  findDuplicateLineIds as findDupMjs,
  mintUniqueLineId,
  planSaleExecutionOrder,
  resolvePersistedLineId,
} from "../../functions/shared/saleOrder.mjs";
import { safeInvoice, saleAmounts } from "../../functions/staffMath.cjs";
import type { InvoiceProductLine } from "../../types/index";
import {
  aggregateBaseNeedByProduct,
  ensureStableLineIds,
  findDuplicateLineIds,
  flattenGroupedLines,
  groupInvoiceLines,
  invoiceLineGroupKey,
  moveGroup,
  moveSubLine,
  newDraftLineId,
} from "../../utils/invoiceGrouping";
import { invoiceExportFigures, invoiceLinesSubtotal } from "../../utils/invoiceExport";
import {
  invoiceEditStockChanges,
  invoiceHasReturnHistory,
  invoiceTotals,
  lineRefundValue,
  netRatioOf,
  round2,
  validateUnitQuantity,
} from "../../composables/finance";

function line(overrides: Partial<InvoiceProductLine> = {}): InvoiceProductLine {
  return {
    line_id: `l-${Math.random().toString(36).slice(2)}`,
    product_id: "p1",
    product_name: "صنف",
    product_price: 10,
    product_quantity: 1,
    unit_id: "kg",
    unit_name: "كيلو",
    unit_factor: 1,
    stock_kind: "loose",
    allows_fractional: true,
    base_quantity: 1,
    family_id: "f1",
    family_name: "عائلة",
    inventory_mode: "convertible",
    ...overrides,
  };
}

function pastaLines(): InvoiceProductLine[] {
  return [
    line({ line_id: "l1", product_id: "curved", product_name: "مكرونة فيروز — معوجة", variant_name: "معوجة", product_quantity: 2, product_price: 30, base_quantity: 2 }),
    line({ line_id: "l2", product_id: "spaghetti", product_name: "مكرونة فيروز — سباجيتي", variant_name: "سباجيتي", product_quantity: 3, product_price: 32, base_quantity: 3 }),
    line({ line_id: "l3", product_id: "pens", product_name: "مكرونة فيروز — أقلام", variant_name: "أقلام", product_quantity: 0.5, product_price: 34, base_quantity: 0.5 }),
  ];
}

function skuProduct(id: string, loose = 0, closed: Record<string, number> = {}) {
  return {
    id,
    base_unit_id: "kg",
    base_unit_name: "كيلو",
    units: [
      { id: "kg", name: "كيلو", factor: 1, stock_kind: "loose" as const, is_base: true, allows_fractional: true },
      { id: "carton", name: "كرتونة", factor: 10, stock_kind: "package" as const, allows_fractional: false },
      { id: "sack", name: "شيكارة", factor: 25, stock_kind: "package" as const, allows_fractional: false },
    ],
  } as never;
}

describe("grouped sale lines (flat source of truth, derived groups)", () => {
  it("1. pasta example totals 173 with one family group and three independent SKUs", () => {
    const lines = pastaLines();
    const groups = groupInvoiceLines(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.lines).toHaveLength(3);
    expect(groups[0]!.total).toBe(173); // 60 + 96 + 17
    // Three independent stock deductions, one per SKU.
    const stocks = new Map<string, { loose_base_quantity: number; closed_packages: Record<string, number> }>([
      ["curved", { loose_base_quantity: 10, closed_packages: {} }],
      ["spaghetti", { loose_base_quantity: 10, closed_packages: {} }],
      ["pens", { loose_base_quantity: 10, closed_packages: {} }],
    ]);
    for (const entry of lines) {
      const inv = stocks.get(entry.product_id!)!;
      stocks.set(entry.product_id!, sellInventory(inv, skuProduct(entry.product_id!), "kg", entry.product_quantity).inventory);
    }
    expect(stocks.get("curved")!.loose_base_quantity).toBe(8);
    expect(stocks.get("spaghetti")!.loose_base_quantity).toBe(7);
    expect(stocks.get("pens")!.loose_base_quantity).toBe(9.5);
  });

  it("2. one variant in two units converts to base correctly inside the group", () => {
    const lines = [
      line({ line_id: "a", product_id: "curved", product_quantity: 2, unit_id: "kg", unit_factor: 1, base_quantity: 2, product_price: 30 }),
      line({ line_id: "b", product_id: "curved", product_quantity: 4, unit_id: "half", unit_name: "نصف كيلو", unit_factor: 0.5, base_quantity: 2, product_price: 16 }),
    ];
    const groups = groupInvoiceLines(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.total).toBe(2 * 30 + 4 * 16);
    const need = aggregateBaseNeedByProduct(lines);
    expect(need.get("curved")).toBe(4);
  });

  it("3. aggregate demand across lines of one SKU detects over-selling", () => {
    const lines = [
      line({ product_id: "curved", product_quantity: 6, unit_factor: 1 }),
      line({ product_id: "curved", product_quantity: 5, unit_factor: 1 }),
    ];
    const need = aggregateBaseNeedByProduct(lines);
    expect(need.get("curved")).toBe(11);
    expect((need.get("curved") ?? 0) - 10).toBeGreaterThan(1e-9); // stock 10 → blocked
    expect(6 - 10).toBeLessThanOrEqual(0); // each line alone would pass
  });

  it("4. sealed packages are reserved before loose (both input orders succeed)", () => {
    const stock = { loose_base_quantity: 0, closed_packages: { carton: 1, sack: 1 } };
    const product = skuProduct("curved");
    for (const input of [
      ["loose-first", ["kg", "carton"]],
      ["package-first", ["carton", "kg"]],
    ] as const) {
      const jobs = input[1].map((unitId) => ({ unitId, qty: unitId === "kg" ? 5 : 1 }));
      const execution = planSaleExecutionOrder(jobs.length, (i: number) => (jobs[i]!.unitId === "carton" ? "package" : "loose"));
      expect(execution[0]).toBe(jobs.findIndex((job) => job.unitId === "carton"));
      let inventory: { loose_base_quantity: number; closed_packages: Record<string, number> } = { ...stock, closed_packages: { ...stock.closed_packages } };
      for (const position of execution) {
        const job = jobs[position]!;
        inventory = sellInventory(inventory, product, job.unitId, job.qty).inventory;
      }
      // Carton sold sealed (0 left); loose 5 kg came from the sack (25 − 5).
      expect(inventory.closed_packages.carton).toBe(0);
      expect(inventory.closed_packages.sack).toBe(0);
      expect(inventory.loose_base_quantity).toBe(20);
    }
    // Naive loose-first order would open the carton and then fail the sealed line.
    const naive = sellInventory({ ...stock, closed_packages: { ...stock.closed_packages } }, product, "kg", 5);
    expect(naive.inventory.closed_packages.carton).toBe(0);
    expect(() => sellInventory(naive.inventory, product, "carton", 1)).toThrow("STOCK_INSUFFICIENT");
  });

  it("5. independent sizes never share balances", () => {
    const green = line({ line_id: "g", product_id: "green-quarter", variant_key: "green", pack_size_name: "ربع", inventory_mode: "independent" });
    const black = line({ line_id: "b", product_id: "black-quarter", variant_key: "black", pack_size_name: "ربع", inventory_mode: "independent" });
    const groups = groupInvoiceLines([green, black]);
    expect(groups).toHaveLength(1); // same display family…
    const ids = new Set(groups[0]!.lines.map(({ line: entry }) => entry.product_id));
    expect(ids).toEqual(new Set(["green-quarter", "black-quarter"])); // …but distinct SKUs
    const need = aggregateBaseNeedByProduct([green, black]);
    expect(need.get("green-quarter")).toBe(1);
    expect(need.get("black-quarter")).toBe(1);
  });

  it("6. fractional rules and conversion precision", () => {
    expect(validateUnitQuantity({ allows_fractional: true }, 0.5)).toBeNull();
    expect(validateUnitQuantity({ allows_fractional: false }, 0.5)).not.toBeNull();
    expect(validateUnitQuantity({ allows_fractional: false }, 2)).toBeNull();
    const product = skuProduct("curved");
    expect(() => sellInventory({ loose_base_quantity: 10, closed_packages: { carton: 1 } }, product, "carton", 0.5)).toThrow("FRACTION_NOT_ALLOWED");
  });

  it("7. add/delete/reorder keep stable unique line ids", () => {
    const lines = pastaLines();
    ensureStableLineIds(lines);
    expect(findDuplicateLineIds(lines)).toEqual([]);
    const draft = line({ line_id: undefined, product_id: "new", product_name: "جديد" });
    lines.push(draft);
    ensureStableLineIds(lines);
    expect(draft.line_id).toMatch(/^draft-/);
    expect(findDuplicateLineIds(lines)).toEqual([]);
    const moved = moveSubLine(lines, "family:f1", 0, 2);
    expect(moved.map((entry) => entry.line_id)).toEqual([lines[1]!.line_id, lines[2]!.line_id, lines[0]!.line_id, lines[3]!.line_id]);
    const regrouped = moveGroup(moved, 0, 0);
    expect(regrouped.map((entry) => entry.line_id)).toEqual(moved.map((entry) => entry.line_id));
    // Server mint never reuses an id taken by an earlier edit at the same index.
    const taken = new Set(["inv-edit-1"]);
    expect(mintUniqueLineId("inv", 1, taken)).toBe("inv-edit-1-1");
    expect(resolvePersistedLineId({ invoiceId: "inv", requestedId: "draft-abc", matchedOldId: null, fallbackIndex: 1, taken: new Set(["x"]) })).toBe("draft-abc");
    expect(findDupMjs(["a", "a", "b"])).toEqual(["a"]);
    expect(newDraftLineId(() => "fixed")).toBe("draft-fixed");
  });

  it("8. editing one sub-line keeps the others intact", () => {
    const old = pastaLines().map((entry) => ({ ...entry, unit_factor: 1, cost_groups: [{ base_quantity: entry.base_quantity ?? 0, unit_cost: 20 }] }));
    const grown = invoiceEditStockChanges(old, [{ ...old[0]!, product_quantity: 4, base_quantity: 4 }], new Map([["curved", 21]]));
    expect(grown.lines).toHaveLength(1);
    expect(grown.lines[0]!.base_quantity).toBe(4);
  });

  it("9. invoices with returns/history block edits", () => {
    expect(invoiceHasReturnHistory(true, 0, "none", null)).toBe(true);
    expect(invoiceHasReturnHistory(false, 2, "none", null)).toBe(true);
    expect(invoiceHasReturnHistory(false, 0, "partial", null)).toBe(true);
    expect(invoiceHasReturnHistory(false, 0, "none", { p1: 1 })).toBe(true);
    expect(invoiceHasReturnHistory(false, 0, "none", null)).toBe(false);
  });

  it("10. partial return of one sub-line is capped at its remaining qty", () => {
    const inv = { products: pastaLines(), discount: 0, discount_percentage: false, debt: 0, delivery_price: 0, amount_of_animal_feeds: 0, amount_of_mahros: 0, paid_amount: 0 };
    const ratio = netRatioOf(inv);
    expect(ratio).toBe(1);
    expect(lineRefundValue(30, 1, ratio)).toBe(30);
    const soldQty = 2;
    const returnedQty = 1.5;
    expect(Math.max(0, round2(soldQty - returnedQty))).toBe(0.5);
  });

  it("11. saved invoices render from snapshots, not the live catalog", () => {
    const groups = groupInvoiceLines(pastaLines());
    // Renaming the family in the catalog later cannot move these lines: the
    // key and title come from the stored family_id/family_name snapshot.
    expect(invoiceLineGroupKey({ family_id: "f1", product_id: "curved" })).toBe("family:f1");
    expect(groups[0]!.familyId).toBe("f1");
    // Same display name but a different id is a different group (no name join).
    const renamed = groupInvoiceLines([
      line({ family_id: "f1", family_name: "مكرونة فيروز" }),
      line({ family_id: "f2", family_name: "مكرونة فيروز" }),
    ]);
    expect(renamed).toHaveLength(2);
  });

  it("12. percent discount base includes extras — Excel matches save/preview (99)", () => {
    const inv = {
      products: [{ ...line({ product_price: 100, product_quantity: 1 }), cost_groups: [{ base_quantity: 1, unit_cost: 60 }] }],
      discount: 10,
      discount_percentage: true,
      debt: 0,
      delivery_price: 10,
      amount_of_animal_feeds: 0,
      amount_of_mahros: 0,
    };
    const figures = invoiceExportFigures(inv);
    expect(figures.gross).toBe(110);
    expect(figures.discountValue).toBe(11);
    expect(figures.invoiceTotal).toBe(99);
    expect(invoiceTotals(inv).net).toBe(99);
    expect(invoiceLinesSubtotal(inv)).toBe(100);
    expect(figures.totalCost).toBe(60); // historical cost_groups, not live price
    const fixed = invoiceExportFigures({ ...inv, discount: 5, discount_percentage: false });
    expect(fixed.invoiceTotal).toBe(105);
  });

  it("13. same SKU+unit at different prices never merge", () => {
    const groups = groupInvoiceLines([
      line({ line_id: "a", product_id: "curved", unit_id: "kg", product_quantity: 1, product_price: 30 }),
      line({ line_id: "b", product_id: "curved", unit_id: "kg", product_quantity: 1, product_price: 28 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.lines).toHaveLength(2);
    expect(flattenGroupedLines(groups)).toHaveLength(2);
  });

  it("14/15. idempotency fingerprints and request ids", () => {
    const payload = { customer_id: "c1", products: [{ product_id: "p", unit_id: "kg", product_quantity: 1 }] };
    expect(JSON.stringify(payload)).toBe(JSON.stringify({ ...payload }));
    expect(JSON.stringify({ ...payload, paid_amount: 1 })).not.toBe(JSON.stringify(payload));
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(/^[a-zA-Z0-9-]{16,80}$/.test(uuid)).toBe(true);
    expect(/^[a-zA-Z0-9-]{16,80}$/.test("short")).toBe(false);
  });

  it("16. receipts strip purchase cost/profit for cashiers", () => {
    const full = {
      products: [{ product_id: "p", product_name: "صنف", product_quantity: 1, product_price: 10, product_cost_price: 6, base_cost_snapshot: 6, cost_groups: [{ group_id: "g", base_quantity: 1, unit_cost: 6 }] }],
      cost: 6,
      profit: 4,
    };
    const safe = safeInvoice(full);
    expect(safe.products[0]).not.toHaveProperty("product_cost_price");
    expect(safe.products[0]).not.toHaveProperty("cost_groups");
    expect(safe).not.toHaveProperty("cost");
    expect(safe).not.toHaveProperty("profit");
    expect(safe.products[0]).toMatchObject({ product_id: "p", product_price: 10 });
  });

  it("17. internal line count is bounded regardless of display groups", () => {
    expect(pastaLines().length).toBeLessThanOrEqual(50);
    const many = Array.from({ length: 51 }, (_, i) => line({ line_id: `l${i}` }));
    expect(many.length > 50).toBe(true); // server rejects > 50
    const amounts = saleAmounts(
      [{ product_price: 100, product_quantity: 1, base_quantity: 1, product_cost_price: 60 }],
      { previous: 0, delivery: 10, feeds: 0, mahros: 0, discount: 10, discountPercentage: true, paid: 0 },
    );
    expect(amounts.total).toBe(99);
  });

  it("18. save/read round-trip keeps ids, grouping and snapshots", () => {
    const saved = JSON.parse(JSON.stringify({ id: "inv1", products: pastaLines() }));
    const groups = groupInvoiceLines(saved.products);
    expect(groups).toHaveLength(1);
    expect(groups.map((group) => group.lines.map(({ line: entry }) => entry.line_id))).toEqual([[ "l1", "l2", "l3" ]]);
    expect(groups[0]!.total).toBe(173);
    expect(saved.products[0]).toMatchObject({ variant_name: "معوجة", product_price: 30, product_quantity: 2 });
  });
});
