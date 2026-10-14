const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const { safeInvoice, saleAmounts, invoiceRevision, splitCustomerReturn } = require("./staffMath.cjs");
const inventoryCorePromise = import("./shared/inventoryCore.mjs");

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const cost4 = (value) => Math.round(((Number.isFinite(Number(value)) ? Number(value) : 0) + Number.EPSILON) * 10000) / 10000;
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const invalid = (message) => { throw new HttpsError("invalid-argument", message); };
const unavailable = (message) => { throw new HttpsError("failed-precondition", message); };
const periodOf = (date) => {
  const parsed = date?.toDate?.() || (date instanceof Date ? date : new Date());
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}` };
};
const baseQuantity = (line) => {
  const saved = Number(line.base_quantity);
  if (!Number.isFinite(saved) || saved < 0) throw new HttpsError("failed-precondition", "فاتورة قديمة بلا كمية أساسية موثوقة.");
  return cost4(saved);
};
const historicalCost = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) unavailable("لقطة تكلفة الفاتورة غير صالحة.");
  return parsed;
};
const costGroups = (line) => Array.isArray(line.cost_groups) && line.cost_groups.length
  ? line.cost_groups.map((group, index) => ({ group_id: text(group.group_id, 160) || `${text(line.line_id, 128) || "legacy"}:cost:${index}`, base_quantity: cost4(group.base_quantity), unit_cost: historicalCost(group.unit_cost) })).filter((group) => group.base_quantity > 0)
  : [{ group_id: `${text(line.line_id, 128) || "legacy"}:cost:0`, base_quantity: baseQuantity(line), unit_cost: historicalCost(line.base_cost_snapshot ?? line.product_cost_price) }].filter((group) => group.base_quantity > 0);
function combineDeltas(lines) {
  const effects = {};
  for (const line of lines) {
    if (!line.product_id) continue;
    if (!line.component_deltas || !Number.isFinite(Number(line.component_deltas.loose_base_quantity)) || !line.component_deltas.closed_packages) {
      throw new HttpsError("failed-precondition", "الفاتورة لا تحتوي على سجل مكونات مخزون كامل.");
    }
    const effect = effects[line.product_id] || { loose_base_quantity: 0, closed_packages: {} };
    effect.loose_base_quantity = cost4(effect.loose_base_quantity + Number(line.component_deltas.loose_base_quantity));
    for (const [unitId, change] of Object.entries(line.component_deltas.closed_packages)) {
      if (!Number.isInteger(Number(change))) throw new HttpsError("failed-precondition", "سجل عبوات الفاتورة غير صالح.");
      effect.closed_packages[unitId] = (effect.closed_packages[unitId] || 0) + Number(change);
      if (!effect.closed_packages[unitId]) delete effect.closed_packages[unitId];
    }
    effects[line.product_id] = effect;
  }
  return effects;
}
const amounts = (invoice) => saleAmounts(invoice.products || [], {
  previous: number(invoice.debt), delivery: number(invoice.delivery_price),
  feeds: number(invoice.amount_of_animal_feeds), mahros: number(invoice.amount_of_mahros),
  discount: number(invoice.discount), discountPercentage: invoice.discount_percentage === true,
  paid: number(invoice.paid_amount),
});
const invoiceTotal = (invoice) => {
  const result = amounts(invoice);
  return { gross: result.gross, discountValue: result.discountValue, net: result.total };
};
const outstanding = (invoice) => invoice.remaining != null ? Math.max(0, money(invoice.remaining))
  : invoice.paid_amount == null ? 0 : Math.max(0, money(invoiceTotal(invoice).net - number(invoice.paid_amount)));
const customerSummaryKey = (invoice) => {
  if (invoice.customer_id) return invoice.customer_id;
  const name = String(invoice.customer_name || "").replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g, "").replace(/\s+/g, " ").trim();
  const phone = String(invoice.customer_phone ?? "").replace(/\D/g, "");
  if (!name || phone.length < 7) return null;
  let hash = 2166136261;
  const value = `${name}|${phone}`;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `legacy_${(hash >>> 0).toString(36)}`;
};
const invoiceMetrics = (invoice) => {
  const { gross, discountValue, net } = invoiceTotal(invoice);
  const computed = amounts(invoice);
  const currentGross = computed.currentGross;
  const sales = computed.sales;
  const cost = money((invoice.products || []).reduce((sum, line) => sum + costGroups(line).reduce((value, group) => value + group.base_quantity * group.unit_cost, 0), 0));
  const profit = money((invoice.products || []).reduce((sum, line) => sum + number(line.product_price) * number(line.product_quantity) * (gross > 0 ? 1 - discountValue / gross : 1)
    - costGroups(line).reduce((value, group) => value + group.base_quantity * group.unit_cost, 0), 0));
  const remaining = outstanding(invoice);
  const paid = invoice.paid_amount == null ? money(net - remaining) : money(number(invoice.paid_amount) - number(invoice.credit_used));
  return {
    total_sales: sales, gross_sales: currentGross,
    total_discount: gross > 0 && currentGross > 0 ? money(discountValue * currentGross / gross) : discountValue,
    total_paid: paid, outstanding_customer_debt: remaining, total_cost: cost, total_profit: profit,
    invoice_count: 1, paid_invoice_count: remaining <= 0 ? 1 : 0,
    partial_invoice_count: remaining > 0 && paid > 0 ? 1 : 0,
    unpaid_invoice_count: remaining > 0 && paid <= 0 ? 1 : 0,
  };
};

module.exports = ({ db, authorize, roleOf, operationRef }) => {
  const statsDelta = (tx, oldInvoice, newInvoice, extra = null) => {
    const oldValues = oldInvoice ? invoiceMetrics(oldInvoice) : {};
    const newValues = newInvoice ? invoiceMetrics(newInvoice) : {};
    const delta = {};
    for (const key of new Set([...Object.keys(oldValues), ...Object.keys(newValues)])) {
      const value = key.endsWith("_count") ? number(newValues[key]) - number(oldValues[key]) : money(number(newValues[key]) - number(oldValues[key]));
      if (value) delta[key] = value;
    }
    if (extra) for (const [key, value] of Object.entries(extra)) delta[key] = key.endsWith("_count") ? number(delta[key]) + value : money(number(delta[key]) + value);
    const write = (path, values) => {
      const patch = { updated_at: FieldValue.serverTimestamp() };
      for (const [key, value] of Object.entries(values)) if (value) patch[key] = FieldValue.increment(value);
      tx.set(db.doc(path), patch, { merge: true });
    };
    write("store_stats/current", delta);
    const oldPeriod = oldInvoice && periodOf(oldInvoice.date);
    const newPeriod = newInvoice && periodOf(newInvoice.date);
    const periods = new Map();
    const merge = (path, values, sign) => {
      const current = periods.get(path) || {};
      for (const [key, value] of Object.entries(values)) current[key] = key.endsWith("_count") ? number(current[key]) + sign * value : money(number(current[key]) + sign * value);
      periods.set(path, current);
    };
    if (oldPeriod) for (const key of [oldPeriod.day, oldPeriod.month]) merge(`${key.length === 7 ? "invoice_stats_monthly" : "invoice_stats_daily"}/${key}`, oldValues, -1);
    if (newPeriod) for (const key of [newPeriod.day, newPeriod.month]) merge(`${key.length === 7 ? "invoice_stats_monthly" : "invoice_stats_daily"}/${key}`, newValues, 1);
    if (extra) {
      const now = periodOf(new Date());
      for (const key of [now.day, now.month]) merge(`${key.length === 7 ? "invoice_stats_monthly" : "invoice_stats_daily"}/${key}`, extra, 1);
    }
    for (const [path, values] of periods) write(path, values);
  };
  const summary = (tx, id, invoice) => {
    const metrics = invoiceMetrics(invoice);
    tx.set(db.doc(`invoice_debt_summaries/${id}`), {
      invoice_id: id, customer_id: invoice.customer_id || null, customer_name: invoice.customer_name || null,
      customer_phone: invoice.customer_phone ?? null, date: invoice.date ?? null,
      total: invoiceTotal(invoice).net, sales: metrics.total_sales, paid: metrics.total_paid,
      remaining: metrics.outstanding_customer_debt, profit: metrics.total_profit,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  };
  const groupRows = (invoice, returns, productsById = new Map(), invoiceId = "legacy") => {
    const returnedByLine = new Map();
    const returnedByCostGroup = new Map();
    for (const record of returns) for (const item of record.items || []) {
      const lineIndex = Number.isInteger(item.source_line_index) ? item.source_line_index : -1;
      const sourceLine = invoice.products?.[lineIndex];
      const lineId = text(item.line_id, 128) || text(sourceLine?.line_id, 128) || (sourceLine ? `${invoiceId}-legacy-${lineIndex}` : "");
      if (!lineId || !Number.isFinite(Number(item.base_quantity)) || Number(item.base_quantity) <= 0) unavailable("سجل المرتجع لا يحتوي على ارتباط موثوق بسطر الفاتورة.");
      returnedByLine.set(lineId, cost4(number(returnedByLine.get(lineId)) + Number(item.quantity)));
      const allocations = Array.isArray(item.cost_allocations) ? item.cost_allocations : (() => {
        if (!sourceLine || !Number.isInteger(item.source_cost_group_index)) unavailable("سجل المرتجع القديم يحتاج مراجعة المسؤول قبل مرتجع جديد.");
        const sourceGroup = costGroups(sourceLine)[item.source_cost_group_index];
        if (!sourceGroup) unavailable("سجل المرتجع لا يطابق مجموعة تكلفة الفاتورة.");
        return [{ cost_group_id: sourceGroup.group_id, base_quantity: item.base_quantity, unit_cost: sourceGroup.unit_cost }];
      })();
      for (const allocation of allocations) {
        const groupId = text(allocation.cost_group_id, 160);
        const base = Number(allocation.base_quantity);
        if (!groupId || !Number.isFinite(base) || base <= 0) unavailable("تخصيص تكلفة المرتجع غير صالح.");
        const key = `${lineId}:${groupId}`;
        returnedByCostGroup.set(key, cost4(number(returnedByCostGroup.get(key)) + base));
      }
    }
    const rows = [];
    for (const [lineIndex, line] of (invoice.products || []).entries()) {
      if (!line.product_id) continue;
      const factor = Number(line.unit_factor);
      const lineId = text(line.line_id, 128) || `${invoiceId}-legacy-${lineIndex}`;
      if (!line.unit_id || (line.stock_kind !== "loose" && line.stock_kind !== "package") || typeof line.allows_fractional !== "boolean"
        || !Number.isFinite(factor) || factor <= 0) unavailable("الفاتورة لا تحتوي على لقطة وحدة كاملة للمرتجع.");
      const groups = costGroups(line);
      const soldBase = cost4(groups.reduce((sum, group) => sum + group.base_quantity, 0));
      if (Math.abs(soldBase - baseQuantity(line)) > 1e-9) unavailable("مجموعات تكلفة سطر الفاتورة لا تطابق كميته الأساسية.");
      const soldQty = cost4(soldBase / factor);
      const returnedQty = cost4(number(returnedByLine.get(lineId)));
      if (returnedQty - soldQty > 1e-9) unavailable("كمية المرتجعات تتجاوز كمية السطر المباع.");
      const usedGroups = groups.map((group) => {
        const used = number(returnedByCostGroup.get(`${lineId}:${group.group_id}`));
        if (used - group.base_quantity > 1e-9) unavailable("تخصيص المرتجع يتجاوز مجموعة التكلفة الأصلية.");
        return { ...group, returned_base_quantity: cost4(used) };
      });
      const product = productsById.get(line.product_id);
      const looseUnit = (product?.units || []).find((unit) => unit.id === product.base_unit_id);
      const returnUnits = (product?.units || []).filter((unit) => unit.stock_kind === "package")
        .map((unit) => ({ id: unit.id, name: unit.name, factor: Number(unit.factor) }));
      rows.push({ key: lineId, line_id: lineId, product_id: line.product_id, product_name: line.product_name,
        inventory_mode: line.inventory_mode === "independent" || product?.inventory_mode === "independent" ? "independent" : "convertible",
        unit_id: line.unit_id, unit_name: line.unit_name, unit_factor: factor,
        loose_unit_name: product?.base_unit_name || looseUnit?.name || line.unit_name,
        stock_kind: line.stock_kind, allows_fractional: line.allows_fractional,
        unit_price: number(line.product_price), soldQty, returnedQty,
        maxQty: Math.max(0, cost4(soldQty - returnedQty)), cost_groups: usedGroups, return_units });
    }
    return rows;
  };

  const updateStaffInvoice = onCall(async (request) => {
    const { baseQuantityFor, inventoryTotal, normalizeInventory, restoreSaleConsumption, sellInventory } = await inventoryCorePromise;
    const id = text(request.data?.id, 128);
    const requested = request.data?.products;
    if (!id || !Array.isArray(requested) || !requested.length || requested.length > 50) invalid("Select invoice products.");
    const discount = request.data?.discount;
    const paid = request.data?.paid_amount;
    if (typeof discount !== "number" || !Number.isFinite(discount) || discount < 0 || typeof paid !== "number" || !Number.isFinite(paid) || paid < 0) invalid("Invalid invoice amounts.");
    const opRef = operationRef(request, "invoice_edit");
    const invoiceRef = db.doc(`invoices/${id}`);
    const initial = await invoiceRef.get();
    if (!initial.exists) throw new HttpsError("not-found", "Invoice not found.");
    const [returns, cashHistory, paymentHistory] = await Promise.all([
      db.collection("invoice_returns").where("invoice_id", "==", id).get(),
      db.collection("cash_transactions").where("invoice_id", "==", id).get(),
      initial.data().customer_id ? db.collection("debt_payments").where("customer_id", "==", initial.data().customer_id).get() : Promise.resolve(null),
    ]);
    const relatedPayments = paymentHistory?.docs.filter((doc) => (doc.data().allocations || []).some((item) => item.type === "invoice" && item.reference_id === id)) || [];
    if (returns.size + cashHistory.size + relatedPayments.length > 350) unavailable("سجل الفاتورة كبير جدًا للتعديل المباشر.");
    return db.runTransaction(async (tx) => {
      const role = await authorize(request, tx);
      const oldSnaps = await Promise.all([tx.get(opRef), tx.get(invoiceRef),
        ...returns.docs.map((doc) => tx.get(doc.ref)), ...cashHistory.docs.map((doc) => tx.get(doc.ref)),
        ...relatedPayments.map((doc) => tx.get(doc.ref))]);
      if (oldSnaps[0].exists) return oldSnaps[0].data().result;
      const saved = oldSnaps[1];
      if (!saved.exists) throw new HttpsError("not-found", "Invoice not found.");
      const original = saved.data();
      if (original.status === "cancelled") unavailable("لا يمكن تعديل فاتورة ملغاة.");
      if (number(original.credit_used) > 0) unavailable("لا يمكن تعديل فاتورة استُخدم فيها رصيد العميل. استخدم المرتجع والتسوية.");
      if (request.data?.edit_revision !== invoiceRevision(original)) unavailable("تغيرت الفاتورة. أعد فتحها قبل التعديل.");
      const oldLines = Array.isArray(original.products) ? original.products : [];
      if (returns.size || number(original.returned_base_quantity) > 0 || Object.values(original.returned || {}).some((value) => number(value) > 0)
        || oldSnaps.slice(2, 2 + returns.size).some((doc) => doc.exists)) unavailable("لا يمكن تعديل فاتورة تحتوي على مرتجع.");
      if (number(original.debt_payment_count) > 0 || relatedPayments.length
        || oldSnaps.slice(2 + returns.size).some((doc) => doc.exists && (doc.data().type === "invoice_payment" || doc.data().debt_payment_id))) unavailable("لا يمكن تعديل فاتورة بعد سداد دين منها.");
      if (money(original.paid_amount) !== money(initial.data().paid_amount) || money(original.remaining) !== money(initial.data().remaining)) unavailable("تغيرت الفاتورة. أعد فتحها.");
      const customerId = text(request.data?.customer_id, 128);
      if (!customerId) invalid("Invalid customer.");
      const productIds = [...new Set(requested.map((line) => text(line?.product_id, 128)).filter(Boolean))];
      if (productIds.length === 0 || productIds.length > 50) invalid("Invalid products.");
      const [customer, cash, ...productSnaps] = await Promise.all([
        tx.get(db.doc(`customers/${customerId}`)), tx.get(db.doc("cashbox/current")),
        ...productIds.map((productId) => tx.get(db.doc(`products/${productId}`))),
      ]);
      if (!customer.exists || productSnaps.some((product) => !product.exists)) unavailable("العميل أو أحد المنتجات غير موجود.");
      if (!original.customer_id) {
        const oldPhone = String(original.customer_phone ?? "").replace(/\D/g, "");
        if (!oldPhone || String(customer.data().phone ?? "").replace(/\D/g, "") !== oldPhone || String(customer.data().name || "").trim() !== String(original.customer_name || "").trim()) unavailable("تعذر التحقق من عميل الفاتورة القديمة.");
      }
      const products = new Map(productSnaps.map((snapshot) => [snapshot.id, snapshot]));
      const usedOld = new Set();
      const sourceLines = new Map();
      const lines = requested.map((entry, index) => {
        const productId = text(entry?.product_id, 128);
        const productSnap = products.get(productId);
        const product = productSnap?.data();
        const quantity = entry?.product_quantity;
        if (!product || product.is_active === false || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) invalid("Invalid invoice product or quantity.");
        const unitId = text(entry?.unit_id, 128);
        const configured = Array.isArray(product.units) ? product.units : [];
        const unit = configured.find((item) => item.id === unitId && item.can_sell !== false && number(item.selling_price) > 0);
        if (!unit) invalid("Selling unit is unavailable.");
        if (unit.allows_fractional !== true && !Number.isInteger(quantity)) invalid("This unit does not allow fractional quantities.");
        const factor = Number(unit.factor);
        if (!Number.isFinite(factor) || factor <= 0) invalid("Selling unit has an invalid conversion factor.");
        if (Math.abs(quantity - cost4(quantity)) > 1e-9) invalid("Quantity supports at most four decimal places.");
        let base;
        try { base = baseQuantityFor(quantity, factor); }
        catch (error) {
          if (error.message === "BASE_QUANTITY_PRECISION_INVALID" || error.message === "QUANTITY_MUST_BE_POSITIVE") invalid("الكمية بعد التحويل يجب أن تكون موجبة وقابلة للتمثيل حتى أربع منازل عشرية.");
          invalid("وحدة البيع أو معامل التحويل غير صالح.");
        }
        const oldId = text(entry?.line_id, 128);
        let oldIndex = oldId.startsWith("legacy-") ? Number(oldId.slice(7)) : oldLines.findIndex((line) => line.line_id === oldId && oldId);
        if (!Number.isInteger(oldIndex) || oldIndex < 0 || oldIndex >= oldLines.length || usedOld.has(oldIndex) || oldLines[oldIndex].product_id !== productId) oldIndex = -1;
        if (oldIndex >= 0) usedOld.add(oldIndex);
        const oldLine = oldIndex >= 0 ? oldLines[oldIndex] : null;
        const listed = unit.selling_price;
        if (listed == null && (!oldLine || oldLine.unit_id !== unitId)) invalid("Selling price is unavailable.");
        const requestedPrice = entry?.product_price;
        if (typeof requestedPrice !== "number" || !Number.isFinite(requestedPrice) || requestedPrice < 0) invalid("Invalid selling price.");
        const price = requestedPrice;
        const oldGroups = oldLine ? costGroups(oldLine) : [];
        const oldBase = oldLine ? oldGroups.reduce((s, g) => s + g.base_quantity, 0) : 0;
        let keep = base;
        const groups = [];
        for (const group of oldGroups) {
          const retained = cost4(Math.min(keep, group.base_quantity));
          if (retained > 0) groups.push({ group_id: group.group_id, base_quantity: retained, unit_cost: group.unit_cost });
          keep = cost4(keep - retained);
        }
        if (product.cost_price === null || product.cost_price === undefined || !Number.isFinite(Number(product.cost_price)) || Number(product.cost_price) < 0) unavailable("متوسط تكلفة الصنف غير مسجل.");
        const currentCost = Number(product.cost_price);
        if (keep > 0) groups.push({ group_id: `${opRef.id}:${oldLine?.line_id || `${id}-edit-${index}`}:cost:${groups.length}`, base_quantity: keep, unit_cost: currentCost });
        const average = groups.reduce((sum, group) => sum + group.base_quantity * group.unit_cost, 0) / base;
        const lineId = oldLine?.line_id || `${id}-edit-${index}`;
        sourceLines.set(lineId, oldLine);
        const line = { line_id: lineId, product_id: productId,
          family_id: product.family_id || null, family_name: product.family_name || null, variant_name: product.variant_name || product.name,
          variant_key: product.variant_key || null, pack_size_name: product.pack_size_name || null,
          inventory_mode: product.inventory_mode === "independent" ? "independent" : "convertible",
          product_name: product.inventory_mode === "independent" ? [product.family_name || product.name, product.uses_variants === false ? null : product.variant_name, product.pack_size_name].filter(Boolean).join(" — ") : product.uses_variants === false ? product.family_name || product.name : product.family_name ? `${product.family_name} — ${product.variant_name || product.name}` : product.name,
          product_quantity: quantity, product_price: price, unit_id: unit.id, unit_name: unit.name,
          unit_factor: factor, stock_kind: unit.stock_kind, allows_fractional: unit.allows_fractional === true,
          base_quantity: base, product_cost_price: average, base_cost_snapshot: average,
          cost_groups: groups, option: text(entry?.option, 120) || null, total: money(quantity * price) };
        if (oldLine && oldLine.unit_id === line.unit_id && Math.abs(oldBase - base) <= 1e-9) {
          line.component_deltas = oldLine.component_deltas;
          line.opened_packages = oldLine.opened_packages || [];
        }
        return line;
      });
      const oldLinesToRestore = oldLines.filter((line, index) => line.product_id && !usedOld.has(index));
      for (const line of lines) {
        const source = sourceLines.get(line.line_id);
        if (source && (source.unit_id !== line.unit_id || Math.abs(baseQuantity(source) - line.base_quantity) > 1e-9)) oldLinesToRestore.push(source);
      }
      const extras = ["debt", "delivery_price", "amount_of_animal_feeds", "amount_of_mahros"];
      const updated = { ...original, customer_id: customerId, customer_name: customer.data().name, customer_phone: customer.data().phone ?? null,
        customer_name_norm: String(customer.data().name || "").trim().toLocaleLowerCase(),
        customer_phone_digits: String(customer.data().phone ?? "").replace(/\D/g, ""), products: lines,
        discount, discount_percentage: request.data?.discount_percentage === true,
        discount_for: text(request.data?.discount_for, 100) || null, paid_amount: money(paid) };
      for (const key of extras) {
        const value = request.data?.[key] ?? 0;
        if (!Number.isFinite(Number(value)) || Number(value) < 0) invalid("Invalid invoice amount.");
        updated[key] = number(value);
      }
      const totals = invoiceTotal(updated);
      if ((updated.discount_percentage && discount > 100) || discount - totals.gross > 0.005 || paid - totals.net > 0.005) invalid("Discount or paid amount exceeds the invoice total.");
      updated.remaining = money(totals.net - paid);
      const oldPaid = original.paid_amount == null ? invoiceTotal(original).net : money(original.paid_amount);
      const paidDelta = money(paid - oldPaid);
      if (paidDelta && (!cash.exists || number(cash.data().balance) + paidDelta < -0.005)) unavailable("الخزنة غير مهيأة أو رصيدها لا يكفي فرق التعديل.");
      const affected = [...new Set([...productIds, ...oldLinesToRestore.map((item) => item.product_id)])];
      for (const productId of affected) {
        const snap = products.get(productId) || await tx.get(db.doc(`products/${productId}`));
        if (!snap?.exists) unavailable("أحد منتجات الفاتورة لم يعد موجودًا.");
        products.set(productId, snap);
      }
      if (original.inventory_applied !== true) unavailable("لا يمكن تعديل فاتورة لم يثبت تطبيق أثرها المخزني.");
      const inventoryAfterByProduct = new Map();
      const movementEvents = new Map();
      for (const oldLine of [...oldLinesToRestore].reverse()) {
        if (!oldLine.product_id) continue;
        const product = products.get(oldLine.product_id)?.data();
        if (!product) unavailable("أحد أصناف الفاتورة لم يعد موجودًا.");
        const before = inventoryAfterByProduct.get(oldLine.product_id) || normalizeInventory(product.inventory);
        let restored;
        try { restored = restoreSaleConsumption(before, product, oldLine); }
        catch { unavailable("تغير الرصيد الفعلي ولا يسمح بعكس أثر الفاتورة بأمان."); }
        inventoryAfterByProduct.set(oldLine.product_id, restored.inventory);
        const groups = costGroups(oldLine);
        const restoredBase = cost4(groups.reduce((sum, group) => sum + group.base_quantity, 0));
        const restoredValue = groups.reduce((sum, group) => sum + group.base_quantity * group.unit_cost, 0);
        const events = movementEvents.get(oldLine.product_id) || [];
        events.push({ direction: "in", line: oldLine, base_quantity: restoredBase,
          unit_cost: restoredBase > 0 ? restoredValue / restoredBase : number(product.cost_price),
          component_deltas: restored.changes, opened_packages: [], reason: "invoice_edit_compensation" });
        movementEvents.set(oldLine.product_id, events);
      }
      for (const line of lines) {
        const source = sourceLines.get(line.line_id);
        if (source && source.unit_id === line.unit_id && Math.abs(baseQuantity(source) - line.base_quantity) <= 1e-9) continue;
        const product = products.get(line.product_id)?.data();
        const before = inventoryAfterByProduct.get(line.product_id) || normalizeInventory(product?.inventory);
        let sale;
        try { sale = sellInventory(before, product, line.unit_id, line.product_quantity); }
        catch (error) {
          if (error.message === "STOCK_INSUFFICIENT") unavailable(`الرصيد الفعلي لا يكفي لصنف ${line.product_name}.`);
          if (error.message === "UNIT_MISSING" || error.message === "UNIT_FACTOR_INVALID" || error.message === "UNIT_STOCK_KIND_INVALID") invalid("وحدة البيع غير صالحة.");
          if (error.message === "BASE_QUANTITY_PRECISION_INVALID" || error.message === "QUANTITY_MUST_BE_POSITIVE") invalid("الكمية بعد التحويل يجب أن تكون موجبة وقابلة للتمثيل حتى أربع منازل عشرية.");
          throw error;
        }
        line.component_deltas = sale.changes;
        line.opened_packages = sale.opened;
        inventoryAfterByProduct.set(line.product_id, sale.inventory);
        const events = movementEvents.get(line.product_id) || [];
        events.push({ direction: "out", line, base_quantity: line.base_quantity,
          unit_cost: line.product_cost_price, component_deltas: line.component_deltas,
          opened_packages: line.opened_packages, reason: "invoice_edit" });
        movementEvents.set(line.product_id, events);
      }
      updated.inventory_effects = combineDeltas(lines);
      const now = FieldValue.serverTimestamp();
      tx.update(invoiceRef, { ...updated, inventory_applied: true, cashbox_applied: true, updated_at: now });
      summary(tx, id, updated);
      statsDelta(tx, original, updated);
      const oldMetric = invoiceMetrics(original);
      const newMetric = invoiceMetrics(updated);
      const oldSummaryId = customerSummaryKey(original);
      if (oldSummaryId && oldSummaryId !== customerId) tx.set(db.doc(`customer_summaries/${oldSummaryId}`), {
        invoice_count: FieldValue.increment(-1), total_sales: FieldValue.increment(-oldMetric.total_sales),
        outstanding_debt: FieldValue.increment(-oldMetric.outstanding_customer_debt), updated_at: now }, { merge: true });
      tx.set(db.doc(`customer_summaries/${customerId}`), { customer_id: customerId,
        customer_name: customer.data().name, customer_phone: customer.data().phone ?? null,
        invoice_count: FieldValue.increment(oldSummaryId === customerId ? 0 : 1),
        total_sales: FieldValue.increment(money(newMetric.total_sales - (oldSummaryId === customerId ? oldMetric.total_sales : 0))),
        outstanding_debt: FieldValue.increment(money(newMetric.outstanding_customer_debt - (oldSummaryId === customerId ? oldMetric.outstanding_customer_debt : 0))),
        updated_at: now }, { merge: true });
      const movementIds = new Map();
      for (const [productId, events] of movementEvents) {
        const ids = [];
        const product = products.get(productId).data();
        for (const [seq, event] of events.entries()) {
          const movement = db.collection("inventory_transactions").doc();
          ids.push(movement.id);
          const line = event.line;
          tx.create(movement, { type: "sale", product_id: productId, product_name: line.product_name || product.name,
            quantity: event.base_quantity, unit_quantity: line.product_quantity, unit_id: line.unit_id, unit_name: line.unit_name,
            unit_factor: line.unit_factor, base_quantity: event.base_quantity, direction: event.direction, unit_cost: event.unit_cost,
            invoice_id: id, operation_id: opRef.id, reason: event.reason, component_deltas: event.component_deltas,
            opened_packages: event.opened_packages, note: "تعديل فاتورة", seq, created_by: request.auth.uid, created_at: now });
        }
        movementIds.set(productId, ids);
      }
      for (const productId of affected) {
        const snap = products.get(productId);
        const product = snap.data();
        const currentQuantity = inventoryTotal(product.inventory, product.units);
        const nextInventory = inventoryAfterByProduct.get(productId) || normalizeInventory(product.inventory);
        const nextQuantity = inventoryTotal(nextInventory, product.units);
        const oldValue = oldLines.filter((line) => line.product_id === productId)
          .reduce((sum, line) => sum + costGroups(line).reduce((subtotal, group) => subtotal + group.base_quantity * group.unit_cost, 0), 0);
        const newValue = lines.filter((line) => line.product_id === productId)
          .reduce((sum, line) => sum + costGroups(line).reduce((subtotal, group) => subtotal + group.base_quantity * group.unit_cost, 0), 0);
        let nextCost = product.cost_price;
        if (movementEvents.has(productId) || Math.abs(oldValue - newValue) > 1e-9) {
          if (nextQuantity <= 1e-9) nextCost = product.cost_price;
          else {
            const currentCost = product.cost_price == null ? null : Number(product.cost_price);
            if (currentQuantity > 1e-9 && (currentCost === null || !Number.isFinite(currentCost) || currentCost < 0)) unavailable("متوسط التكلفة غير صالح لتعديل الفاتورة.");
            if (currentCost !== null && (!Number.isFinite(currentCost) || currentCost < 0)) unavailable("متوسط التكلفة غير صالح لتعديل الفاتورة.");
            const evaluatedValue = currentQuantity * Number(currentCost ?? 0) + oldValue - newValue;
            if (evaluatedValue < -1e-7) unavailable("قيمة المخزون لا تسمح بتعديل الفاتورة بأمان.");
            nextCost = Math.max(0, evaluatedValue) / nextQuantity;
          }
        }
        const ids = movementIds.get(productId);
        if (ids?.length || nextCost !== product.cost_price) {
          const patch = { cost_price: nextCost };
          if (inventoryAfterByProduct.has(productId)) patch.inventory = nextInventory;
          if (ids?.length) { patch.last_inventory_transaction_id = ids.at(-1); patch.last_inventory_transaction_ids = ids; }
          tx.update(snap.ref, patch);
        }
      }
      if (paidDelta) {
        tx.update(db.doc("cashbox/current"), { balance: money(number(cash.data().balance) + paidDelta), updated_at: now });
        tx.create(db.collection("cash_transactions").doc(), { type: "invoice_edit_adjustment", direction: paidDelta > 0 ? "in" : "out",
          amount: Math.abs(paidDelta), invoice_id: id, reference_type: "invoice", reference_id: id,
          reference_label: `فاتورة بيع لـ ${customer.data().name}`, note: "فرق تعديل فاتورة",
          created_by: request.auth.uid, created_at: now });
      }
      const result = { id, receipt: { ...(role === "cashier" ? safeInvoice(updated) : updated), id, edit_revision: invoiceRevision(updated) } };
      tx.create(opRef, { result, created_at: now });
      return result;
    });
  });

  const getStaffReturnPreview = onCall(async (request) => {
    await roleOf(request);
    const id = text(request.data?.id, 128);
    if (!id) invalid("Select an invoice.");
    const invoice = await db.doc(`invoices/${id}`).get();
    if (!invoice.exists) throw new HttpsError("not-found", "Invoice not found.");
    if (invoice.data().status === "cancelled") unavailable("لا يمكن معاينة مرتجع لفاتورة ملغاة.");
    const returns = await db.collection("invoice_returns").where("invoice_id", "==", id).get();
    const invoiceData = invoice.data();
    const productIds = [...new Set((invoiceData.products || []).map((line) => line.product_id).filter(Boolean))];
    const products = await Promise.all(productIds.map((productId) => db.doc(`products/${productId}`).get()));
    const productsById = new Map(products.filter((product) => product.exists).map((product) => [product.id, product.data()]));
    const rows = groupRows(invoiceData, returns.docs.map((doc) => doc.data()), productsById, id);
    const totals = invoiceTotal(invoiceData);
    const ratio = totals.gross > 0 ? totals.net / totals.gross : 1;
    const credit = invoiceData.customer_id ? await db.doc(`customer_credits/${invoiceData.customer_id}`).get() : null;
    return { remaining: outstanding(invoiceData), ratio, creditUsed: number(invoiceData.credit_used), creditRestored: number(invoiceData.credit_restored), creditBalance: number(credit?.data()?.balance), rows: rows.map(({ cost_groups, ...row }) => row) };
  });

  const createStaffReturn = onCall(async (request) => {
    const { baseQuantityFor, inventoryTotal, movingAverage, normalizeInventory, restoreInventory } = await inventoryCorePromise;
    const id = text(request.data?.id, 128);
    const wanted = request.data?.items;
    if (!id || !Array.isArray(wanted) || !wanted.length || wanted.length > 50) invalid("Select return items.");
    const opRef = operationRef(request, "return");
    const fingerprint = JSON.stringify({
      id,
      items: wanted.map((item) => ({ line_id: text(item?.line_id, 128), quantity: Number(item?.quantity), return_bucket: item?.return_bucket, return_unit_id: text(item?.return_unit_id, 64) || null })),
      note: text(request.data?.note, 500) || null,
      cashRefund: money(number(request.data?.cashRefund)),
    });
    const returnRef = db.collection("invoice_returns").doc();
    return db.runTransaction(async (tx) => {
      await authorize(request, tx);
      const invoiceRef = db.doc(`invoices/${id}`);
      const [previous, invoiceSnap, priorReturns] = await Promise.all([tx.get(opRef), tx.get(invoiceRef), tx.get(db.collection("invoice_returns").where("invoice_id", "==", id))]);
      if (previous.exists) {
        if (previous.data().fingerprint !== fingerprint) unavailable("مفتاح المرتجع مستخدم لبيانات مختلفة.");
        return previous.data().result;
      }
      if (!invoiceSnap.exists) throw new HttpsError("not-found", "Invoice not found.");
      if (invoiceSnap.data().status === "cancelled") unavailable("لا يمكن إنشاء مرتجع لفاتورة ملغاة.");
      const returnSnaps = priorReturns.docs;
      const invoice = invoiceSnap.data();
      const previousReturns = returnSnaps.map((doc) => doc.data());
      const rows = new Map(groupRows(invoice, previousReturns, new Map(), id).map((row) => [row.line_id, row]));
      const stored = invoice.returned || {};
      const counted = {};
      for (const record of previousReturns) for (const item of record.items || []) counted[item.product_id] = cost4(number(counted[item.product_id]) + number(item.base_quantity));
      for (const productId of new Set([...Object.keys(stored), ...Object.keys(counted)])) if (Math.abs(number(stored[productId]) - number(counted[productId])) > 1e-9) unavailable("تغير سجل المرتجعات. أعد فتح الفاتورة.");
      const seen = new Set();
      const totals = invoiceTotal(invoice);
      const ratio = totals.gross > 0 ? totals.net / totals.gross : 1;
      const items = [];
      for (const requested of wanted) {
        const key = text(requested?.line_id, 128);
        const row = rows.get(key);
        const quantity = requested?.quantity;
        if (!row || seen.has(key) || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || Math.abs(quantity - cost4(quantity)) > 1e-9 || quantity - row.maxQty > 1e-9) invalid("Return quantity exceeds the available quantity.");
        seen.add(key);
        const rf = Number(row.unit_factor);
        if (!Number.isFinite(rf) || rf <= 0) unavailable("معامل وحدة الفاتورة غير صالح؛ لا يمكن تسجيل المرتجع.");
        let returnedBase;
        try { returnedBase = baseQuantityFor(quantity, rf); }
        catch { invalid("الكمية بعد التحويل يجب أن تكون موجبة وقابلة للتمثيل حتى أربع منازل عشرية."); }
        const returnBucket = requested?.return_bucket;
        const returnUnitId = text(requested?.return_unit_id, 64) || null;
        if (returnBucket !== "loose" && returnBucket !== "package") invalid("Choose whether the returned stock is loose or a sealed package.");
        if ((row.allows_fractional !== true && !Number.isInteger(quantity)) || (row.stock_kind === "package" && !Number.isInteger(quantity))) invalid("This sold unit does not allow fractional quantities.");
        if (row.inventory_mode === "independent" && returnBucket === "loose" && !Number.isInteger(returnedBase)) invalid("مرتجع العبوات المستقلة يجب أن يكون عددًا صحيحًا من العبوات الكاملة.");
        let remainingBase = returnedBase;
        const costAllocations = [];
        for (const group of [...row.cost_groups].reverse()) {
          if (remainingBase <= 1e-9) break;
          const available = cost4(group.base_quantity - group.returned_base_quantity);
          if (available <= 0) continue;
          const take = cost4(Math.min(available, remainingBase));
          if (take > 0) costAllocations.push({ cost_group_id: group.group_id, base_quantity: take, unit_cost: group.unit_cost });
          remainingBase = cost4(remainingBase - take);
        }
        if (remainingBase > 1e-9) invalid("كمية المرتجع تتجاوز الكمية المتبقية بعد توزيع التكلفة.");
        const returnedValue = costAllocations.reduce((sum, allocation) => sum + allocation.base_quantity * allocation.unit_cost, 0);
        const weightedUnitCost = returnedValue / returnedBase;
        items.push({ line_id: row.line_id, product_id: row.product_id, product_name: row.product_name, quantity: cost4(quantity),
          unit_id: row.unit_id, unit_name: row.unit_name, unit_factor: rf,
          base_quantity: returnedBase, original_unit_price: row.unit_price,
          original_unit_cost: weightedUnitCost, cost_allocations: costAllocations,
          return_bucket: returnBucket, return_unit_id: returnUnitId,
          refund_amount: money(row.unit_price * quantity * ratio) });
      }
      const totalRefund = money(items.reduce((sum, item) => sum + item.refund_amount, 0));
      let settlement;
      try { settlement = splitCustomerReturn(totalRefund, outstanding(invoice), number(invoice.credit_used), number(invoice.credit_restored), request.data?.cashRefund ?? 0); }
      catch { invalid("Invalid cash refund amount."); }
      const { debtReduction, creditRestored, cashRefund, creditIssued } = settlement;
      if ((creditRestored > 0 || creditIssued > 0) && !invoice.customer_id) unavailable("اربط الفاتورة بعميل قبل حفظ رصيد له.");
      const productIds = [...new Set(items.map((item) => item.product_id))];
      const creditRef = invoice.customer_id ? db.doc(`customer_credits/${invoice.customer_id}`) : null;
      const [cash, credit, ...products] = await Promise.all([cashRefund > 0 ? tx.get(db.doc("cashbox/current")) : Promise.resolve(null), creditRef && (creditRestored > 0 || creditIssued > 0) ? tx.get(creditRef) : Promise.resolve(null), ...productIds.map((productId) => tx.get(db.doc(`products/${productId}`)))]);
      if (cashRefund > 0 && (!cash?.exists || number(cash.data().balance) + 0.005 < cashRefund)) unavailable("رصيد الخزنة لا يكفي للمرتجع النقدي.");
      if (products.some((product) => !product.exists)) unavailable("أحد منتجات الفاتورة لم يعد موجودًا.");
      for (const item of items) {
        const product = products.find((snapshot) => snapshot.id === item.product_id).data();
        const unit = (product.units || []).find((candidate) => candidate.id === item.unit_id);
        if (!unit) unavailable("وحدة المنتج لم تعد موجودة.");
        if (unit.allows_fractional !== true && !Number.isInteger(item.quantity)) invalid("This unit does not allow fractional quantities.");
      }
      const now = FieldValue.serverTimestamp();
      const movementIds = new Map();
      const nextProducts = new Map();
      for (const [index, productId] of productIds.entries()) {
        const snapshot = products[index];
        const product = snapshot.data();
        let inventory = normalizeInventory(product.inventory);
        const inflows = items.filter((item) => item.product_id === productId);
        for (const item of inflows) {
          const restored = restoreInventory(inventory, product, item.return_bucket, item.return_unit_id, item.base_quantity);
          item.component_deltas = restored.changes;
          inventory = restored.inventory;
        }
        const currentQuantity = inventoryTotal(product.inventory, product.units);
        const added = cost4(inflows.reduce((sum, item) => sum + item.base_quantity, 0));
        const addedValue = inflows.reduce((sum, item) => sum + item.base_quantity * item.original_unit_cost, 0);
        if (currentQuantity > 1e-9 && (product.cost_price == null || !Number.isFinite(Number(product.cost_price)) || Number(product.cost_price) < 0)) unavailable("متوسط تكلفة المخزون الحالي غير صالح؛ راجع الصنف قبل تسجيل المرتجع.");
        let nextCost;
        try { nextCost = movingAverage(currentQuantity, product.cost_price, added, addedValue); }
        catch { unavailable("تعذر احتساب متوسط تكلفة المرتجع من الرصيد الحالي."); }
        nextProducts.set(productId, { inventory, cost_price: nextCost });
      }
      for (const [seq, item] of items.entries()) {
        const movement = db.collection("inventory_transactions").doc();
        const ids = movementIds.get(item.product_id) || [];
        ids.push(movement.id);
        movementIds.set(item.product_id, ids);
        tx.create(movement, { type: "refund", product_id: item.product_id, product_name: item.product_name,
          quantity: item.base_quantity, unit_quantity: item.quantity, unit_id: item.unit_id, unit_name: item.unit_name,
          unit_factor: item.unit_factor, base_quantity: item.base_quantity, direction: "in",
          return_bucket: item.return_bucket, return_unit_id: item.return_unit_id,
          component_deltas: item.component_deltas,
          unit_cost: item.original_unit_cost, invoice_id: id, return_id: returnRef.id, operation_id: opRef.id,
          note: null, seq, created_by: request.auth.uid, created_at: now });
      }
      for (const [index, productId] of productIds.entries()) {
        const snap = products[index];
        const next = nextProducts.get(productId);
        const ids = movementIds.get(productId);
        tx.update(snap.ref, { inventory: next.inventory, cost_price: next.cost_price,
          last_inventory_transaction_id: ids.at(-1), last_inventory_transaction_ids: ids });
      }
      const merged = { ...stored };
      for (const item of items) merged[item.product_id] = cost4(number(merged[item.product_id]) + item.base_quantity);
      const returnedBase = cost4(Object.values(merged).reduce((sum, value) => sum + number(value), 0));
      const soldBase = cost4((invoice.products || []).reduce((sum, line) => sum + baseQuantity(line), 0));
      const updated = { ...invoice, remaining: money(outstanding(invoice) - debtReduction), returned: merged, credit_restored: money(number(invoice.credit_restored) + creditRestored),
        returned_base_quantity: returnedBase, return_status: returnedBase + 1e-9 >= soldBase ? "full" : "partial" };
      tx.create(returnRef, { invoice_id: id, customer_id: invoice.customer_id || null, items,
        total_refund: totalRefund, debt_reduction: debtReduction, cash_refund: money(cashRefund), credit_issued: creditIssued, credit_restored: creditRestored,
        note: text(request.data?.note, 500) || null, created_by: request.auth.uid, created_at: now });
      tx.update(invoiceRef, { remaining: updated.remaining, returned: merged, returned_base_quantity: returnedBase, return_status: updated.return_status, credit_restored: updated.credit_restored });
      if (creditRef && (creditRestored > 0 || creditIssued > 0)) {
        tx.set(creditRef, { balance: money(number(credit?.data()?.balance) + creditRestored + creditIssued), updated_at: now }, { merge: true });
        tx.create(db.collection("customer_credit_transactions").doc(), { customer_id: invoice.customer_id, invoice_id: id, return_id: returnRef.id, type: "issued", amount: money(creditRestored + creditIssued), created_by: request.auth.uid, created_at: now });
      }
      summary(tx, id, updated);
      const returnedCost = money(items.reduce((sum, item) => sum + item.original_unit_cost * item.base_quantity, 0));
      statsDelta(tx, invoice, updated, { return_count: 1, returns_total: totalRefund, total_profit: -money(totalRefund - returnedCost) });
      if (invoice.customer_id) tx.set(db.doc(`customer_summaries/${invoice.customer_id}`), { total_sales: FieldValue.increment(-totalRefund), outstanding_debt: FieldValue.increment(-debtReduction), updated_at: now }, { merge: true });
      if (cashRefund > 0) {
        tx.update(db.doc("cashbox/current"), { balance: money(number(cash.data().balance) - cashRefund), updated_at: now });
        tx.create(db.collection("cash_transactions").doc(), { type: "invoice_refund", direction: "out", amount: cashRefund,
          invoice_id: id, return_id: returnRef.id, reference_type: "return", reference_id: returnRef.id,
          reference_label: `مرتجع فاتورة ${invoice.customer_name || "عميل"}`, note: text(request.data?.note, 500) || null,
          created_by: request.auth.uid, created_at: now });
      }
      const result = { id: returnRef.id, debtReduction, cashRefund: money(cashRefund), creditIssued, creditRestored };
      tx.create(opRef, { fingerprint, result, created_at: now });
      return result;
    });
  });

  const deleteStaffInvoice = onCall(async (request) => {
    const { bucketDelta, inventoryTotal, normalizeInventory, restoreSaleConsumption } = await inventoryCorePromise;
    const id = text(request.data?.id, 128);
    if (!id) invalid("Select an invoice.");
    const invoiceRef = db.doc(`invoices/${id}`);
    const opRef = operationRef(request, "invoice_cancel");
    return db.runTransaction(async (tx) => {
      const role = await authorize(request, tx);
      const [previous, invoiceSnap, stats, returns, cashHistory] = await Promise.all([
        tx.get(opRef), tx.get(invoiceRef), tx.get(db.doc("store_stats/current")),
        tx.get(db.collection("invoice_returns").where("invoice_id", "==", id)),
        tx.get(db.collection("cash_transactions").where("invoice_id", "==", id)),
      ]);
      if (previous.exists) return previous.data().result;
      if (!invoiceSnap.exists) throw new HttpsError("not-found", "Invoice not found.");
      const invoice = invoiceSnap.data();
      if (invoice.status === "cancelled") unavailable("الفاتورة ملغاة بالفعل ولا يمكن إجراء تسوية عليها.");
      if (role === "cashier" && invoice.created_by !== request.auth.uid) throw new HttpsError("permission-denied", "Cashiers can only cancel their own invoice.");
      if (returns.size || number(invoice.debt_payment_count) > 0 || number(invoice.credit_used) > 0 || number(invoice.credit_restored) > 0) unavailable("لا يمكن إلغاء فاتورة لها مرتجعات أو تسويات دين أو رصيد عميل.");
      const saleCash = cashHistory.docs.filter((movement) => movement.data().type === "invoice_sale");
      if (cashHistory.docs.some((movement) => !["invoice_sale", "invoice_edit_adjustment"].includes(movement.data().type))
        || saleCash.length > 1 || cashHistory.size > 20) unavailable("لا يمكن إلغاء فاتورة لها تسويات مالية إضافية.");
      const cashNet = money(cashHistory.docs.reduce((sum, movement) => sum + (movement.data().direction === "in" ? 1 : -1) * number(movement.data().amount), 0));
      if (Math.abs(cashNet - number(invoice.paid_amount)) > 0.005) unavailable("سجل قبض الفاتورة غير مكتمل؛ راجع المسؤول.");
      if (invoice.inventory_applied !== true) unavailable("لا يمكن إلغاء فاتورة لم يثبت تطبيق أثرها المخزني.");
      const productIds = [...new Set((invoice.products || []).map((line) => line.product_id).filter(Boolean))];
      if (!productIds.length) unavailable("الفاتورة لا تحتوي على أصناف مخزنية قابلة للعكس.");
      const summaryId = customerSummaryKey(invoice);
      const [cashbox, customerSummary, ...productSnaps] = await Promise.all([
        cashNet > 0 ? tx.get(db.doc("cashbox/current")) : Promise.resolve(null),
        summaryId ? tx.get(db.doc(`customer_summaries/${summaryId}`)) : Promise.resolve(null),
        ...productIds.map((productId) => tx.get(db.doc(`products/${productId}`))),
      ]);
      if (productSnaps.some((product) => !product.exists)) unavailable("أحد أصناف الفاتورة لم يعد موجودًا؛ لا يمكن إلغاء حركتها.");
      const productById = new Map(productSnaps.map((snapshot) => [snapshot.id, snapshot]));
      if (cashNet > 0 && (!cashbox?.exists || number(cashbox.data().balance) + 0.005 < cashNet)) unavailable("رصيد الخزنة لا يكفي لعكس المبلغ المقبوض. سجّل مرتجعًا نقديًا بعد مراجعة الخزنة.");
      const nextProducts = new Map();
      for (const productId of productIds) {
        const productSnap = productById.get(productId);
        const product = productSnap.data();
        const currentInventory = normalizeInventory(product.inventory);
        let inventory = currentInventory;
        const lines = (invoice.products || []).filter((line) => line.product_id === productId);
        for (const line of [...lines].reverse()) {
          let restored;
          try { restored = restoreSaleConsumption(inventory, product, line); }
          catch { unavailable("تعذر رد مكونات البيع دون إعادة تغليف كمية مفتوحة."); }
          inventory = restored.inventory;
        }
        const quantity = cost4(lines.reduce((sum, line) => sum + baseQuantity(line), 0));
        const value = lines.reduce((sum, line) => sum + costGroups(line).reduce((subtotal, group) => subtotal + group.base_quantity * group.unit_cost, 0), 0);
        const oldQuantity = inventoryTotal(product.inventory, product.units);
        const newQuantity = inventoryTotal(inventory, product.units);
        const oldCost = product.cost_price == null ? null : Number(product.cost_price);
        if (oldQuantity > 1e-9 && (oldCost === null || !Number.isFinite(oldCost) || oldCost < 0)) unavailable("متوسط التكلفة غير صالح لإلغاء الفاتورة.");
        if (oldCost !== null && (!Number.isFinite(oldCost) || oldCost < 0)) unavailable("متوسط التكلفة غير صالح لإلغاء الفاتورة.");
        const nextValue = oldQuantity * Number(oldCost ?? 0) + value;
        const nextCost = newQuantity <= 1e-9 ? oldCost : nextValue / newQuantity;
        const netChanges = bucketDelta(currentInventory, inventory);
        nextProducts.set(productId, { inventory, changes: netChanges, product, nextCost, quantity, value, lines });
      }
      for (const [productId, next] of nextProducts) {
        const ids = [];
        for (const [seq, line] of [...next.lines].reverse().entries()) {
          const groups = costGroups(line);
          const quantity = cost4(groups.reduce((sum, group) => sum + group.base_quantity, 0));
          const value = groups.reduce((sum, group) => sum + group.base_quantity * group.unit_cost, 0);
          const restored = restoreSaleConsumption(normalizeInventory(next.product.inventory), next.product, line);
          const reverseRef = db.collection("inventory_transactions").doc();
          ids.push(reverseRef.id);
          tx.create(reverseRef, { type: "sale", product_id: productId, product_name: line.product_name || next.product.name,
            quantity, unit_quantity: line.product_quantity, unit_id: line.unit_id, unit_name: line.unit_name,
            unit_factor: line.unit_factor, base_quantity: quantity, direction: "in", unit_cost: quantity > 0 ? value / quantity : next.product.cost_price,
            invoice_id: id, operation_id: opRef.id, reason: "invoice_cancel", reverses_invoice_id: id,
            component_deltas: restored.changes, opened_packages: [], note: text(request.data?.note, 500) || "إلغاء فاتورة بيع",
            seq, created_by: request.auth.uid, created_at: FieldValue.serverTimestamp() });
        }
        tx.update(productById.get(productId).ref, { inventory: next.inventory, cost_price: next.nextCost,
          last_inventory_transaction_id: ids.at(-1), last_inventory_transaction_ids: ids,
          updated_at: FieldValue.serverTimestamp() });
      }
      if (cashNet > 0) {
        const amount = cashNet;
        const now = FieldValue.serverTimestamp();
        tx.update(db.doc("cashbox/current"), { balance: money(number(cashbox.data().balance) - amount), updated_at: now });
        tx.create(db.collection("cash_transactions").doc(), { type: "invoice_cancel", direction: "out", amount,
          invoice_id: id, reference_type: "invoice", reference_id: id, reference_label: `إلغاء فاتورة ${invoice.customer_name || "عميل"}`,
          note: text(request.data?.note, 500) || null, created_by: request.auth.uid, created_at: now });
      }
      const updated = { ...invoice, status: "cancelled", remaining: 0, cancelled_at: FieldValue.serverTimestamp(),
        cancelled_by: request.auth.uid, cancel_note: text(request.data?.note, 500) || null };
      tx.update(invoiceRef, updated);
      tx.set(db.doc(`invoice_debt_summaries/${id}`), { status: "cancelled", remaining: 0, total: 0, sales: 0, paid: 0, profit: 0, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      if (stats.exists && stats.data().initialized === true) statsDelta(tx, invoice, null);
      if (customerSummary?.exists) {
        const metrics = invoiceMetrics(invoice);
        tx.set(db.doc(`customer_summaries/${summaryId}`), {
          invoice_count: FieldValue.increment(-1), total_sales: FieldValue.increment(-metrics.total_sales),
          outstanding_debt: FieldValue.increment(-metrics.outstanding_customer_debt), updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      const result = { cancelled: true };
      tx.create(opRef, { result, created_at: FieldValue.serverTimestamp() });
      return result;
    });
  });

  const createStaffSupplierReturn = onCall(async (request) => {
    const { baseQuantityFor, normalizeInventory, removeInventory } = await inventoryCorePromise;
    const id = text(request.data?.id, 128);
    const invoiceId = text(request.data?.invoice_id, 128);
    const requested = request.data?.items;
    if (!id || !invoiceId || !Array.isArray(requested) || !requested.length || requested.length > 50) invalid("حدد أصناف المرتجع.");
    const opRef = operationRef(request, "supplier_return");
    const returnRef = db.doc(`supplier_returns/${id}`);
    const invoiceRef = db.doc(`purchase_invoices/${invoiceId}`);
    const requestedItems = requested.map((item) => ({
      line_index: Number(item?.line_index),
      quantity: Number(item?.quantity),
      return_bucket: item?.return_bucket,
      return_unit_id: text(item?.return_unit_id, 64) || null,
    }));
    const fingerprint = JSON.stringify({ invoice_id: invoiceId, items: requestedItems, supplier_id: text(request.data?.supplier_id, 128) || null, note: text(request.data?.note, 500) || null });
    return db.runTransaction(async (tx) => {
      const role = await authorize(request, tx);
      if (role !== "admin") throw new HttpsError("permission-denied", "Admin access is required.");
      const [previous, savedReturn, invoiceSnap] = await Promise.all([tx.get(opRef), tx.get(returnRef), tx.get(invoiceRef)]);
      if (previous.exists) {
        if (previous.data().fingerprint !== fingerprint) unavailable("مفتاح المرتجع مستخدم لعملية أخرى.");
        return previous.data().result;
      }
      if (savedReturn.exists) {
        if (savedReturn.data().request_fingerprint !== fingerprint) unavailable("معرّف المرتجع مستخدم لبيانات أخرى.");
        const saved = savedReturn.data();
        return { ok: true, total: saved.total_return, payableReduction: saved.payable_reduction, receivable: saved.receivable_amount, duplicate: true };
      }
      if (!invoiceSnap.exists) throw new HttpsError("not-found", "Purchase invoice not found.");
      const invoice = invoiceSnap.data();
      const returned = { ...(invoice.returned_quantities || {}) };
      const seen = new Set();
      const prepared = requestedItems.map((selection) => {
        const index = selection.line_index;
        const quantity = selection.quantity;
        const line = invoice.items?.[index];
        if (!Number.isInteger(index) || seen.has(index) || !line?.product_id || !Number.isFinite(quantity) || quantity <= 0 || Math.abs(quantity - cost4(quantity)) > 1e-9) invalid("كميات المرتجع غير صالحة.");
        seen.add(index);
        const remaining = number(line.quantity) - number(returned[String(index)]);
        if (quantity - remaining > 1e-9) invalid("كمية المرتجع تتجاوز المتاح في الفاتورة.");
        const factor = Number(line.unit_factor);
        if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - cost4(factor)) > 1e-9) invalid("معامل الوحدة المسجل في الفاتورة غير صالح.");
        if (line.allows_fractional !== true && !Number.isInteger(quantity)) invalid("هذه الوحدة لا تقبل كميات كسرية.");
        if (selection.return_bucket !== "loose" && selection.return_bucket !== "package") invalid("حدد هل المرتجع كمية مفتوحة أم عبوة مغلقة.");
        let base;
        try { base = baseQuantityFor(quantity, factor); }
        catch { invalid("الكمية بعد التحويل يجب أن تكون موجبة وقابلة للتمثيل حتى أربع منازل عشرية."); }
        returned[String(index)] = cost4(number(returned[String(index)]) + quantity);
        return { ...selection, line, base_quantity: base, unit_cost: number(line.unit_cost), amount: money(quantity * number(line.unit_cost)) };
      });
      const productIds = [...new Set(prepared.map((item) => item.line.product_id))];
      const [supplier, supplierSummary, ...products] = await Promise.all([
        text(invoice.supplier_id || request.data?.supplier_id, 128) ? tx.get(db.doc(`suppliers/${text(invoice.supplier_id || request.data?.supplier_id, 128)}`)) : Promise.resolve(null),
        text(invoice.supplier_id || request.data?.supplier_id, 128) ? tx.get(db.doc(`supplier_summaries/${text(invoice.supplier_id || request.data?.supplier_id, 128)}`)) : Promise.resolve(null),
        ...productIds.map((productId) => tx.get(db.doc(`products/${productId}`))),
      ]);
      if (products.some((product) => !product.exists)) unavailable("أحد الأصناف لم يعد موجودًا.");
      if (supplier && !supplier.exists) unavailable("المورد المحدد غير موجود.");
      const supplierId = text(invoice.supplier_id || request.data?.supplier_id, 128) || null;
      if (invoice.supplier_id && request.data?.supplier_id && invoice.supplier_id !== request.data.supplier_id) invalid("المورد لا يطابق الفاتورة.");
      const productById = new Map(products.map((snapshot) => [snapshot.id, snapshot]));
      const updatedProducts = new Map();
      for (const item of prepared) {
        const snapshot = productById.get(item.line.product_id);
        const product = snapshot.data();
        if (product.inventory_mode === "independent" && item.return_bucket === "loose" && !Number.isInteger(item.base_quantity)) invalid("مرتجع العبوات المستقلة يجب أن يكون عددًا صحيحًا من العبوات الكاملة.");
        if (product.cost_price == null || !Number.isFinite(Number(product.cost_price)) || Number(product.cost_price) < 0) unavailable("متوسط تكلفة المخزون غير معروف لهذا الصنف.");
        const current = updatedProducts.get(item.line.product_id) || { inventory: normalizeInventory(product.inventory), product };
        const physicalUnit = item.return_bucket === "package"
          ? product.units?.find((unit) => unit.id === item.return_unit_id && unit.stock_kind === "package")
          : product.units?.find((unit) => unit.id === product.base_unit_id && unit.stock_kind === "loose");
        if (!physicalUnit) invalid("العبوة المختارة غير موجودة لهذا الصنف.");
        let removed;
        try {
          removed = removeInventory(current.inventory, product, item.return_bucket, item.return_bucket === "package" ? physicalUnit.id : product.base_unit_id, item.base_quantity);
        } catch (error) {
          if (error.message === "STOCK_INSUFFICIENT") unavailable("الرصيد الفعلي للمكوّن المحدد لا يكفي للمرتجع.");
          if (error.message === "RETURN_NOT_WHOLE_PACKAGE") invalid("كمية المرتجع لا تساوي عددًا صحيحًا من العبوات المغلقة.");
          throw error;
        }
        current.inventory = removed.inventory;
        item.component_deltas = removed.changes;
        item.physical_unit = physicalUnit;
        item.inventory_unit_cost = Number(product.cost_price);
        item.inventory_amount = money(item.base_quantity * Number(product.cost_price));
        item.cost_variance = money(item.amount - item.inventory_amount);
        updatedProducts.set(item.line.product_id, current);
      }
      const total = money(prepared.reduce((sum, item) => sum + item.amount, 0));
      const inventoryAmount = money(prepared.reduce((sum, item) => sum + item.inventory_amount, 0));
      const costVariance = money(total - inventoryAmount);
      const payableReduction = money(Math.min(total, Math.max(0, number(invoice.remaining_amount))));
      const receivable = money(total - payableReduction);
      if (receivable > 0 && !supplierId) unavailable("اختر المورد لتسجيل الرصيد المستحق لنا.");
      const now = FieldValue.serverTimestamp();
      const movementIds = new Map();
      for (const [seq, item] of prepared.entries()) {
        const movement = db.collection("inventory_transactions").doc();
        movementIds.set(item.line.product_id, [...(movementIds.get(item.line.product_id) || []), movement.id]);
        const physicalFactor = item.return_bucket === "package" ? Number(item.physical_unit.factor) : 1;
        tx.create(movement, { type: "supplier_return", direction: "out", product_id: item.line.product_id,
          product_name: item.line.product_name, quantity: item.base_quantity,
          unit_quantity: item.return_bucket === "package" ? item.base_quantity / physicalFactor : item.base_quantity,
          unit_id: item.physical_unit.id, unit_name: item.physical_unit.name, unit_factor: physicalFactor,
          base_quantity: item.base_quantity, unit_cost: item.inventory_unit_cost,
          purchase_invoice_id: invoiceId, return_id: id, return_bucket: item.return_bucket,
          return_unit_id: item.return_bucket === "package" ? item.physical_unit.id : null,
          component_deltas: item.component_deltas, operation_id: opRef.id, seq, created_by: request.auth.uid, created_at: now });
      }
      for (const [productId, next] of updatedProducts) {
        const ids = movementIds.get(productId) || [];
        tx.update(productById.get(productId).ref, { inventory: next.inventory,
          last_inventory_transaction_id: ids.at(-1), last_inventory_transaction_ids: ids, updated_at: now });
      }
      const newTotal = money(number(invoice.return_total) + total);
      const returnedBase = cost4((invoice.items || []).reduce((sum, item, index) => sum + number(returned[String(index)]) * number(item.unit_factor), 0));
      const soldBase = cost4((invoice.items || []).reduce((sum, item) => sum + number(item.base_quantity), 0));
      const remainingAmount = money(Math.max(0, number(invoice.remaining_amount) - payableReduction));
      tx.update(invoiceRef, { supplier_id: supplierId, returned_quantities: returned, return_total: newTotal,
        return_status: returnedBase + 1e-9 >= soldBase ? "full" : "partial", remaining_amount: remainingAmount,
        status: remainingAmount <= 0 ? "paid" : number(invoice.paid_amount) > 0 ? "partial" : "unpaid" });
      const supplierName = String(supplier?.data()?.name || invoice.supplier_name || "مورد");
      const returnItems = prepared.map((item) => ({ line_index: item.line_index, product_id: item.line.product_id,
        product_name: item.line.product_name, quantity: item.quantity, unit_name: item.line.unit_name || null,
        unit_factor: Number(item.line.unit_factor), base_quantity: item.base_quantity,
        unit_cost: item.unit_cost, amount: item.amount, inventory_unit_cost: item.inventory_unit_cost,
        inventory_amount: item.inventory_amount, cost_variance: item.cost_variance,
        return_bucket: item.return_bucket, return_unit_id: item.return_bucket === "package" ? item.physical_unit.id : null,
        return_unit_name: item.physical_unit.name, component_deltas: item.component_deltas }));
      tx.create(returnRef, { purchase_invoice_id: invoiceId, supplier_id: supplierId, supplier_name: supplierName,
        items: returnItems, total_return: total, inventory_amount: inventoryAmount, cost_variance: costVariance,
        payable_reduction: payableReduction, receivable_amount: receivable, request_fingerprint: fingerprint,
        note: text(request.data?.note, 500) || null, created_by: request.auth.uid, created_at: now });
      if (receivable > 0 && supplierId) tx.set(db.doc(`supplier_advances/${id}`), { supplier_id: supplierId,
        supplier_name: supplierName, purchase_invoice_id: invoiceId, source_return_id: id, amount: receivable,
        remaining_amount: receivable, created_by: request.auth.uid, created_at: now });
      if (supplierId) {
        const baseline = !invoice.supplier_id || !supplierSummary?.exists ? {
          invoice_count: 1, total_purchases: money(number(invoice.total_amount) - number(invoice.return_total)),
          outstanding_payable: number(invoice.remaining_amount), advance_receivable: number(invoice.advance_amount),
        } : null;
        const changes = { supplier_id: supplierId, supplier_name: supplierName, updated_at: now };
        const delta = { invoice_count: baseline?.invoice_count, total_purchases: money((baseline?.total_purchases || 0) - total),
          outstanding_payable: money((baseline?.outstanding_payable || 0) - payableReduction),
          advance_receivable: money((baseline?.advance_receivable || 0) + receivable), return_cost_variance: costVariance };
        for (const [key, value] of Object.entries(delta)) if (value !== undefined && value !== 0) changes[key] = FieldValue.increment(value);
        tx.set(db.doc(`supplier_summaries/${supplierId}`), changes, { merge: true });
      }
      const result = { ok: true, total, payableReduction, receivable };
      tx.create(opRef, { fingerprint, result, created_at: now });
      return result;
    });
  });

  return { updateStaffInvoice, getStaffReturnPreview, createStaffReturn, createStaffSupplierReturn, deleteStaffInvoice };
};
