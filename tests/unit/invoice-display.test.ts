import { describe, expect, it } from "vitest";
import type { InvoiceProductLine } from "../../types/index";
import {
  abbreviateUnitSuffix,
  abbreviateVariants,
  buildInvoiceDisplayRows,
  displayRowsSubtotal,
  formatDisplayQuantity,
  formatInvoiceDateDMY,
  formatInvoiceTimeAMPM,
} from "../../utils/invoiceDisplay";
import { invoiceLinesSubtotal } from "../../utils/invoiceExport";
import { invoiceTotals, outstandingDebtOf, round2 } from "../../composables/finance";

let seq = 0;
function line(overrides: Partial<InvoiceProductLine> = {}): InvoiceProductLine {
  seq += 1;
  return {
    line_id: `t-${seq}`,
    product_id: "p1",
    product_name: "صنف",
    product_price: 10,
    product_quantity: 1,
    unit_id: "u1",
    unit_name: "كرتونة",
    unit_factor: 1,
    stock_kind: "package",
    allows_fractional: false,
    base_quantity: 1,
    family_id: "f1",
    family_name: "عائلة",
    variant_name: null,
    variant_key: null,
    pack_size_name: null,
    inventory_mode: "convertible",
    ...overrides,
  };
}

describe("invoice display rows (reference presentation)", () => {
  it("1. single family, single variant, single unit (rice example)", () => {
    const lines = [
      line({
        line_id: "r1",
        product_id: "rice-sack",
        product_name: "أرز الرحمة — شكارة",
        family_id: "rice",
        family_name: "أرز الرحمة",
        variant_name: "شكارة",
        unit_id: "u25k",
        unit_name: "25 كيلو",
        unit_factor: 25,
        product_quantity: 1,
        product_price: 610,
        base_quantity: 25,
      }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayQuantity).toBe(1);
    expect(rows[0]!.displayPrice).toBe(610);
    expect(rows[0]!.displayTotal).toBe(610);
    expect(rows[0]!.name).toBe("شكارة أرز الرحمة 25ك");
  });

  it("2. same family with three variants and identical units (pasta example)", () => {
    const lines = [
      line({ line_id: "a", product_id: "p-sh", product_name: "مكرونة فيروز — شعرية", family_id: "fayrouz", family_name: "مكرونة فيروز", variant_name: "شعرية", variant_key: "sh", unit_id: "carton", unit_name: "كرتونة", product_quantity: 2, product_price: 210, base_quantity: 2 }),
      line({ line_id: "b", product_id: "p-ls", product_name: "مكرونة فيروز — لسان عصفور", family_id: "fayrouz", family_name: "مكرونة فيروز", variant_name: "لسان عصفور", variant_key: "ls", unit_id: "carton", unit_name: "كرتونة", product_quantity: 2, product_price: 210, base_quantity: 2 }),
      line({ line_id: "c", product_id: "p-q", product_name: "مكرونة فيروز — أقلام", family_id: "fayrouz", family_name: "مكرونة فيروز", variant_name: "أقلام", variant_key: "q", unit_id: "carton", unit_name: "كرتونة", product_quantity: 2, product_price: 210, base_quantity: 2 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayQuantity).toBe(6);
    expect(rows[0]!.displayPrice).toBe(210);
    expect(rows[0]!.displayTotal).toBe(1260);
    expect(rows[0]!.name).toBe("كرتونة مكرونة فيروز 2ش 2ل 2ق");
  });

  it("3. same family with different selling prices never shows a misleading price", () => {
    const lines = [
      line({ line_id: "a", product_id: "p-sh", family_id: "fayrouz", family_name: "مكرونة فيروز", variant_name: "شعرية", unit_id: "carton", unit_name: "كرتونة", product_quantity: 2, product_price: 210 }),
      line({ line_id: "b", product_id: "p-ls", family_id: "fayrouz", family_name: "مكرونة فيروز", variant_name: "لسان عصفور", unit_id: "carton", unit_name: "كرتونة", product_quantity: 2, product_price: 220 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    // Split by price so no average/invented price appears.
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.displayPrice).not.toBeNull();
    expect(rows.map((r) => r.displayPrice).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([210, 220]);
    expect(round2(rows.reduce((s, r) => s + r.displayTotal, 0))).toBe(2 * 210 + 2 * 220);
  });

  it("4. same family with incompatible units stays separate", () => {
    const lines = [
      line({ line_id: "a", product_id: "p1", family_id: "f1", family_name: "سكر", variant_name: "خشن", unit_id: "kg", unit_name: "كيلو", unit_factor: 1, stock_kind: "loose", product_quantity: 5, product_price: 30 }),
      line({ line_id: "b", product_id: "p2", family_id: "f1", family_name: "سكر", variant_name: "خشن", unit_id: "sack", unit_name: "شيكارة", unit_factor: 25, stock_kind: "package", product_quantity: 1, product_price: 700 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.unitName).not.toBe(rows[1]!.unitName);
  });

  it("5. different families with similar names never merge", () => {
    const lines = [
      line({ line_id: "a", product_id: "p1", family_id: "f1", family_name: "مكرونة فيروز", variant_name: "شعرية", product_quantity: 1, product_price: 10 }),
      line({ line_id: "b", product_id: "p2", family_id: "f2", family_name: "مكرونة فيروز", variant_name: "شعرية", product_quantity: 1, product_price: 10 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.familyId).toBe("f1");
    expect(rows[1]!.familyId).toBe("f2");
  });

  it("6. products without variants render unit + family", () => {
    const lines = [
      line({ line_id: "a", product_id: "sugar", family_id: "sugar-f", family_name: "سكر", variant_name: "أساسي", unit_id: "kg", unit_name: "كيلو", product_quantity: 3, product_price: 30 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toContain("سكر");
    expect(rows[0]!.name).toContain("كيلو");
    expect(rows[0]!.displayTotal).toBe(90);
  });

  it("7. fractional quantities are preserved without bad rounding", () => {
    const lines = [
      line({ line_id: "a", product_id: "p1", family_id: "f1", family_name: "أرز", variant_name: null, unit_id: "kg", unit_name: "كيلو", unit_factor: 1, allows_fractional: true, product_quantity: 0.5, product_price: 40 }),
      line({ line_id: "b", product_id: "p1", family_id: "f1", family_name: "أرز", variant_name: null, unit_id: "kg", unit_name: "كيلو", unit_factor: 1, allows_fractional: true, product_quantity: 0.25, product_price: 40 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayQuantity).toBeCloseTo(0.75, 9);
    expect(formatDisplayQuantity(rows[0]!.displayQuantity)).toBe("0.75");
    expect(rows[0]!.displayTotal).toBe(30);
  });

  it("8. independent inventory mode keeps pack sizes distinct", () => {
    const lines = [
      line({ line_id: "g", product_id: "green-quarter", family_id: "tea", family_name: "شاي", variant_name: "أخضر", variant_key: "green", pack_size_name: "ربع", inventory_mode: "independent", unit_id: "box", unit_name: "عبوة", product_quantity: 1, product_price: 50 }),
      line({ line_id: "h", product_id: "green-eighth", family_id: "tea", family_name: "شاي", variant_name: "أخضر", variant_key: "green", pack_size_name: "ثمن", inventory_mode: "independent", unit_id: "box", unit_name: "عبوة", product_quantity: 1, product_price: 30 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.inventoryMode === "independent")).toBe(true);
  });

  it("9. convertible mode groups compatible units", () => {
    const lines = [
      line({ line_id: "a", product_id: "p-sh", family_id: "f1", family_name: "مكرونة", variant_name: "شعرية", inventory_mode: "convertible", unit_id: "carton", unit_name: "كرتونة", product_quantity: 1, product_price: 100 }),
      line({ line_id: "b", product_id: "p-ls", family_id: "f1", family_name: "مكرونة", variant_name: "لسان عصفور", inventory_mode: "convertible", unit_id: "carton", unit_name: "كرتونة", product_quantity: 1, product_price: 100 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.inventoryMode).toBe("convertible");
  });

  it("10. missing legacy metadata degrades gracefully without merging", () => {
    const lines = [
      { product_name: "صنف قديم أ", product_price: 10, product_quantity: 2 } as InvoiceProductLine,
      { product_name: "صنف قديم ب", product_price: 20, product_quantity: 1 } as InvoiceProductLine,
    ];
    const rows = buildInvoiceDisplayRows(lines);
    // No ids at all: each legacy line still prints on its own row.
    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toContain("صنف قديم أ");
    expect(rows[1]!.name).toContain("صنف قديم ب");
    expect(displayRowsSubtotal(rows)).toBe(2 * 10 + 1 * 20);
    // Truly empty drafts are still skipped.
    expect(buildInvoiceDisplayRows([{} as InvoiceProductLine])).toHaveLength(0);
    const withIds = [
      line({ line_id: "a", product_id: "legacy-a", family_id: null, family_name: null, product_name: "صنف قديم أ", variant_name: null, unit_id: undefined, unit_name: undefined, product_quantity: 2, product_price: 10 }),
    ];
    const rows2 = buildInvoiceDisplayRows(withIds);
    expect(rows2).toHaveLength(1);
    expect(rows2[0]!.name).toContain("صنف قديم أ");
  });

  it("11. discount and delivery presentation reuse canonical figures", () => {
    const inv = {
      products: [line({ product_price: 100, product_quantity: 1 })],
      discount: 10,
      discount_percentage: true,
      debt: 0,
      delivery_price: 10,
      amount_of_animal_feeds: 0,
      amount_of_mahros: 0,
    };
    const totals = invoiceTotals(inv);
    expect(totals.gross).toBe(110);
    expect(totals.discountValue).toBe(11);
    expect(totals.net).toBe(99);
    const rows = buildInvoiceDisplayRows(inv.products);
    expect(displayRowsSubtotal(rows)).toBe(invoiceLinesSubtotal(inv));
  });

  it("12. paid and partially paid invoices keep payment semantics", () => {
    const base = {
      products: [line({ product_price: 100, product_quantity: 2 })],
      discount: 0,
      discount_percentage: false,
      debt: 0,
      delivery_price: 0,
      amount_of_animal_feeds: 0,
      amount_of_mahros: 0,
    };
    expect(outstandingDebtOf({ ...base, paid_amount: 200, remaining: 0 })).toBe(0);
    expect(outstandingDebtOf({ ...base, paid_amount: 80, remaining: 120 })).toBe(120);
    expect(invoiceTotals({ ...base, paid_amount: 80 }).remaining).toBe(120);
  });

  it("13. invoice line ordering is preserved", () => {
    const lines = [
      line({ line_id: "z", product_id: "pz", family_id: "fz", family_name: "زبيب", product_quantity: 1, product_price: 5 }),
      line({ line_id: "a", product_id: "pa", family_id: "fa", family_name: "أرز", product_quantity: 1, product_price: 5 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows.map((r) => r.familyName)).toEqual(["زبيب", "أرز"]);
    expect(rows[0]!.order).toBeLessThan(rows[1]!.order);
  });

  it("14. variant abbreviation collisions expand to distinguishable names", () => {
    const abbrs = abbreviateVariants(["شعرية", "شوفان", "أقلام"]);
    expect(new Set(abbrs.values()).size).toBe(3);
    // Leading hamza/alif is skipped so the abbreviation stays distinctive.
    expect(abbrs.get("أقلام")).toBe("ق");
    // Colliding ش-variants must differ beyond one letter.
    expect(abbrs.get("شعرية")).not.toBe(abbrs.get("شوفان"));
    expect(abbrs.get("شعرية")!.length).toBeGreaterThan(1);
    expect(abbreviateUnitSuffix("25 كيلو")).toBe("25ك");
    expect(abbreviateVariants(["شعرية", "لسان عصفور", "أقلام"]).get("شعرية")).toBe("ش");
  });

  it("15. original input array is never mutated", () => {
    const lines = [
      line({ line_id: "a", product_id: "p-sh", family_id: "f1", family_name: "مكرونة", variant_name: "شعرية", product_quantity: 2, product_price: 10 }),
      line({ line_id: "b", product_id: "p-ls", family_id: "f1", family_name: "مكرونة", variant_name: "لسان عصفور", product_quantity: 2, product_price: 10 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(lines));
    const rows = buildInvoiceDisplayRows(lines);
    expect(rows).toHaveLength(1);
    expect(lines).toEqual(snapshot);
  });

  it("16. grouped row totals always match the original line totals", () => {
    const lines = [
      line({ line_id: "a", product_id: "p1", family_id: "f1", family_name: "عائلة", variant_name: "أ", product_quantity: 2, product_price: 30 }),
      line({ line_id: "b", product_id: "p2", family_id: "f1", family_name: "عائلة", variant_name: "ب", product_quantity: 3, product_price: 30 }),
      line({ line_id: "c", product_id: "p3", family_id: "f2", family_name: "عائلة 2", variant_name: null, product_quantity: 1.5, product_price: 20 }),
    ];
    const rows = buildInvoiceDisplayRows(lines);
    expect(displayRowsSubtotal(rows)).toBe(invoiceLinesSubtotal({ products: lines }));
    expect(displayRowsSubtotal(rows)).toBe(round2(2 * 30 + 3 * 30 + 1.5 * 20));
  });

  it("date/time use the stored timestamp in DD/MM/YYYY + hh:mm AM/PM", () => {
    const d = new Date(2026, 9, 5, 14, 30, 0);
    expect(formatInvoiceDateDMY({ date: d })).toBe("05/10/2026");
    expect(formatInvoiceTimeAMPM({ date: d })).toBe("02:30 PM");
    expect(formatInvoiceDateDMY({})).toBe("—");
    expect(formatInvoiceTimeAMPM({})).toBe("—");
  });
});
