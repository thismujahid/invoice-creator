const EPSILON = 1e-9;

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function quantity(value, label = "quantity") {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || Math.abs(result - round4(result)) > EPSILON) {
    throw new Error(`INVALID_${label.toUpperCase()}`);
  }
  return round4(result);
}

function baseQuantityFor(rawQuantity, rawFactor) {
  const count = quantity(rawQuantity);
  const factor = Number(rawFactor);
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - round4(factor)) > EPSILON) throw new Error("UNIT_FACTOR_INVALID");
  const unrounded = count * factor;
  if (count <= 0 || !Number.isFinite(unrounded) || unrounded <= 0) throw new Error("QUANTITY_MUST_BE_POSITIVE");
  if (Math.abs(unrounded - round4(unrounded)) > EPSILON) throw new Error("BASE_QUANTITY_PRECISION_INVALID");
  return round4(unrounded);
}

function emptyInventory() {
  return { loose_base_quantity: 0, closed_packages: {} };
}

function normalizeInventory(value) {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "loose_base_quantity") || !value.closed_packages || typeof value.closed_packages !== "object") throw new Error("INVENTORY_SNAPSHOT_MISSING");
  const inventory = value;
  const packages = inventory.closed_packages;
  const normalizedPackages = {};
  for (const [unitId, count] of Object.entries(packages)) {
    if (!Number.isInteger(Number(count)) || Number(count) < 0) throw new Error("INVALID_PACKAGE_COUNT");
    normalizedPackages[unitId] = Number(count);
  }
  return {
    loose_base_quantity: quantity(inventory.loose_base_quantity ?? 0),
    closed_packages: normalizedPackages,
  };
}

function unitById(product, unitId) {
  const unit = (Array.isArray(product.units) ? product.units : []).find((entry) => entry.id === unitId);
  if (!unit) throw new Error("UNIT_MISSING");
  const factor = Number(unit.factor);
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - round4(factor)) > EPSILON) throw new Error("UNIT_FACTOR_INVALID");
  if (unit.is_base === true && factor !== 1) throw new Error("BASE_UNIT_FACTOR_INVALID");
  if (unit.stock_kind !== "loose" && unit.stock_kind !== "package") throw new Error("UNIT_STOCK_KIND_INVALID");
  return { ...unit, factor };
}

function inventoryTotal(inventoryValue, units) {
  const inventory = normalizeInventory(inventoryValue);
  const unitMap = new Map((units || []).map((unit) => [unit.id, unit]));
  const packageQuantity = Object.entries(inventory.closed_packages).reduce((sum, [unitId, count]) => {
    const unit = unitMap.get(unitId);
    if (!unit || unit.stock_kind !== "package" || !Number.isFinite(Number(unit.factor)) || Number(unit.factor) <= 0) throw new Error("INVENTORY_PACKAGE_UNIT_INVALID");
    return sum + Number(count) * Number(unit.factor);
  }, 0);
  return round4(inventory.loose_base_quantity + packageQuantity);
}

function bucketDelta(previous, next) {
  const before = normalizeInventory(previous);
  const after = normalizeInventory(next);
  const packageDeltas = {};
  for (const id of new Set([...Object.keys(before.closed_packages), ...Object.keys(after.closed_packages)])) {
    const change = (after.closed_packages[id] || 0) - (before.closed_packages[id] || 0);
    if (change) packageDeltas[id] = change;
  }
  return {
    loose_base_quantity: round4(after.loose_base_quantity - before.loose_base_quantity),
    closed_packages: packageDeltas,
  };
}

function restoreSaleConsumption(inventoryValue, product, line) {
  const inventory = normalizeInventory(inventoryValue);
  const unitId = String(line?.unit_id || "");
  const unit = unitById(product, unitId);
  const factor = Number(line?.unit_factor);
  const quantityInUnit = quantity(line?.product_quantity);
  if (Math.abs(factor - unit.factor) > EPSILON) throw new Error("UNIT_FACTOR_CHANGED");
  const amount = baseQuantityFor(quantityInUnit, factor);
  if (Math.abs(amount - quantity(line?.base_quantity)) > EPSILON) throw new Error("INVOICE_LINE_QUANTITY_INVALID");
  const before = normalizeInventory(inventory);
  if (unit.stock_kind === "package") {
    if (!Number.isInteger(quantityInUnit)) throw new Error("PACKAGE_COUNT_MUST_BE_INTEGER");
    inventory.closed_packages[unit.id] = (inventory.closed_packages[unit.id] || 0) + quantityInUnit;
  } else {
    inventory.loose_base_quantity = round4(inventory.loose_base_quantity + amount);
  }
  return { inventory, changes: bucketDelta(before, inventory), base_quantity: amount, unit };
}

