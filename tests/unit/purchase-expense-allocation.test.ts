import { describe, expect, it } from "vitest";
import { allocatePurchaseExpense, effectivePurchaseLine, normalizePurchaseExpenses, type PurchaseExpenseAllocationLine } from "../../functions/shared/purchaseExpenseAllocation.mjs";

const baseLines: PurchaseExpenseAllocationLine[] = [
  { lineValue: 5, quantity: 1, baseQuantity: 1, baseUnitName: "قطعة" },
  { lineValue: 300, quantity: 1, baseQuantity: 1, baseUnitName: "قطعة" },
  { lineValue: 295, quantity: 5, baseQuantity: 5, baseUnitName: "قطعة" },
];

describe("purchase expense allocation", () => {
  it("allocates the required 600 EGP example proportionally by purchase value", () => {
    expect(allocatePurchaseExpense(10, baseLines, "value")).toEqual([0.08, 5, 4.92]);
    expect([5, 300, 59].map((unitCost, index) => { const line = baseLines[index]!; return effectivePurchaseLine(unitCost * line.quantity, line.quantity, line.baseQuantity, [0.08, 5, 4.92][index]!).effectiveUnitCost; })).toEqual([5.08, 305, 59.984]);
  });

  it("allocates in proportion to comparable base quantities", () => {
    expect(allocatePurchaseExpense(12, baseLines, "quantity")).toEqual([1.72, 1.71, 8.57]);
  });

  it("allocates equally per eligible invoice line rather than per piece", () => {
    expect(allocatePurchaseExpense(1, baseLines, "equal")).toEqual([0.34, 0.33, 0.33]);
  });

  it("accepts exact manual allocations", () => {
    expect(allocatePurchaseExpense(10, baseLines, "manual", [0.08, 5, 4.92])).toEqual([0.08, 5, 4.92]);
  });

  it("rejects manual allocations that do not reconcile", () => {
    expect(() => allocatePurchaseExpense(10, baseLines, "manual", [0.08, 5, 4.91])).toThrow("EXPENSE_MANUAL_TOTAL_MISMATCH");
  });

  it("rejects negative manual shares", () => {
    expect(() => allocatePurchaseExpense(1, baseLines, "manual", [1.01, 0, -0.01])).toThrow("EXPENSE_AMOUNT_INVALID");
  });

  it("rejects non-finite expense values", () => {
    expect(() => allocatePurchaseExpense(Number.NaN, baseLines, "value")).toThrow("EXPENSE_AMOUNT_INVALID");
  });

  it("rejects expense values with more than two decimal places", () => {
    expect(() => normalizePurchaseExpenses([{ id: "expense-0001", type: "delivery", amount: 1.001, allocation_method: "value", capitalize: true, paid: true }], baseLines)).toThrow("EXPENSE_AMOUNT_INVALID");
  });

  it("rejects non-finite line quantities", () => {
    expect(() => allocatePurchaseExpense(1, [{ ...baseLines[0]!, quantity: Number.NaN }], "value")).toThrow("EXPENSE_QUANTITY_INVALID");
  });

  it("distributes remainder cents deterministically by fractional remainder and index", () => {
    expect(allocatePurchaseExpense(0.01, [{ lineValue: 1, quantity: 1, baseQuantity: 1, baseUnitName: "قطعة" }, { lineValue: 1, quantity: 1, baseQuantity: 1, baseUnitName: "قطعة" }, { lineValue: 1, quantity: 1, baseQuantity: 1, baseUnitName: "قطعة" }], "equal")).toEqual([0.01, 0, 0]);
    expect(allocatePurchaseExpense(0.01, [{ lineValue: 1, quantity: 1, baseQuantity: 1, baseUnitName: "قطعة" }, { lineValue: 1, quantity: 1, baseQuantity: 1, baseUnitName: "قطعة" }, { lineValue: 1, quantity: 1, baseQuantity: 1, baseUnitName: "قطعة" }], "equal")).toEqual([0.01, 0, 0]);
  });

  it("supports fractional quantities without losing cents", () => {
    const lines = [{ lineValue: 1, quantity: 0.5, baseQuantity: 1.25, baseUnitName: "كيلو" }, { lineValue: 2, quantity: 0.75, baseQuantity: 1.875, baseUnitName: "كيلو" }];
    const result = allocatePurchaseExpense(0.07, lines, "quantity");
    expect(result).toEqual([0.03, 0.04]);
    expect(result.reduce((sum, value) => sum + Math.round(value * 100), 0)).toBe(7);
  });

  it("rejects quantity distribution across incomparable base units", () => {
    expect(() => allocatePurchaseExpense(1, [baseLines[0]!, { ...baseLines[1]!, baseUnitName: "كيلو" }], "quantity")).toThrow("EXPENSE_QUANTITY_UNITS_INCOMPARABLE");
  });

  it("accepts quantity distribution for mixed purchase units that share a base unit", () => {
    expect(allocatePurchaseExpense(3, [{ ...baseLines[0]!, baseQuantity: 2 }, { ...baseLines[1]!, quantity: 1, baseQuantity: 1 }], "quantity")).toEqual([2, 1]);
  });

  it("rejects positive expenses when every eligible quantity is zero", () => {
    expect(() => allocatePurchaseExpense(1, [{ lineValue: 0, quantity: 0, baseQuantity: 0, baseUnitName: "قطعة" }], "value")).toThrow("EXPENSE_ELIGIBLE_LINES_REQUIRED");
  });

  it("handles zero-value expenses and quantities with zero allocations", () => {
    expect(allocatePurchaseExpense(0, [{ lineValue: 0, quantity: 0, baseQuantity: 0, baseUnitName: "قطعة" }], "value")).toEqual([0]);
  });

  it("rejects unsupported methods", () => {
    expect(() => allocatePurchaseExpense(1, baseLines, "weight" as never)).toThrow("EXPENSE_ALLOCATION_METHOD_INVALID");
  });

  it("normalizes multiple independent expense records with their own strategies", () => {
    const expenses = normalizePurchaseExpenses([
      { id: "expense-0001", type: "delivery", amount: 10, allocation_method: "value", capitalize: true, paid: true },
      { id: "expense-0002", type: "tip", description: "إكرامية", amount: 3, allocation_method: "equal", capitalize: false, paid: false },
    ], baseLines);
    expect(expenses.map((expense) => expense.allocations.reduce((sum, allocation) => sum + allocation.allocated_amount, 0))).toEqual([10, 3]);
    expect(expenses[1]!.capitalize).toBe(false);
  });

  it("requires explicit confirmation before capitalizing a tip", () => {
    expect(() => normalizePurchaseExpenses([{ id: "expense-0001", type: "tip", description: "إكرامية", amount: 1, allocation_method: "value", capitalize: true, paid: true }], baseLines)).toThrow("EXPENSE_TIP_CAPITALIZATION_CONFIRMATION_REQUIRED");
    expect(normalizePurchaseExpenses([{ id: "expense-0001", type: "tip", description: "إكرامية", amount: 1, allocation_method: "value", capitalize: true, paid: true, confirmTipCapitalization: true }], baseLines)[0]!.capitalize).toBe(true);
  });

  it("keeps line value and effective unit cost at higher-than-cent precision", () => {
    expect(effectivePurchaseLine(295, 5, 5, 4.92)).toEqual({ effectiveLineTotal: 299.92, effectiveUnitCost: 59.984, effectiveBaseUnitCost: 59.984 });
  });

  it("rejects negative and invalid allocations in normalized expenses", () => {
    expect(() => normalizePurchaseExpenses([{ id: "expense-0001", type: "delivery", amount: -1, allocation_method: "value", capitalize: true, paid: true }], baseLines)).toThrow("EXPENSE_AMOUNT_INVALID");
    expect(() => normalizePurchaseExpenses([{ id: "expense-0001", type: "delivery", amount: 0, allocation_method: "value", capitalize: true, paid: true }], baseLines)).toThrow("EXPENSE_AMOUNT_INVALID");
  });

  it("rejects a manual share assigned to a zero-quantity line", () => {
    expect(() => allocatePurchaseExpense(1, [{ ...baseLines[0]!, quantity: 0 }, baseLines[1]!], "manual", [1, 0])).toThrow("EXPENSE_MANUAL_INELIGIBLE_LINE");
  });

  it("requires a description for custom expenses and tips", () => {
    expect(() => normalizePurchaseExpenses([{ id: "expense-0001", type: "custom", amount: 1, allocation_method: "value", capitalize: false, paid: false }], baseLines)).toThrow("EXPENSE_DESCRIPTION_REQUIRED");
  });

  it("guarantees allocated cents equal the expense for a large amount", () => {
    const result = allocatePurchaseExpense(123456.78, baseLines, "value");
    expect(result.reduce((sum, value) => sum + Math.round(value * 100), 0)).toBe(12345678);
  });
});
