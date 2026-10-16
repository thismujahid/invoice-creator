export type PurchaseExpenseAllocationMethod = "value" | "quantity" | "equal" | "manual";
export const MAX_PURCHASE_EXPENSES: number;

export interface PurchaseExpenseAllocationLine {
  lineValue: number;
  quantity: number;
  baseQuantity: number;
  baseUnitName: string;
  eligible?: boolean;
}

export interface PurchaseExpenseInput {
  id: string;
  type: "delivery" | "loading" | "handling" | "custom" | "tip";
  description?: string | null;
  amount: number;
  allocation_method: PurchaseExpenseAllocationMethod;
  capitalize: boolean;
  paid: boolean;
  recipient?: string | null;
  allocations?: number[];
  confirmTipCapitalization?: boolean;
}

export interface NormalizedPurchaseExpense extends Omit<PurchaseExpenseInput, "allocations" | "confirmTipCapitalization"> {
  allocations: Array<{ line_index: number; allocated_amount: number }>;
}

export function allocatePurchaseExpense(expenseValue: number, lines: PurchaseExpenseAllocationLine[], method: PurchaseExpenseAllocationMethod, manualAllocations?: number[]): number[];
export function normalizePurchaseExpenses(expenses: PurchaseExpenseInput[], lines: PurchaseExpenseAllocationLine[]): NormalizedPurchaseExpense[];
export function effectivePurchaseLine(lineValue: number, quantityValue: number, baseQuantityValue: number, allocatedCapitalizedExpense: number): {
  effectiveLineTotal: number;
  effectiveUnitCost: number;
  effectiveBaseUnitCost: number;
};
