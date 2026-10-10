const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { safeProduct, saleAmounts } = require("./staffMath.cjs");

const db = getFirestore();
const adminEmail = "mohamed.mojahead@gmail.com";
const fixedCashier = { uid: "q1EgNKKwcvgeuf57TD49rqLbqlL2", email: "saleh2025mujahid@gmail.com" };
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const cost4 = (value) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
const validNumber = (value, min = 0) => typeof value === "number" && Number.isFinite(value) && value >= min;
const cleanText = (value, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const fail = (message) => { throw new HttpsError("invalid-argument", message); };
function operationRef(request, kind) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const id = request.data?.requestId;
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(id)) fail("Invalid operation key.");
  return db.doc(`operation_requests/${request.auth.uid}_${kind}_${id}`);
}
const asDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return { day: `${year}-${month}-${String(date.getDate()).padStart(2, "0")}`, month: `${year}-${month}` };
};
const statusOf = (paid, remaining) => remaining <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";

async function roleOf(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (request.auth.token.email === adminEmail) return "admin";
  const data = (await db.doc(`staff_users/${request.auth.uid}`).get()).data();
  if (request.auth.uid === fixedCashier.uid && request.auth.token.email === fixedCashier.email && (!data || (data.active === true && data.email === fixedCashier.email))) return "cashier";
  if (data?.role === "cashier" && data.active === true && data.email === request.auth.token.email) return "cashier";
  throw new HttpsError("permission-denied", "This account is not authorized.");
}

async function authorize(request, tx) {
  const role = await roleOf(request);
  const reset = await tx.get(db.doc("system_jobs/factory_reset"));
  if (reset.data()?.status === "running") throw new HttpsError("failed-precondition", "System reset is running.");
  if (role === "cashier") {
    const staff = await tx.get(db.doc(`staff_users/${request.auth.uid}`));
    const isFixedCashier = request.auth.uid === fixedCashier.uid && request.auth.token.email === fixedCashier.email;
    if ((staff.exists && (staff.data()?.active !== true || staff.data()?.email !== request.auth.token.email)) || (!staff.exists && !isFixedCashier)) {
      throw new HttpsError("permission-denied", "Cashier access was revoked.");
    }
  }
  return role;
}

exports.getCashierCustomers = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const snapshot = await db.collection("customers").get();
  return { items: snapshot.docs.map((doc) => ({ id: doc.id, name: doc.data().name, phone: doc.data().phone ?? null })) };
});

exports.getCashierCatalog = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const snapshot = await db.collection("products").get();
  return { items: snapshot.docs.map((doc) => safeProduct(doc.id, doc.data())) };
});

function cashierInvoiceTotal(invoice) {
  const amount = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const gross = (Array.isArray(invoice.products) ? invoice.products : []).reduce(
    (sum, line) => sum + amount(line.product_price) * amount(line.product_quantity), 0,
  ) + amount(invoice.debt) + amount(invoice.delivery_price)
    + amount(invoice.amount_of_animal_feeds) + amount(invoice.amount_of_mahros);
  const discount = invoice.discount_percentage ? gross * amount(invoice.discount) / 100 : amount(invoice.discount);
  return money(gross - discount);
}

function cashierInvoiceSummary(doc) {
  const invoice = doc.data();
  const total = cashierInvoiceTotal(invoice);
  const remaining = Number.isFinite(Number(invoice.remaining)) ? money(invoice.remaining) : 0;
  return {
    id: doc.id, customer_name: invoice.customer_name ?? "", customer_phone: invoice.customer_phone ?? null,
    date: invoice.date ?? null, product_count: Array.isArray(invoice.products) ? invoice.products.length : 0,
    total, paid: money(total - remaining), remaining,
  };
}

exports.getCashierInvoices = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const cursor = cleanText(request.data?.cursor, 128);
  let query = db.collection("invoices").orderBy("date", "desc").limit(26);
  if (cursor) {
    const previous = await db.doc(`invoices/${cursor}`).get();
    if (!previous.exists) throw new HttpsError("invalid-argument", "The invoice page expired. Reload it.");
    query = query.startAfter(previous);
  }
  const page = await query.get();
  const visible = page.docs.slice(0, 25);
  return {
    items: visible.map(cashierInvoiceSummary),
    nextCursor: page.size > 25 ? visible.at(-1).id : null,
  };
});