function addPurchase(inventoryValue, product, unitId, rawQuantity) {
  const inventory = normalizeInventory(inventoryValue);
  const unit = unitById(product, unitId);
  const count = quantity(rawQuantity);
  if (count <= 0) throw new Error("QUANTITY_MUST_BE_POSITIVE");
  if (unit.can_purchase === false) throw new Error("UNIT_NOT_PURCHASABLE");
  if (unit.archived === true) throw new Error("UNIT_ARCHIVED");
  if (unit.allows_fractional !== true && !Number.isInteger(count)) throw new Error("FRACTION_NOT_ALLOWED");
  const before = normalizeInventory(inventory);
  const baseQuantity = baseQuantityFor(count, unit.factor);
  if (unit.stock_kind === "package") {
    if (!Number.isInteger(count)) throw new Error("PACKAGE_COUNT_MUST_BE_INTEGER");
    inventory.closed_packages[unit.id] = (inventory.closed_packages[unit.id] || 0) + count;
  } else {
    inventory.loose_base_quantity = round4(inventory.loose_base_quantity + baseQuantity);
  }
  return { inventory, changes: bucketDelta(before, inventory), base_quantity: baseQuantity, unit };
}

function sellInventory(inventoryValue, product, unitId, rawQuantity) {
  const inventory = normalizeInventory(inventoryValue);
  const unit = unitById(product, unitId);
  const count = quantity(rawQuantity);
  if (count <= 0) throw new Error("QUANTITY_MUST_BE_POSITIVE");
  if (unit.can_sell === false) throw new Error("UNIT_NOT_SELLABLE");
  if (unit.archived === true) throw new Error("UNIT_ARCHIVED");
  if (unit.allows_fractional !== true && !Number.isInteger(count)) throw new Error("FRACTION_NOT_ALLOWED");
  const before = normalizeInventory(inventory);
  const baseQuantity = baseQuantityFor(count, unit.factor);
  const opened = [];
  if (unit.stock_kind === "package") {
    if (!Number.isInteger(count)) throw new Error("PACKAGE_COUNT_MUST_BE_INTEGER");
    const available = inventory.closed_packages[unit.id] || 0;
    if (available < count) throw new Error("STOCK_INSUFFICIENT");
    inventory.closed_packages[unit.id] = available - count;
  } else {
    const needed = baseQuantity;
    const packageUnits = (product.units || [])
      .filter((candidate) => candidate.stock_kind === "package" && Number(candidate.factor) > 0 && (inventory.closed_packages[candidate.id] || 0) > 0)
      .sort((left, right) => Number(left.factor) - Number(right.factor) || String(left.id).localeCompare(String(right.id)));
    while (inventory.loose_base_quantity + EPSILON < needed) {
      const available = packageUnits.find((candidate) => (inventory.closed_packages[candidate.id] || 0) > 0);
      if (!available) throw new Error("STOCK_INSUFFICIENT");
      inventory.closed_packages[available.id] -= 1;
      inventory.loose_base_quantity = round4(inventory.loose_base_quantity + Number(available.factor));
      opened.push({ unit_id: available.id, unit_name: available.name, unit_factor: Number(available.factor), count: 1 });
    }
    inventory.loose_base_quantity = round4(inventory.loose_base_quantity - needed);
    if (inventory.loose_base_quantity < 0 && inventory.loose_base_quantity > -EPSILON) inventory.loose_base_quantity = 0;
  }
  return { inventory, changes: bucketDelta(before, inventory), base_quantity: baseQuantity, unit, opened };
}

