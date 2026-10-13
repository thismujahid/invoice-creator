const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const { saleAmounts, invoiceRevision, splitCustomerReturn } = require("./staffMath.cjs");

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
  return cost4(Number.isFinite(saved) && saved >= 0 ? saved : number(line.product_quantity) * (number(line.unit_factor) > 0 ? number(line.unit_factor) : 1));
};
const costGroups = (line) => Array.isArray(line.cost_groups) && line.cost_groups.length
  ? line.cost_groups.map((group) => ({ base_quantity: cost4(group.base_quantity), unit_cost: cost4(group.unit_cost) })).filter((group) => group.base_quantity > 0)
  : [{ base_quantity: baseQuantity(line), unit_cost: cost4(line.base_cost_snapshot ?? line.product_cost_price) }].filter((group) => group.base_quantity > 0);
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
  const groupRows = (invoice, returns) => {
    const returned = new Map();
    for (const record of returns) for (const item of record.items || []) {
      if (!Number.isInteger(item.source_line_index) || !Number.isInteger(item.source_cost_group_index)) unavailable("سجل المرتجع القديم يحتاج مراجعة المسؤول قبل مرتجع جديد.");
      const key = `${item.source_line_index}:${item.source_cost_group_index}`;
      returned.set(key, cost4(number(returned.get(key)) + number(item.quantity)));
    }
    const rows = [];
    for (const [lineIndex, line] of (invoice.products || []).entries()) {
      if (!line.product_id) continue;
      const factor = number(line.unit_factor) > 0 ? number(line.unit_factor) : 1;
      for (const [groupIndex, group] of costGroups(line).entries()) {
        const key = `${lineIndex}:${groupIndex}`;
        const sold = cost4(group.base_quantity / factor);
        const already = number(returned.get(key));
        if (already - sold > 1e-9) unavailable("سجل المرتجع لا يطابق الفاتورة.");
        rows.push({ key, product_id: line.product_id, product_name: line.product_name,
          unit_id: line.unit_id ?? null, unit_name: line.unit_name || "وحدة", unit_factor: factor,
          unit_price: number(line.product_price), unit_cost: group.unit_cost,
          soldQty: sold, returnedQty: already, maxQty: Math.max(0, cost4(sold - already)), lineIndex, groupIndex });
      }
    }
    return rows;
  };

  const updateStaffInvoice = onCall(async (request) => {
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
      await authorize(request, tx);
      const oldSnaps = await Promise.all([tx.get(opRef), tx.get(invoiceRef),
        ...returns.docs.map((doc) => tx.get(doc.ref)), ...cashHistory.docs.map((doc) => tx.get(doc.ref)),
        ...relatedPayments.map((doc) => tx.get(doc.ref))]);
      if (oldSnaps[0].exists) return oldSnaps[0].data().result;
      const saved = oldSnaps[1];
      if (!saved.exists) throw new HttpsError("not-found", "Invoice not found.");
      const original = saved.data();
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
      const unitKey = (productId, unitId) => `${productId}||${unitId}`;
      const usedOld = new Set();
      const restores = [];
      const takes = new Map();
      const lines = requested.map((entry, index) => {
        const productId = text(entry?.product_id, 128);
        const productSnap = products.get(productId);
        const product = productSnap?.data();
        const quantity = entry?.product_quantity;
        if (!product || product.is_active === false || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) invalid("Invalid invoice product or quantity.");
        const unitId = text(entry?.unit_id, 128) || product.base_unit_id || "legacy-base";
        const configured = Array.isArray(product.units) && product.units.length ? product.units
          : [{ id: product.base_unit_id || "legacy-base", name: product.base_unit_name || "وحدة", factor: 1, selling_price: product.price, is_base: true }];
        const unit = configured.find((item) => item.id === unitId && item.can_sell !== false && number(item.selling_price) > 0);
        if (!unit) invalid("Selling unit is unavailable.");
        if (unit.allows_fractional !== true && !Number.isInteger(quantity)) invalid("This unit does not allow fractional quantities.");
        const factor = 1;
        if (Math.abs(quantity - cost4(quantity)) > 1e-9) invalid("Quantity supports at most four decimal places.");
        const base = cost4(quantity);
        if (base <= 0) invalid("Quantity is too small.");
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
        const sameUnit = oldLine && oldLine.unit_id === unit.id;
        const oldBase = sameUnit ? baseQuantity(oldLine) : 0;
        const oldGroups = sameUnit ? costGroups(oldLine) : [];
        if (oldLine && !sameUnit) for (const group of costGroups(oldLine)) restores.push({ product_id: productId, product_name: oldLine.product_name, unit_id: oldLine.unit_id, unit_name: oldLine.unit_name, qty: group.base_quantity, unit_cost: group.unit_cost });
        let keep = base;
        const groups = [];
        for (const group of oldGroups) {
          const retained = cost4(Math.min(keep, group.base_quantity));
          if (retained > 0) groups.push({ base_quantity: retained, unit_cost: group.unit_cost });
          const restored = cost4(group.base_quantity - retained);
          if (restored > 0) restores.push({ product_id: productId, product_name: oldLine.product_name, unit_id: unit.id, unit_name: unit.name, qty: restored, unit_cost: group.unit_cost });
          keep = cost4(keep - retained);
        }
        const currentCost = cost4(unit.average_cost ?? product.cost_price);
        if (keep > 0) groups.push({ base_quantity: keep, unit_cost: currentCost });
        const added = Math.max(0, cost4(base - oldBase));
        if (added) {
          const key = unitKey(productId, unit.id);
          takes.set(key, cost4(number(takes.get(key)) + added));
        }
        const average = cost4(groups.reduce((sum, group) => sum + group.base_quantity * group.unit_cost, 0) / base);
        return { line_id: oldLine?.line_id || `${id}-edit-${index}`, product_id: productId, product_name: product.name,
          product_quantity: quantity, product_price: price, unit_id: unit.id, unit_name: unit.name,
          unit_factor: 1, base_quantity: base, product_cost_price: average, base_cost_snapshot: average,
          cost_groups: groups, option: text(entry?.option, 120) || null, total: money(quantity * price) };
      });
      for (const [index, oldLine] of oldLines.entries()) if (!usedOld.has(index) && oldLine.product_id) {
        for (const group of costGroups(oldLine)) restores.push({ product_id: oldLine.product_id, product_name: oldLine.product_name, unit_id: oldLine.unit_id, unit_name: oldLine.unit_name, qty: group.base_quantity, unit_cost: group.unit_cost });
      }
      restores.reverse();
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
      const affected = [...new Set([...productIds, ...restores.map((item) => item.product_id)])];
      for (const productId of affected) {
        const snap = products.get(productId) || await tx.get(db.doc(`products/${productId}`));
        if (!snap?.exists) unavailable("أحد منتجات الفاتورة لم يعد موجودًا.");
        products.set(productId, snap);
        const units = Array.isArray(snap.data().units) ? snap.data().units : [];
        for (const [key, take] of takes) {
          const [pid, unitId] = key.split("||");
          if (pid !== productId) continue;
          const unit = units.find((item) => item.id === unitId);
          const restored = restores.filter((item) => item.product_id === productId && item.unit_id === unitId).reduce((sum, item) => sum + item.qty, 0);
          if (!unit || number(take) - number(unit.stock_quantity) - restored > 1e-9) unavailable("كمية الوحدة تتجاوز المخزون المتاح.");
        }
      }
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
      let seq = 0;
      for (const group of restores) {
        const movement = db.collection("inventory_transactions").doc();
        const ids = movementIds.get(group.product_id) || [];
        ids.push(movement.id);
        movementIds.set(group.product_id, ids);
        tx.create(movement, { type: "sale", product_id: group.product_id, product_name: group.product_name,
          quantity: group.qty, unit_quantity: group.qty, unit_id: group.unit_id || null, unit_name: group.unit_name || "وحدة", unit_factor: 1, base_quantity: group.qty,
          direction: "in", unit_cost: group.unit_cost, invoice_id: id, reason: "invoice_edit",
          note: "تعديل فاتورة", seq: seq++, created_by: request.auth.uid, created_at: now });
      }
      for (const [key, quantity] of takes) {
        const [productId, unitId] = key.split("||");
        const unit = (products.get(productId).data().units || []).find((item) => item.id === unitId);
        const movement = db.collection("inventory_transactions").doc();
        const ids = movementIds.get(productId) || [];
        ids.push(movement.id);
        movementIds.set(productId, ids);
        tx.create(movement, { type: "sale", product_id: productId, product_name: products.get(productId).data().name,
          quantity, unit_quantity: quantity, unit_id: unitId, unit_name: unit?.name || "وحدة", unit_factor: 1, base_quantity: quantity,
          direction: "out", unit_cost: cost4(unit?.average_cost ?? products.get(productId).data().cost_price), invoice_id: id,
          reason: "invoice_edit", note: "تعديل فاتورة", seq: seq++, created_by: request.auth.uid, created_at: now });
      }
      for (const productId of affected) {
        const snap = products.get(productId);
        const nextUnits = (snap.data().units || []).map((unit) => {
          const key = unitKey(productId, unit.id);
          const take = number(takes.get(key));
          const inflows = restores.filter((item) => item.product_id === productId && item.unit_id === unit.id);
          const start = cost4(number(unit.stock_quantity) - take);
          const added = cost4(inflows.reduce((sum, item) => sum + item.qty, 0));
          const value = inflows.reduce((sum, item) => sum + item.qty * item.unit_cost, 0);
          if (!take && !added) return unit;
          return { ...unit, stock_quantity: cost4(start + added), average_cost: added > 0 ? cost4(start > 0 ? (start * number(unit.average_cost) + value) / (start + added) : value / added) : unit.average_cost };
        });
        const patch = { units: nextUnits };
        const ids = movementIds.get(productId);
        if (ids?.length) { patch.last_inventory_transaction_id = ids.at(-1); patch.last_inventory_transaction_ids = ids; }
        tx.update(snap.ref, patch);
      }
      if (paidDelta) {
        tx.update(db.doc("cashbox/current"), { balance: money(number(cash.data().balance) + paidDelta), updated_at: now });
        tx.create(db.collection("cash_transactions").doc(), { type: "invoice_edit_adjustment", direction: paidDelta > 0 ? "in" : "out",
          amount: Math.abs(paidDelta), invoice_id: id, reference_type: "invoice", reference_id: id,
          reference_label: `فاتورة بيع لـ ${customer.data().name}`, note: "فرق تعديل فاتورة",
          created_by: request.auth.uid, created_at: now });
      }
      const result = { id, receipt: { ...updated, id, edit_revision: invoiceRevision(updated) } };
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
    const returns = await db.collection("invoice_returns").where("invoice_id", "==", id).get();
    const rows = groupRows(invoice.data(), returns.docs.map((doc) => doc.data()));
    const totals = invoiceTotal(invoice.data());
    const ratio = totals.gross > 0 ? totals.net / totals.gross : 1;
    const credit = invoice.data().customer_id ? await db.doc(`customer_credits/${invoice.data().customer_id}`).get() : null;
    return { remaining: outstanding(invoice.data()), ratio, creditUsed: number(invoice.data().credit_used), creditRestored: number(invoice.data().credit_restored), creditBalance: number(credit?.data()?.balance), rows: rows.map(({ unit_cost, lineIndex, groupIndex, ...row }) => row) };
  });

  const createStaffReturn = onCall(async (request) => {
    const id = text(request.data?.id, 128);
    const wanted = request.data?.items;
    if (!id || !Array.isArray(wanted) || !wanted.length || wanted.length > 50) invalid("Select return items.");
    const opRef = operationRef(request, "return");
    const returnRef = db.collection("invoice_returns").doc();
    const prior = await db.collection("invoice_returns").where("invoice_id", "==", id).get();
    return db.runTransaction(async (tx) => {
      await authorize(request, tx);
      const invoiceRef = db.doc(`invoices/${id}`);
      const [previous, invoiceSnap, ...returnSnaps] = await Promise.all([tx.get(opRef), tx.get(invoiceRef), ...prior.docs.map((doc) => tx.get(doc.ref))]);
      if (previous.exists) return previous.data().result;
      if (!invoiceSnap.exists) throw new HttpsError("not-found", "Invoice not found.");
      if (returnSnaps.some((doc) => !doc.exists)) unavailable("تغير سجل المرتجعات. أعد فتح الفاتورة.");
      const invoice = invoiceSnap.data();
      const previousReturns = returnSnaps.map((doc) => doc.data());
      const rows = new Map(groupRows(invoice, previousReturns).map((row) => [row.key, row]));
      const stored = invoice.returned || {};
      const counted = {};
      for (const record of previousReturns) for (const item of record.items || []) counted[item.product_id] = cost4(number(counted[item.product_id]) + number(item.base_quantity));
      for (const productId of new Set([...Object.keys(stored), ...Object.keys(counted)])) if (Math.abs(number(stored[productId]) - number(counted[productId])) > 1e-9) unavailable("تغير سجل المرتجعات. أعد فتح الفاتورة.");
      const seen = new Set();
      const totals = invoiceTotal(invoice);
      const ratio = totals.gross > 0 ? totals.net / totals.gross : 1;
      const items = [];
      for (const requested of wanted) {
        const key = text(requested?.rowKey, 40);
        const row = rows.get(key);
        const quantity = requested?.quantity;
        if (!row || seen.has(key) || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || Math.abs(quantity - cost4(quantity)) > 1e-9 || quantity - row.maxQty > 1e-9) invalid("Return quantity exceeds the available quantity.");
        seen.add(key);
        items.push({ product_id: row.product_id, product_name: row.product_name, quantity: cost4(quantity),
          unit_id: row.unit_id, unit_name: row.unit_name, unit_factor: 1,
          base_quantity: cost4(quantity), original_unit_price: row.unit_price,
          original_unit_cost: row.unit_cost, source_line_index: row.lineIndex,
          source_cost_group_index: row.groupIndex, refund_amount: money(row.unit_price * quantity * ratio) });
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
      for (const [seq, item] of items.entries()) {
        const movement = db.collection("inventory_transactions").doc();
        const ids = movementIds.get(item.product_id) || [];
        ids.push(movement.id);
        movementIds.set(item.product_id, ids);
        tx.create(movement, { type: "refund", product_id: item.product_id, product_name: item.product_name,
          quantity: item.quantity, unit_quantity: item.quantity, unit_id: item.unit_id, unit_name: item.unit_name,
          unit_factor: 1, base_quantity: item.quantity, direction: "in",
          unit_cost: item.original_unit_cost, invoice_id: id, return_id: returnRef.id,
          note: null, seq, created_by: request.auth.uid, created_at: now });
      }
      for (const [index, productId] of productIds.entries()) {
        const product = products[index].data();
        const nextUnits = (product.units || []).map((unit) => {
          const inflows = items.filter((item) => item.product_id === productId && item.unit_id === unit.id);
          if (!inflows.length) return unit;
          const oldStock = number(unit.stock_quantity);
          const added = cost4(inflows.reduce((sum, item) => sum + item.quantity, 0));
          const value = inflows.reduce((sum, item) => sum + item.quantity * item.original_unit_cost, 0);
          return { ...unit, stock_quantity: cost4(oldStock + added), average_cost: cost4(oldStock > 0 ? (oldStock * number(unit.average_cost) + value) / (oldStock + added) : value / added) };
        });
        const ids = movementIds.get(productId);
        tx.update(products[index].ref, { units: nextUnits,
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
      tx.create(opRef, { result, created_at: now });
      return result;
    });
  });

  const deleteStaffInvoice = onCall(async (request) => {
    const id = text(request.data?.id, 128);
    if (!id) invalid("Select an invoice.");
    const invoiceRef = db.doc(`invoices/${id}`);
    const [returns, cash, movements] = await Promise.all([
      db.collection("invoice_returns").where("invoice_id", "==", id).limit(1).get(),
      db.collection("cash_transactions").where("invoice_id", "==", id).limit(1).get(),
      db.collection("inventory_transactions").where("invoice_id", "==", id).limit(1).get(),
    ]);
    if (!returns.empty || !cash.empty || !movements.empty) unavailable("لا يمكن حذف فاتورة لها حركات مخزنية أو نقدية — استخدم المرتجع.");
    return db.runTransaction(async (tx) => {
      await authorize(request, tx);
      const [invoiceSnap, stats] = await Promise.all([tx.get(invoiceRef), tx.get(db.doc("store_stats/current"))]);
      if (!invoiceSnap.exists) throw new HttpsError("not-found", "Invoice not found.");
      const invoice = invoiceSnap.data();
      if (invoice.inventory_applied === true || invoice.cashbox_applied === true) unavailable("لا يمكن حذف فاتورة لها حركات مخزنية أو نقدية — استخدم المرتجع.");
      tx.delete(invoiceRef);
      tx.delete(db.doc(`invoice_debt_summaries/${id}`));
      if (stats.exists && stats.data().initialized === true) statsDelta(tx, invoice, null);
      const summaryId = customerSummaryKey(invoice);
      if (summaryId) {
        const metrics = invoiceMetrics(invoice);
        tx.set(db.doc(`customer_summaries/${summaryId}`), {
          invoice_count: FieldValue.increment(-1), total_sales: FieldValue.increment(-metrics.total_sales),
          outstanding_debt: FieldValue.increment(-metrics.outstanding_customer_debt),
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return { deleted: true };
    });
  });

  return { updateStaffInvoice, getStaffReturnPreview, createStaffReturn, deleteStaffInvoice };
};