exports.getCashierInvoice = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const id = cleanText(request.data?.id, 128);
  if (!id) fail("Select an invoice.");
  const doc = await db.doc(`invoices/${id}`).get();
  if (!doc.exists) throw new HttpsError("not-found", "Invoice not found.");
  const invoice = doc.data();
  return {
    id: doc.id, customer_name: invoice.customer_name ?? "", customer_phone: invoice.customer_phone ?? null,
    date: invoice.date ?? null, time: invoice.time ?? invoice.date ?? null,
    debt: invoice.debt ?? null, delivery_price: invoice.delivery_price ?? null,
    amount_of_animal_feeds: invoice.amount_of_animal_feeds ?? null,
    amount_of_mahros: invoice.amount_of_mahros ?? null,
    discount: invoice.discount ?? null, discount_percentage: invoice.discount_percentage === true,
    discount_for: invoice.discount_for ?? null, paid_amount: invoice.paid_amount ?? null,
    remaining: invoice.remaining ?? null,
    products: (Array.isArray(invoice.products) ? invoice.products : []).map((line) => ({
      product_id: line.product_id ?? null, product_name: line.product_name ?? "",
      product_quantity: line.product_quantity ?? 0, product_price: line.product_price ?? 0,
      unit_name: line.unit_name ?? null, option: line.option ?? null,
    })),
  };
});

exports.getCashierDebts = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const customerId = cleanText(request.data?.customerId, 128);
  if (!customerId) fail("Select a customer.");
  const customer = await db.doc(`customers/${customerId}`).get();
  if (!customer.exists) throw new HttpsError("not-found", "Customer not found.");
  const [summaries, legacySummaries, loans] = await Promise.all([
    db.collection("invoice_debt_summaries").where("customer_id", "==", customerId).get(),
    db.collection("invoice_debt_summaries").where("customer_name", "==", customer.data().name).get(),
    db.collection("customer_loans").where("customer_id", "==", customerId).get(),
  ]);
  const phone = String(customer.data().phone ?? "").replace(/\D/g, "");
  const invoiceDocs = new Map(summaries.docs.map((doc) => [doc.id, doc]));
  for (const doc of legacySummaries.docs) {
    const data = doc.data();
    if (!data.customer_id && phone && String(data.customer_phone ?? "").replace(/\D/g, "") === phone) invoiceDocs.set(doc.id, doc);
  }
  return {
    customer: { id: customerId, name: customer.data().name, phone: customer.data().phone ?? null },
    invoices: [...invoiceDocs.values()].filter((doc) => Number(doc.data().remaining) > 0).map((doc) => ({ id: doc.id, total: doc.data().total, paid: doc.data().paid, remaining: doc.data().remaining, date: doc.data().date ?? null })),
    loans: loans.docs.filter((doc) => Number(doc.data().remaining) > 0).map((doc) => ({ id: doc.id, total: doc.data().amount, paid: doc.data().paid_amount, remaining: doc.data().remaining, date: doc.data().created_at ?? null, note: doc.data().note ?? null })),
  };
});