function replayMovementGroup(stockValue, averageValue, movements) {
  const stock = quantity(stockValue);
  const average = averageValue == null ? null : Number(averageValue);
  if (average !== null && (!Number.isFinite(average) || average < 0)) throw new Error("COST_INVALID");
  if (!Array.isArray(movements) || movements.length === 0) throw new Error("MOVEMENT_GROUP_EMPTY");
  let incomingQuantity = 0;
  let incomingValue = 0;
  let outgoingQuantity = 0;
  let outgoingValue = 0;
  let untrusted = false;
  for (const movement of movements) {
    const amount = quantity(movement?.base_quantity ?? movement?.quantity);
    if (amount <= 0) throw new Error("MOVEMENT_QUANTITY_INVALID");
    if (movement.direction === "in") {
      incomingQuantity = round4(incomingQuantity + amount);
      if (movement.unit_cost === null || movement.unit_cost === undefined) {
        untrusted = true;
      } else {
        const cost = Number(movement.unit_cost);
        if (!Number.isFinite(cost) || cost < 0) throw new Error("MOVEMENT_COST_INVALID");
        incomingValue += amount * cost;
      }
    } else if (movement.direction === "out") {
      outgoingQuantity = round4(outgoingQuantity + amount);
      const cost = movement.unit_cost == null ? average : Number(movement.unit_cost);
      if (cost === null || !Number.isFinite(cost) || cost < 0) throw new Error("MOVEMENT_COST_MISSING");
      outgoingValue += amount * cost;
    } else {
      throw new Error("MOVEMENT_DIRECTION_INVALID");
    }
  }
  const nextStock = round4(stock + incomingQuantity - outgoingQuantity);
  if (nextStock < -EPSILON) throw new Error("MOVEMENT_STOCK_NEGATIVE");
  if (nextStock < 0) throw new Error("MOVEMENT_STOCK_PRECISION_INVALID");
  const nextValue = stock * Number(average ?? 0) + incomingValue - outgoingValue;
  if (nextValue < -EPSILON) throw new Error("MOVEMENT_VALUE_NEGATIVE");
  const nextAverage = nextStock <= EPSILON
    ? average
    : untrusted ? average : nextValue / nextStock;
  return { stock: nextStock, average: nextAverage, untrusted };
}

function restoreInventory(inventoryValue, product, bucket, unitId, rawBaseQuantity) {
  const inventory = normalizeInventory(inventoryValue);
  const amount = quantity(rawBaseQuantity);
  if (amount <= 0) throw new Error("QUANTITY_MUST_BE_POSITIVE");
  const before = normalizeInventory(inventory);
  if (bucket === "loose") {
    inventory.loose_base_quantity = round4(inventory.loose_base_quantity + amount);
  } else if (bucket === "package") {
    const unit = unitById(product, unitId);
    if (unit.stock_kind !== "package") throw new Error("UNIT_NOT_PACKAGE");
    const packageCount = amount / unit.factor;
    if (Math.abs(packageCount - Math.round(packageCount)) > EPSILON) throw new Error("RETURN_NOT_WHOLE_PACKAGE");
    inventory.closed_packages[unit.id] = (inventory.closed_packages[unit.id] || 0) + Math.round(packageCount);
  } else {
    throw new Error("RETURN_BUCKET_INVALID");
  }
  return { inventory, changes: bucketDelta(before, inventory) };
}

function removeInventory(inventoryValue, product, bucket, unitId, rawBaseQuantity) {
  const inventory = normalizeInventory(inventoryValue);
  const amount = quantity(rawBaseQuantity);
  if (amount <= 0) throw new Error("QUANTITY_MUST_BE_POSITIVE");
  const before = normalizeInventory(inventory);
  if (bucket === "loose") {
    if (inventory.loose_base_quantity + EPSILON < amount) throw new Error("STOCK_INSUFFICIENT");
    inventory.loose_base_quantity = round4(inventory.loose_base_quantity - amount);
  } else if (bucket === "package") {
    const unit = unitById(product, unitId);
    if (unit.stock_kind !== "package") throw new Error("UNIT_NOT_PACKAGE");
    const packageCount = amount / unit.factor;
    if (Math.abs(packageCount - Math.round(packageCount)) > EPSILON) throw new Error("RETURN_NOT_WHOLE_PACKAGE");
    const current = inventory.closed_packages[unit.id] || 0;
    if (current < packageCount) throw new Error("STOCK_INSUFFICIENT");
    inventory.closed_packages[unit.id] = current - Math.round(packageCount);
  } else {
    throw new Error("INVENTORY_BUCKET_INVALID");
  }
  return { inventory, changes: bucketDelta(before, inventory) };
}

