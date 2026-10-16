export const MAX_PURCHASE_EXPENSES = 30;

function amountCents(value) {
  const amount = value;
  if (typeof amount !== "number") throw new Error("EXPENSE_AMOUNT_INVALID");
  if (!Number.isFinite(amount) || amount < 0) throw new Error("EXPENSE_AMOUNT_INVALID");
  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("EXPENSE_AMOUNT_INVALID");
  return cents;
}

function quantity(value) {
  const amount = value;
  if (typeof amount !== "number") throw new Error("EXPENSE_QUANTITY_INVALID");
  if (!Number.isFinite(amount) || amount < 0) throw new Error("EXPENSE_QUANTITY_INVALID");
  return amount;
}

function allocateByWeights(totalCents, weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(totalWeight > 0)) {
    if (totalCents === 0) return weights.map(() => 0);
    throw new Error("EXPENSE_ALLOCATION_BASIS_ZERO");
  }
  const exact = weights.map((weight) => totalCents * weight / totalWeight);
  const allocations = exact.map(Math.floor);
  let remainder = totalCents - allocations.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - allocations[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remainder; index += 1) allocations[order[index].index] += 1;
  return allocations;
}

export function allocatePurchaseExpense(expenseValue, lines, method, manualAllocations) {
  const totalCents = amountCents(expenseValue);
  if (!Array.isArray(lines) || !lines.length) throw new Error("EXPENSE_LINES_REQUIRED");
  const values = lines.map((line) => amountCents(line.lineValue));
  const quantities = lines.map((line) => quantity(line.quantity));
  const eligible = lines.map((line, index) => line.eligible !== false && quantities[index] > 0);
  const eligibleIndexes = lines.map((_, index) => index).filter((index) => eligible[index]);
  if (!eligibleIndexes.length) {
    if (totalCents === 0) return lines.map(() => 0);
    throw new Error("EXPENSE_ELIGIBLE_LINES_REQUIRED");
  }

  let cents;
  if (method === "manual") {
    if (!Array.isArray(manualAllocations) || manualAllocations.length !== lines.length) throw new Error("EXPENSE_MANUAL_ALLOCATIONS_INVALID");
    cents = manualAllocations.map(amountCents);
    if (cents.some((value, index) => value > 0 && !eligible[index])) throw new Error("EXPENSE_MANUAL_INELIGIBLE_LINE");
    if (cents.reduce((sum, value) => sum + value, 0) !== totalCents) throw new Error("EXPENSE_MANUAL_TOTAL_MISMATCH");
    return cents.map((value) => value / 100);
  }

  const allocations = Array(lines.length).fill(0);
  let weights;
  if (method === "value") {
    weights = eligibleIndexes.map((index) => values[index]);
  } else if (method === "quantity") {
    const baseNames = new Set(eligibleIndexes.map((index) => String(lines[index].baseUnitName || "").trim().toLocaleLowerCase()));
    if (baseNames.has("") || baseNames.size !== 1) throw new Error("EXPENSE_QUANTITY_UNITS_INCOMPARABLE");
    weights = eligibleIndexes.map((index) => quantity(lines[index].baseQuantity));
  } else if (method === "equal") {
    weights = eligibleIndexes.map(() => 1);
  } else {
    throw new Error("EXPENSE_ALLOCATION_METHOD_INVALID");
  }
  if (totalCents === 0) return allocations.map((value) => value / 100);
  const shares = allocateByWeights(totalCents, weights);
  eligibleIndexes.forEach((lineIndex, index) => { allocations[lineIndex] = shares[index]; });
  return allocations.map((value) => value / 100);
}

export function normalizePurchaseExpenses(expenses, lines) {
  if (!Array.isArray(expenses) || expenses.length > MAX_PURCHASE_EXPENSES) throw new Error("EXPENSES_INVALID");
  return expenses.map((expense) => {
    const amount = expense?.amount;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("EXPENSE_AMOUNT_INVALID");
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) throw new Error("EXPENSE_AMOUNT_INVALID");
    const type = String(expense?.type || "");
    if (!["delivery", "loading", "handling", "custom", "tip"].includes(type)) throw new Error("EXPENSE_TYPE_INVALID");
    if ((type === "custom" || type === "tip") && !String(expense?.description || "").trim()) throw new Error("EXPENSE_DESCRIPTION_REQUIRED");
    if (typeof expense.capitalize !== "boolean") throw new Error("EXPENSE_CAPITALIZATION_INVALID");
    if (typeof expense.paid !== "boolean") throw new Error("EXPENSE_PAYMENT_STATE_INVALID");
    if (type === "tip" && expense.capitalize === true && expense.confirmTipCapitalization !== true) throw new Error("EXPENSE_TIP_CAPITALIZATION_CONFIRMATION_REQUIRED");
    const allocations = allocatePurchaseExpense(amount, lines, expense.allocation_method, expense.allocations);
    const cents = allocations.map((value) => Math.round(value * 100));
    if (cents.reduce((sum, value) => sum + value, 0) !== amountCents(amount)) throw new Error("EXPENSE_ALLOCATION_TOTAL_MISMATCH");
    return {
      id: String(expense.id || ""),
      type,
      description: String(expense.description || "").trim().slice(0, 160) || null,
      amount: amountCents(amount) / 100,
      allocation_method: expense.allocation_method,
      capitalize: expense.capitalize,
      paid: expense.paid,
      recipient: String(expense.recipient || "").trim().slice(0, 120) || null,
      allocations: allocations.map((allocated_amount, line_index) => ({ line_index, allocated_amount })),
    };
  });
}

export function effectivePurchaseLine(lineValue, quantityValue, baseQuantityValue, allocatedCapitalizedExpense) {
  const valueCents = amountCents(lineValue);
  const expenseCents = amountCents(allocatedCapitalizedExpense);
  const qty = quantity(quantityValue);
  const baseQty = quantity(baseQuantityValue);
  if (!(qty > 0) || !(baseQty > 0)) throw new Error("EXPENSE_QUANTITY_INVALID");
  const effectiveValue = (valueCents + expenseCents) / 100;
  return {
    effectiveLineTotal: effectiveValue,
    effectiveUnitCost: effectiveValue / qty,
    effectiveBaseUnitCost: effectiveValue / baseQty,
  };
}