exports.createStaffCustomer = onCall(async (request) => {
  const name = cleanText(request.data?.name);
  const phone = cleanText(request.data?.phone, 40);
  if (!name || !phone) fail("Enter customer name and phone.");
  const ref = db.collection("customers").doc();
  await db.runTransaction(async (tx) => {
    await authorize(request, tx);
    tx.create(ref, { name, phone });
    tx.set(db.doc("store_stats/current"), { customer_count: FieldValue.increment(1), updated_at: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.doc(`customer_summaries/${ref.id}`), { customer_id: ref.id, customer_name: name, customer_phone: phone, invoice_count: 0, total_sales: 0, outstanding_debt: 0, initialized: true, updated_at: FieldValue.serverTimestamp() });
  });
  return { id: ref.id, name, phone };
});

exports.createStaffLoan = onCall(async (request) => {
  const customerId = cleanText(request.data?.customerId, 128);
  const amount = request.data?.amount;
  const note = cleanText(request.data?.note, 500) || null;
  if (!customerId || !validNumber(amount, 0.01) || money(amount) <= 0) fail("Enter a valid customer and amount.");
  const loanRef = db.collection("customer_loans").doc();
  const opRef = operationRef(request, "loan");
  return db.runTransaction(async (tx) => {
    await authorize(request, tx);
    const [previous, customer, cash] = await Promise.all([tx.get(opRef), tx.get(db.doc(`customers/${customerId}`)), tx.get(db.doc("cashbox/current"))]);
    if (previous.exists) return previous.data().result;
    if (!customer.exists || !cash.exists) throw new HttpsError("failed-precondition", "Customer or cashbox is unavailable.");
    if (Number(cash.data().balance) < money(amount)) throw new HttpsError("failed-precondition", "Insufficient cashbox balance.");
    const now = FieldValue.serverTimestamp();
    const name = customer.data().name;
    tx.create(loanRef, { customer_id: customerId, customer_name: name, customer_phone: customer.data().phone ?? null, amount: money(amount), paid_amount: 0, remaining: money(amount), status: "open", note, created_by: request.auth.uid, created_at: now });
    tx.update(db.doc("cashbox/current"), { balance: money(Number(cash.data().balance) - amount), updated_at: now });
    tx.create(db.collection("cash_transactions").doc(), { type: "customer_loan", direction: "out", amount: money(amount), customer_id: customerId, loan_id: loanRef.id, reference_type: "loan", reference_id: loanRef.id, reference_label: `سلفة ${name}`, note, created_by: request.auth.uid, created_at: now });
    tx.create(opRef, { result: { id: loanRef.id }, created_at: now });
    return { id: loanRef.id };
  });
});

function addStats(tx, day, month, values) {
  const changes = { updated_at: FieldValue.serverTimestamp() };
  for (const [key, value] of Object.entries(values)) {
    if (value) changes[key] = FieldValue.increment(value);
  }
  tx.set(db.doc("store_stats/current"), changes, { merge: true });
  tx.set(db.doc(`invoice_stats_daily/${day}`), changes, { merge: true });
  tx.set(db.doc(`invoice_stats_monthly/${month}`), changes, { merge: true });
}

function cairoDateParts() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}` };
}

function sellableUnit(product, id) {
  const units = Array.isArray(product.units) && product.units.length
    ? product.units
    : [{ id: product.base_unit_id || "legacy-base", name: product.base_unit_name || "وحدة", factor: 1, selling_price: product.price, is_base: true }];
  const unit = units.find((item) => item.id === id);
  if (!unit || unit.can_sell === false || !validNumber(Number(unit.factor), 0.000001)) fail("The selected selling unit is unavailable.");
  const price = unit.selling_price ?? ((unit.is_base || unit.id === product.base_unit_id) ? product.price : null);
  return { ...unit, price };
}

exports.createStaffSale = onCall(async (request) => {
  const input = request.data;
  const customerId = cleanText(input?.customer_id, 128);
  const rawLines = input?.products;
  if (!customerId || !Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 50) fail("Select a customer and 1 to 50 products.");
  const paid = input?.paid_amount;
  if (!validNumber(paid)) fail("Enter a valid paid amount.");
  const saleRef = db.collection("invoices").doc();
  const opRef = operationRef(request, "sale");
  const outcome = await db.runTransaction(async (tx) => {
    const role = await authorize(request, tx);
    const previousOperation = await tx.get(opRef);
    if (previousOperation.exists) return previousOperation.data().result;
    const ids = [...new Set(rawLines.map((line) => cleanText(line.product_id, 128)))];
    if (ids.some((id) => !id)) fail("Invalid product.");
    const [customer, cash, ...productSnaps] = await Promise.all([
      tx.get(db.doc(`customers/${customerId}`)), tx.get(db.doc("cashbox/current")),
      ...ids.map((id) => tx.get(db.doc(`products/${id}`))),
    ]);
    if (!customer.exists) throw new HttpsError("not-found", "Customer not found.");
    if (!cash.exists && paid > 0) throw new HttpsError("failed-precondition", "Initialize the cashbox first.");
    const products = new Map(productSnaps.map((snapshot) => [snapshot.id, snapshot]));
    const needs = new Map();
    const lines = rawLines.map((raw, index) => {
      const id = cleanText(raw.product_id, 128);
      const snapshot = products.get(id);
      if (!snapshot?.exists || snapshot.data().is_active === false) fail("A product is unavailable.");
      const product = snapshot.data();
      const unitId = cleanText(raw.unit_id, 128) || product.base_unit_id || product.units?.find((unit) => unit.is_base)?.id || "legacy-base";
      const unit = sellableUnit(product, unitId);
      const quantity = raw.product_quantity;
      if (!validNumber(quantity, 0.000001) || !validNumber(Number(unit.factor), 0.000001)) fail("Enter a valid quantity.");
      const baseQuantity = money(quantity * Number(unit.factor));
      if (baseQuantity <= 0) fail("Quantity is too small.");
      const listedPrice = unit.price;
      const requestedPrice = Number(raw.product_price);
      if (role === "cashier" && (!validNumber(listedPrice) || !validNumber(requestedPrice) || Math.abs(requestedPrice - listedPrice) > 0.005)) fail("The selling price changed. Refresh the product.");
      if (!validNumber(requestedPrice)) fail("Enter a valid selling price.");
      needs.set(id, money((needs.get(id) || 0) + baseQuantity));
      const baseCost = cost4(Number(product.cost_price || 0));
      return {
        line_id: `${saleRef.id}-${index}`, product_id: id, product_name: product.name,
        unit_id: unit.id, unit_name: unit.name, unit_factor: Number(unit.factor),
        product_quantity: quantity, base_quantity: baseQuantity, product_price: requestedPrice,
        product_cost_price: baseCost, base_cost_snapshot: baseCost,
        cost_groups: [{ base_quantity: baseQuantity, unit_cost: baseCost }],
        option: cleanText(raw.option, 120), total: money(requestedPrice * quantity),
      };
    });
    for (const [id, need] of needs) {
      if (need - Number(products.get(id).data().stock_quantity || 0) > 1e-9) throw new HttpsError("failed-precondition", `Insufficient stock for ${products.get(id).data().name}.`);
    }
    const numeric = (key) => {
      const value = input[key] == null || input[key] === "" ? 0 : Number(input[key]);
      if (!validNumber(value)) fail(`Invalid ${key}.`);
      return value;
    };
    const previous = numeric("debt");
    const delivery = numeric("delivery_price");
    const feeds = numeric("amount_of_animal_feeds");
    const mahros = numeric("amount_of_mahros");
    const discount = numeric("discount");
    if (role === "cashier" && (previous || delivery || feeds || mahros || discount)) fail("Cashier invoices cannot contain manual adjustments.");
    const { subtotal, currentGross, gross, discountValue, total, remaining, sales, cost, profit } = saleAmounts(lines, {
      previous, delivery, feeds, mahros, discount, discountPercentage: input.discount_percentage === true, paid,
    });
    if (total < 0 || paid - total > 0.005) fail("Paid amount exceeds invoice total.");
    const status = statusOf(paid, remaining);
    const now = FieldValue.serverTimestamp();
    const date = Timestamp.now();
    const name = String(customer.data().name);
    const phone = customer.data().phone ?? null;
    const invoice = {
      customer_id: customerId, customer_name: name, customer_phone: phone,
      customer_name_norm: name.trim().toLocaleLowerCase(), customer_phone_digits: String(phone ?? "").replace(/\D/g, ""),
      products: lines, debt: previous, delivery_price: delivery, amount_of_animal_feeds: feeds,
      amount_of_mahros: mahros, discount, discount_percentage: input.discount_percentage === true,
      discount_for: cleanText(input.discount_for, 100) || null,
      paid_amount: money(paid), remaining, inventory_applied: true, cashbox_applied: paid > 0,
      created_by: request.auth.uid, date, time: date,
    };
    tx.create(saleRef, invoice);
    tx.set(db.doc(`invoice_debt_summaries/${saleRef.id}`), {
      invoice_id: saleRef.id, customer_id: customerId, customer_name: name, customer_phone: phone,
      date, total, sales, paid: money(paid), remaining, profit, updated_at: now,
    });
    const keys = cairoDateParts();
    addStats(tx, keys.day, keys.month, {
      total_sales: sales, gross_sales: currentGross, total_discount: gross > 0 ? money(discountValue * currentGross / gross) : discountValue,
      total_paid: money(paid), outstanding_customer_debt: remaining, total_cost: cost,
      total_profit: profit, invoice_count: 1,
      paid_invoice_count: status === "paid" ? 1 : 0,
      partial_invoice_count: status === "partial" ? 1 : 0,
      unpaid_invoice_count: status === "unpaid" ? 1 : 0,
    });
    tx.set(db.doc(`customer_summaries/${customerId}`), {
      customer_id: customerId, customer_name: name, customer_phone: phone,
      invoice_count: FieldValue.increment(1), total_sales: FieldValue.increment(sales),
      outstanding_debt: FieldValue.increment(remaining), updated_at: now,
    }, { merge: true });
    const movementsByProduct = new Map();
    lines.forEach((line, index) => {
      const movement = db.collection("inventory_transactions").doc();
      const idsForProduct = movementsByProduct.get(line.product_id) || [];
      idsForProduct.push(movement.id);
      movementsByProduct.set(line.product_id, idsForProduct);
      tx.create(movement, {
        type: "sale", product_id: line.product_id, product_name: line.product_name,
        quantity: line.product_quantity, unit_id: line.unit_id, unit_name: line.unit_name,
        unit_factor: line.unit_factor, base_quantity: line.base_quantity, direction: "out",
        unit_cost: line.product_cost_price, invoice_id: saleRef.id, note: null,
        seq: index, created_by: request.auth.uid, created_at: now,
      });
    });
    for (const [id, need] of needs) {
      const movementIds = movementsByProduct.get(id);
      tx.update(db.doc(`products/${id}`), {
        stock_quantity: money(Number(products.get(id).data().stock_quantity || 0) - need),
        last_inventory_transaction_id: movementIds.at(-1), last_inventory_transaction_ids: movementIds,
      });
    }
    if (paid > 0) {
      tx.update(db.doc("cashbox/current"), { balance: money(Number(cash.data().balance || 0) + paid), updated_at: now });
      tx.create(db.collection("cash_transactions").doc(), {
        type: "invoice_sale", direction: "in", amount: money(paid), customer_id: customerId,
        invoice_id: saleRef.id, reference_type: "invoice", reference_id: saleRef.id,
        reference_label: `فاتورة بيع لـ ${name}`, note: null, created_by: request.auth.uid, created_at: now,
      });
    }
    const result = { id: saleRef.id, receipt: { ...invoice, id: saleRef.id, products: lines.map(({ product_cost_price, base_cost_snapshot, cost_groups, ...line }) => line) } };
    tx.create(opRef, { result, created_at: now });
    return result;
  });
  return outcome;
});

exports.payStaffDebts = onCall(async (request) => {
  const customerId = cleanText(request.data?.customer_id, 128);
  const allocations = request.data?.allocations;
  const amount = request.data?.amount;
  const note = cleanText(request.data?.note, 500) || null;
  if (!customerId || !Array.isArray(allocations) || allocations.length < 1 || allocations.length > 50 || !validNumber(amount, 0.01)) fail("Enter a valid payment.");
  const seen = new Set();
  let sum = 0;
  for (const item of allocations) {
    const id = cleanText(item?.reference_id, 128);
    const key = `${item?.type}:${id}`;
    if (!id || !["invoice", "loan"].includes(item?.type) || !validNumber(item?.amount, 0.01) || money(item.amount) <= 0 || seen.has(key)) fail("Invalid or duplicate allocation.");
    seen.add(key);
    sum = money(sum + item.amount);
  }
  if (Math.abs(sum - money(amount)) > 0.005) fail("Allocations do not match payment amount.");
  const paymentRef = db.collection("debt_payments").doc();
  const opRef = operationRef(request, "payment");
  return db.runTransaction(async (tx) => {
    await authorize(request, tx);
    const customerRef = db.doc(`customers/${customerId}`);
    const cashRef = db.doc("cashbox/current");
    const [previous, customer, cash, ...snapshots] = await Promise.all([
      tx.get(opRef), tx.get(customerRef), tx.get(cashRef),
      ...allocations.map((item) => tx.get(db.doc(`${item.type === "invoice" ? "invoices" : "customer_loans"}/${item.reference_id}`))),
    ]);
    if (previous.exists) return previous.data().result;
    const summarySnaps = await Promise.all(allocations.map((item) => item.type === "invoice" ? tx.get(db.doc(`invoice_debt_summaries/${item.reference_id}`)) : Promise.resolve(null)));
    if (!customer.exists || !cash.exists) throw new HttpsError("failed-precondition", "Customer or cashbox is unavailable.");
    const customerName = String(customer.data().name || "");
    const phone = String(customer.data().phone ?? "").replace(/\D/g, "");
    for (const [index, snapshot] of snapshots.entries()) {
      if (!snapshot.exists) throw new HttpsError("not-found", "An obligation was not found.");
      const data = snapshot.data();
      if (data.customer_id && data.customer_id !== customerId) throw new HttpsError("permission-denied", "An obligation belongs to another customer.");
      if (!data.customer_id && (String(data.customer_name || "").trim() !== customerName.trim() || String(data.customer_phone ?? "").replace(/\D/g, "") !== phone || !phone)) {
        throw new HttpsError("permission-denied", "Legacy obligation ownership cannot be verified.");
      }
      const remaining = data.remaining == null ? Number(summarySnaps[index]?.data()?.remaining) : Number(data.remaining);
      if (!validNumber(remaining) || allocations[index].amount - remaining > 0.005) fail("Payment exceeds remaining balance.");
    }
    const now = FieldValue.serverTimestamp();
    const keys = cairoDateParts();
    const statDeltas = new Map();
    const accrue = (day, month, values) => {
      for (const path of ["store_stats/current", `invoice_stats_daily/${day}`, `invoice_stats_monthly/${month}`]) {
        const current = statDeltas.get(path) || {};
        for (const [key, value] of Object.entries(values)) current[key] = money((current[key] || 0) + value);
        statDeltas.set(path, current);
      }
    };
    let invoicePayments = 0;
    tx.create(paymentRef, { customer_id: customerId, amount: money(amount), allocations: allocations.map((item) => ({ type: item.type, reference_id: item.reference_id, amount: money(item.amount) })), note, created_by: request.auth.uid, created_at: now });
    tx.create(opRef, { result: { id: paymentRef.id, total: money(amount) }, created_at: now });
    tx.update(cashRef, { balance: money(Number(cash.data().balance || 0) + amount), updated_at: now });
    for (const [index, snapshot] of snapshots.entries()) {
      const allocation = allocations[index];
      const data = snapshot.data();
      const oldPaid = data.paid_amount == null ? Number(summarySnaps[index]?.data()?.paid || 0) : Number(data.paid_amount);
      const oldRemaining = data.remaining == null ? Number(summarySnaps[index]?.data()?.remaining) : Number(data.remaining);
      const paid = money(oldPaid + allocation.amount);
      const remaining = money(oldRemaining - allocation.amount);
      if (allocation.type === "invoice") {
        const oldStatus = statusOf(oldPaid, oldRemaining);
        const newStatus = statusOf(paid, remaining);
        tx.update(snapshot.ref, { paid_amount: paid, remaining, debt_payment_count: FieldValue.increment(1) });
        tx.set(db.doc(`invoice_debt_summaries/${snapshot.id}`), { paid, remaining, updated_at: now }, { merge: true });
        invoicePayments = money(invoicePayments + allocation.amount);
        const invoiceDate = data.date?.toDate?.() || new Date();
        const period = asDateKey(invoiceDate);
        accrue(period.day, period.month, {
          total_paid: money(allocation.amount), outstanding_customer_debt: -money(allocation.amount),
          paid_invoice_count: (newStatus === "paid") - (oldStatus === "paid"),
          partial_invoice_count: (newStatus === "partial") - (oldStatus === "partial"),
          unpaid_invoice_count: (newStatus === "unpaid") - (oldStatus === "unpaid"),
        });
        tx.create(db.collection("cash_transactions").doc(), {
          type: "invoice_payment", direction: "in", amount: money(allocation.amount), customer_id: customerId,
          invoice_id: snapshot.id, debt_payment_id: paymentRef.id, note, created_by: request.auth.uid,
          created_at: now, reference_type: "invoice", reference_id: snapshot.id,
          reference_label: `فاتورة بيع لـ ${customerName}`,
        });
      } else {
        tx.update(snapshot.ref, { paid_amount: paid, remaining, status: remaining <= 0 ? "paid" : "partial" });
        accrue(keys.day, keys.month, { total_paid: money(allocation.amount) });
        tx.create(db.collection("cash_transactions").doc(), {
          type: "loan_payment", direction: "in", amount: money(allocation.amount), customer_id: customerId,
          loan_id: snapshot.id, debt_payment_id: paymentRef.id, note, created_by: request.auth.uid,
          created_at: now, reference_type: "loan", reference_id: snapshot.id,
          reference_label: `سلفة ${customerName}`,
        });
      }
    }
    if (invoicePayments) tx.set(db.doc(`customer_summaries/${customerId}`), { outstanding_debt: FieldValue.increment(-invoicePayments), updated_at: now }, { merge: true });
    for (const [path, values] of statDeltas) {
      const changes = { updated_at: now };
      for (const [key, value] of Object.entries(values)) if (value) changes[key] = FieldValue.increment(value);
      tx.set(db.doc(path), changes, { merge: true });
    }
    return { id: paymentRef.id, total: money(amount) };
  });
});