function setInventoryBucket(inventoryValue, product, bucket, unitId, rawQuantity) {
  const inventory = normalizeInventory(inventoryValue);
  const amount = quantity(rawQuantity);
  const before = normalizeInventory(inventory);
  if (bucket === "loose") {
    inventory.loose_base_quantity = amount;
  } else if (bucket === "package") {
    const unit = unitById(product, unitId);
    if (unit.stock_kind !== "package") throw new Error("UNIT_NOT_PACKAGE");
    if (!Number.isInteger(amount)) throw new Error("PACKAGE_COUNT_MUST_BE_INTEGER");
    inventory.closed_packages[unit.id] = amount;
  } else {
    throw new Error("INVENTORY_BUCKET_INVALID");
  }
  return { inventory, changes: bucketDelta(before, inventory) };
}

function movingAverage(oldQuantity, oldCost, addedQuantity, addedValue) {
  const existingQuantity = quantity(oldQuantity);
  const incomingQuantity = quantity(addedQuantity);
  const previousCost = oldCost === null || oldCost === undefined ? Number.NaN : Number(oldCost);
  const incomingCostValue = Number(addedValue);
  if (incomingQuantity <= 0) return Number.isFinite(previousCost) ? previousCost : null;
  if (!Number.isFinite(incomingCostValue) || incomingCostValue < 0) throw new Error("COST_INVALID");
  if (existingQuantity <= 0) return incomingCostValue / incomingQuantity;
  if (!Number.isFinite(previousCost)) throw new Error("COST_MISSING");
  return (existingQuantity * previousCost + incomingCostValue) / (existingQuantity + incomingQuantity);
}

function lowStockComponents(product) {
  if (!product.inventory) return [];
  let inventory;
  try { inventory = normalizeInventory(product.inventory); }
  catch { return []; }
  const alerts = product.inventory_alerts || {};
  const rows = [];
  const looseRule = alerts.loose || {};
  const loosePoint = Number(looseRule.reorder_point);
  if (Number.isFinite(loosePoint) && loosePoint > 0 && inventory.loose_base_quantity < loosePoint) {
    rows.push({ bucket: "loose", unit_id: product.base_unit_id, current: inventory.loose_base_quantity, reorder_point: loosePoint, target_level: looseRule.target_level ?? null });
  }
  for (const unit of product.units || []) {
    if (unit.stock_kind !== "package") continue;
    const rule = alerts.packages?.[unit.id] || {};
    const point = Number(rule.reorder_point);
    const current = inventory.closed_packages[unit.id] || 0;
    if (Number.isFinite(point) && point > 0 && current < point) {
      rows.push({ bucket: "package", unit_id: unit.id, unit_name: unit.name, current, reorder_point: point, target_level: rule.target_level ?? null });
    }
  }
  return rows;
}

function inventoryLabel(inventoryValue, product) {
  const inventory = normalizeInventory(inventoryValue);
  const units = product.units || [];
  const packages = units
    .filter((unit) => unit.stock_kind === "package" && (inventory.closed_packages[unit.id] || 0) > 0)
    .sort((left, right) => Number(right.factor) - Number(left.factor));
  const segments = packages.map((unit) => `${inventory.closed_packages[unit.id]} ${unit.name}`);
  if (inventory.loose_base_quantity > 0 || segments.length === 0) segments.push(`${inventory.loose_base_quantity} ${product.base_unit_name || "وحدة"}`);
  return segments.join(" و ");
}

export {
  baseQuantityFor,
  EPSILON,
  addPurchase,
  bucketDelta,
  emptyInventory,
  inventoryLabel,
  inventoryTotal,
  lowStockComponents,
  movingAverage,
  normalizeInventory,
  quantity,
  removeInventory,
  restoreSaleConsumption,
  replayMovementGroup,
  restoreInventory,
  round4,
  roundMoney,
  sellInventory,
  setInventoryBucket,
  unitById,
};
