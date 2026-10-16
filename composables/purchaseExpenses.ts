import {
  allocatePurchaseExpense,
  MAX_PURCHASE_EXPENSES,
  type PurchaseExpenseAllocationLine,
  type PurchaseExpenseAllocationMethod,
} from "~/functions/shared/purchaseExpenseAllocation.mjs";

export { MAX_PURCHASE_EXPENSES };

export interface PurchaseExpenseDraft {
  id: string;
  type: "delivery" | "loading" | "handling" | "custom" | "tip";
  description: string;
  amount: number;
  allocation_method: PurchaseExpenseAllocationMethod;
  capitalize: boolean;
  paid: boolean;
  recipient: string;
  manualAllocations: number[];
  confirmTipCapitalization: boolean;
}

export function purchaseExpenseLines(lines: Array<{ quantity: number; unit_cost: number; unit_factor: number; product?: { base_unit_name?: string | null } }>): PurchaseExpenseAllocationLine[] {
  return lines.map((line) => ({
    lineValue: Math.round((Number(line.quantity) * Number(line.unit_cost) + Number.EPSILON) * 100) / 100,
    quantity: Number(line.quantity),
    baseQuantity: Math.round((Number(line.quantity) * Number(line.unit_factor) + Number.EPSILON) * 10000) / 10000,
    baseUnitName: String(line.product?.base_unit_name || "").trim(),
  }));
}

export function purchaseExpenseAllocationPreview(expense: PurchaseExpenseDraft, lines: PurchaseExpenseAllocationLine[]): number[] {
  if (expense.allocation_method === "manual") return [...expense.manualAllocations];
  return allocatePurchaseExpense(expense.amount, lines, expense.allocation_method);
}

export function purchaseExpenseSuggestedAllocation(expense: PurchaseExpenseDraft, lines: PurchaseExpenseAllocationLine[]): number[] {
  const method = expense.allocation_method === "manual" ? "value" : expense.allocation_method;
  return allocatePurchaseExpense(expense.amount, lines, method);
}
