export function unitReferenceCost(product, unit) {
  if (product.inventory_mode === "independent" && unit.purchase_price != null && Number.isFinite(unit.purchase_price) && unit.purchase_price >= 0) {
    return unit.purchase_price;
  }
  const base = product.last_purchase_base_cost ?? product.cost_price;
  if (base != null && Number.isFinite(base) && base >= 0 && Number.isFinite(unit.factor) && unit.factor > 0) return base * unit.factor;
  return unit.purchase_price != null && Number.isFinite(unit.purchase_price) && unit.purchase_price >= 0 ? unit.purchase_price : null;
}

export function repriceUnits(product, newBaseCost, decisions = {}) {
  if (!Number.isFinite(newBaseCost) || newBaseCost < 0) throw new Error("PURCHASE_COST_INVALID");
  return (product.units || []).map((unit) => {
    if (unit.archived || unit.can_sell === false) return { ...unit };
    if (!Number.isFinite(unit.factor) || unit.factor <= 0) throw new Error("UNIT_FACTOR_INVALID");
    const oldCost = unitReferenceCost(product, unit);
    const nextCost = newBaseCost * unit.factor;
    if (!Number.isFinite(nextCost)) throw new Error("PURCHASE_COST_INVALID");
    const margin = unit.profit_margin ?? (oldCost > 0 && unit.selling_price != null ? unit.selling_price / oldCost - 1 : null);
    const decision = decisions[unit.id];
    if (decision?.mode === "custom" || decision?.mode === "proposed") {
      const price = decision.price ?? decision.approvedProposed;
      if (!Number.isFinite(price) || price < 0) throw new Error("SELLING_PRICE_INVALID");
      return { ...unit, selling_price: Math.round((price + Number.EPSILON) * 100) / 100, profit_margin: nextCost > 0 ? price / nextCost - 1 : null };
    }
    if (decision?.mode === "keep") return { ...unit, profit_margin: nextCost > 0 && unit.selling_price != null ? unit.selling_price / nextCost - 1 : null };
    if (margin == null || !Number.isFinite(margin) || margin < -1) return { ...unit };
    return { ...unit, profit_margin: margin, selling_price: Math.round((nextCost * (1 + margin) + Number.EPSILON) * 100) / 100 };
  });
}
