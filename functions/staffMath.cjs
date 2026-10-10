const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function safeProduct(id, data) {
  const configured = Array.isArray(data.units) && data.units.length ? data.units : [{ id: data.base_unit_id || "legacy-base", name: data.base_unit_name || "وحدة", factor: 1, selling_price: data.price ?? null, is_base: true }];
  const units = configured.filter((unit) => Number(unit.factor) > 0).map((unit) => ({
    id: unit.id,
    name: unit.name,
    factor: Number(unit.factor),
    selling_price: unit.selling_price ?? ((unit.is_base || unit.id === data.base_unit_id) ? data.price ?? null : null),
    is_base: unit.is_base === true,
    can_sell: unit.can_sell !== false,
  }));
  return {
    id, name: data.name, price: data.price ?? null, stock_quantity: data.stock_quantity ?? null,
    low_stock_threshold: data.low_stock_threshold ?? 5, base_unit_id: data.base_unit_id ?? null,
    base_unit_name: data.base_unit_name ?? null, is_active: data.is_active !== false, units,
  };
}

function saleAmounts(lines, { previous, delivery, feeds, mahros, discount, discountPercentage, paid }) {
  const lineGross = lines.reduce((sum, line) => sum + line.product_price * line.product_quantity, 0);
  const subtotal = money(lineGross);
  const currentGross = money(lineGross + delivery + feeds + mahros);
  const gross = money(lineGross + delivery + feeds + mahros + previous);
  const discountValue = discountPercentage ? money(gross * discount / 100) : money(discount);
  const total = money(gross - discountValue);
  const remaining = money(total - paid);
  const sales = gross > 0 ? money(currentGross - discountValue * currentGross / gross) : 0;
  const cost = money(lines.reduce((sum, line) => sum + line.base_quantity * line.product_cost_price, 0));
  const discountShare = gross > 0 ? discountValue / gross : 0;
  const profit = money(lines.reduce((sum, line) => sum + money(line.product_price * line.product_quantity) * (1 - discountShare) - money(line.base_quantity * line.product_cost_price), 0));
  return { subtotal, currentGross, gross, discountValue, total, remaining, sales, cost, profit };
}

module.exports = { safeProduct, saleAmounts };
