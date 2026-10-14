const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const { createHash } = require("node:crypto");

function invoiceRevision(invoice) {
  return createHash("sha256").update(JSON.stringify({
    products: invoice.products ?? null, customer_id: invoice.customer_id ?? null,
    paid_amount: invoice.paid_amount ?? null, remaining: invoice.remaining ?? null,
    discount: invoice.discount ?? null, discount_percentage: invoice.discount_percentage ?? null,
    returned: invoice.returned ?? null, return_status: invoice.return_status ?? null,
  })).digest("hex");
}

function safeProduct(id, data, inventoryTotal) {
  const configured = Array.isArray(data.units) ? data.units : [];
  const units = configured.filter((unit) => Number(unit.factor) > 0 && (unit.stock_kind === "loose" || unit.stock_kind === "package")).map((unit) => ({
    id: unit.id,
    name: unit.name,
    factor: Number(unit.factor),
    stock_kind: unit.stock_kind,
    selling_price: unit.selling_price ?? null,
    purchase_price: unit.purchase_price ?? null,
    is_base: unit.is_base === true,
    can_sell: unit.can_sell !== false,
    can_purchase: unit.can_purchase !== false,
    allows_fractional: unit.allows_fractional === true,
    archived: unit.archived === true,
  }));
  const inventory = data.inventory && typeof data.inventory === "object" ? data.inventory : null;
  let stockQuantity = null;
  if (inventory) {
    try { stockQuantity = inventoryTotal(inventory, units); }
    catch { stockQuantity = null; }
  }
  return {
    id, uses_variants: data.uses_variants !== false,
    inventory_mode: data.inventory_mode === "independent" ? "independent" : "convertible",
    name: data.inventory_mode === "independent"
      ? data.uses_variants === false
        ? [data.family_name || data.name, data.pack_size_name].filter(Boolean).join(" — ")
        : [data.family_name, data.variant_name || data.name, data.pack_size_name].filter(Boolean).join(" — ")
      : data.uses_variants === false ? data.family_name || data.name : data.family_name && data.variant_name ? `${data.family_name} — ${data.variant_name}` : data.name,
    family_id: data.family_id ?? null,
    family_name: data.family_name ?? null,
    variant_name: data.variant_name ?? data.name,
    variant_key: data.variant_key ?? null,
    pack_size_name: data.pack_size_name ?? null,
    variant_order: Number.isInteger(data.variant_order) ? data.variant_order : 0,
    pack_size_order: Number.isInteger(data.pack_size_order) ? data.pack_size_order : 0,
    inventory,
    stock_quantity: stockQuantity,
    cost_price: null,
    inventory_alerts: data.inventory_alerts ?? { loose: { reorder_point: 0, target_level: null }, packages: {} },
    base_unit_id: data.base_unit_id ?? null,
    base_unit_name: data.base_unit_name ?? null, is_active: data.is_active !== false, units,
  };
}

function safeInvoice(invoice) {
  const { cost, profit, total_cost, total_profit, ...visible } = invoice;
  return {
    ...visible,
    products: (Array.isArray(invoice.products) ? invoice.products : []).map((line) => {
      const { product_cost_price, base_cost_snapshot, cost_groups, unit_cost, ...item } = line;
      return item;
    }),
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

function splitCustomerReturn(refund, remainingDebt, creditUsed, creditRestoredBefore, cashRequested) {
  const debtReduction = money(Math.min(Math.max(0, refund), Math.max(0, remainingDebt)));
  const refundable = money(refund - debtReduction);
  const creditRestored = money(Math.min(refundable, Math.max(0, money(creditUsed - creditRestoredBefore))));
  const settlement = money(refundable - creditRestored);
  if (typeof cashRequested !== "number" || !Number.isFinite(cashRequested) || cashRequested < 0 || cashRequested - settlement > 0.005) throw new Error("Invalid cash refund amount.");
  return { debtReduction, creditRestored, cashRefund: money(cashRequested), creditIssued: money(settlement - cashRequested), settlement };
}

module.exports = { safeProduct, safeInvoice, saleAmounts, invoiceRevision, splitCustomerReturn };
