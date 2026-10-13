const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, FieldPath, Timestamp } = require("firebase-admin/firestore");
const { safeProduct, saleAmounts, invoiceRevision } = require("./staffMath.cjs");

const db = getFirestore();
const adminEmail = "mohamed.mojahead@gmail.com";
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
  if (data?.role === "cashier" && data.active === true && data.email === request.auth.token.email) return "cashier";
  throw new HttpsError("permission-denied", "This account is not authorized.");
}

async function authorize(request, tx) {
  const role = await roleOf(request);
  const reset = await tx.get(db.doc("system_jobs/factory_reset"));
  if (reset.data()?.status === "running") throw new HttpsError("failed-precondition", "System reset is running.");
  if (role === "cashier") {
    const staff = await tx.get(db.doc(`staff_users/${request.auth.uid}`));
    if (!staff.exists || staff.data()?.role !== "cashier" || staff.data()?.active !== true || staff.data()?.email !== request.auth.token.email) {
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

exports.getCustomerCredit = onCall(async (request) => {
  await roleOf(request);
  const id = cleanText(request.data?.customerId, 128);
  if (!id) fail("Select a customer.");
  const credit = await db.doc(`customer_credits/${id}`).get();
  return { balance: money(credit.data()?.balance || 0) };
});

exports.payCustomerCredit = onCall(async (request) => {
  const customerId = cleanText(request.data?.customerId, 128);
  const amount = request.data?.amount;
  if (!customerId || !validNumber(amount, 0.01) || money(amount) <= 0) fail("Enter a valid customer credit payout.");
  const opRef = operationRef(request, "credit_payout");
  const creditRef = db.doc(`customer_credits/${customerId}`);
  const cashRef = db.doc("cashbox/current");
  return db.runTransaction(async (tx) => {
    await authorize(request, tx);
    const [previous, customer, credit, cash] = await Promise.all([tx.get(opRef), tx.get(db.doc(`customers/${customerId}`)), tx.get(creditRef), tx.get(cashRef)]);
    if (previous.exists) return previous.data().result;
    if (!customer.exists) throw new HttpsError("not-found", "Customer not found.");
    const balance = money(credit.data()?.balance || 0);
    if (money(amount) - balance > 0.005) throw new HttpsError("failed-precondition", "Customer credit is insufficient.");
    if (!cash.exists || money(amount) - money(cash.data().balance || 0) > 0.005) throw new HttpsError("failed-precondition", "Cashbox balance is insufficient.");
    const now = FieldValue.serverTimestamp();
    const movement = db.collection("customer_credit_transactions").doc();
    tx.set(creditRef, { balance: money(balance - amount), updated_at: now }, { merge: true });
    tx.update(cashRef, { balance: money(Number(cash.data().balance || 0) - amount), updated_at: now });
    tx.create(movement, { customer_id: customerId, type: "cash_payout", amount: money(amount), created_by: request.auth.uid, created_at: now });
    tx.create(db.collection("cash_transactions").doc(), { type: "customer_credit_payout", direction: "out", amount: money(amount), customer_id: customerId, reference_type: "customer_credit", reference_id: movement.id, reference_label: `صرف رصيد ${customer.data().name || "عميل"}`, created_by: request.auth.uid, created_at: now });
    const result = { balance: money(balance - amount), amount: money(amount) };
    tx.create(opRef, { result, created_at: now });
    return result;
  });
});

exports.getCashierCashSummary = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const keys = cairoDateParts();
  const [year, month, day] = keys.day.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "shortOffset" }).formatToParts(noon).find((part) => part.type === "timeZoneName")?.value || "";
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zone);
  if (!match) throw new HttpsError("unavailable", "Unable to resolve Cairo time.");
  const offset = (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] || 0));
  const start = Timestamp.fromDate(new Date(Date.UTC(year, month - 1, day) - offset * 60000));
  const [cash, movements] = await Promise.all([db.doc("cashbox/current").get(), db.collection("cash_transactions").where("created_at", ">=", start).get()]);
  let allNet = 0;
  let ownIn = 0;
  let ownOut = 0;
  const own = [];
  for (const movement of movements.docs) {
    const data = movement.data();
    const amount = money(data.amount || 0);
    if (data.type !== "opening_balance") allNet = money(allNet + (data.direction === "in" ? amount : -amount));
    if (data.created_by !== request.auth.uid) continue;
    if (data.direction === "in") ownIn = money(ownIn + amount);
    else ownOut = money(ownOut + amount);
    own.push({ id: movement.id, type: data.type, direction: data.direction, amount, reference_label: data.reference_label || "", created_at: data.created_at });
  }
  own.sort((a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0));
  return { day: keys.day, opening: cash.exists ? money(Number(cash.data().balance || 0) - allNet) : null, cashIn: ownIn, cashOut: ownOut, operations: own.slice(0, 100), operationCount: own.length };
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
  const remaining = invoice.remaining != null && Number.isFinite(Number(invoice.remaining))
    ? Math.max(0, money(invoice.remaining))
    : invoice.paid_amount == null ? 0 : Math.max(0, money(total - Number(invoice.paid_amount)));
  return {
    id: doc.id, customer_id: invoice.customer_id ?? null, customer_name: invoice.customer_name ?? "", customer_phone: invoice.customer_phone ?? null,
    date: invoice.date ?? null, product_count: Array.isArray(invoice.products) ? invoice.products.length : 0,
    total, paid: invoice.paid_amount == null ? money(total - remaining) : money(invoice.paid_amount), credit_used: money(invoice.credit_used || 0), remaining, return_status: invoice.return_status ?? null,
  };
}

exports.getCashierInvoices = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const search = cleanText(request.data?.search, 80).toLocaleLowerCase();
  const customerId = cleanText(request.data?.customerId, 128);
  const cursor = cleanText(request.data?.cursor, 128);
  let query;
  if (customerId) {
    query = db.collection("invoices").where("customer_id", "==", customerId).orderBy("date", "desc");
  } else if (search) {
    const field = /^[\d\s+()-]+$/.test(search) ? "customer_phone_digits" : "customer_name_norm";
    const term = field === "customer_phone_digits" ? search.replace(/\D/g, "") : search;
    query = db.collection("invoices").where(field, ">=", term).where(field, "<=", `${term}\uf8ff`).orderBy(field);
  } else {
    query = db.collection("invoices").orderBy("date", "desc");
  }
  query = query.limit(26);
  if (cursor) {
    const previous = await db.doc(`invoices/${cursor}`).get();
    if (!previous.exists) throw new HttpsError("invalid-argument", "The invoice page expired. Reload it.");
    query = query.startAfter(previous);
  }
  const page = await query.get();
  const visible = page.docs.slice(0, 25);
  const returnTotals = new Map();
  const cashRefundTotals = new Map();
  if (visible.length) {
    const returns = await db.collection("invoice_returns").where("invoice_id", "in", visible.map((doc) => doc.id)).get();
    for (const record of returns.docs) {
      const data = record.data();
      returnTotals.set(data.invoice_id, money((returnTotals.get(data.invoice_id) || 0) + Number(data.total_refund || 0)));
      cashRefundTotals.set(data.invoice_id, money((cashRefundTotals.get(data.invoice_id) || 0) + Number(data.cash_refund || 0)));
    }
  }
  return {
    items: visible.map((doc) => ({ ...cashierInvoiceSummary(doc), return_total: returnTotals.get(doc.id) || 0, cash_refund_total: cashRefundTotals.get(doc.id) || 0 })),
    nextCursor: page.size > 25 ? visible.at(-1).id : null,
  };
});

exports.getCashierInvoiceReturns = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const present = (item) => {
    const { original_unit_cost, ...safe } = item;
    return safe;
  };
  if (Array.isArray(request.data?.ids)) {
    const ids = request.data.ids.map((value) => cleanText(value, 128));
    if (!ids.length || ids.length > 25 || ids.some((value) => !value)) fail("Select invoices.");
    const returns = await db.collection("invoice_returns").where("invoice_id", "in", [...new Set(ids)]).get();
    return { items: returns.docs.map((item) => ({ id: item.id, ...item.data(), items: (item.data().items || []).map(present) })) };
  }
  const id = cleanText(request.data?.id, 128);
  if (!id) fail("Select an invoice.");
  const invoice = await db.doc(`invoices/${id}`).get();
  if (!invoice.exists) throw new HttpsError("not-found", "Invoice not found.");
  const returns = await db.collection("invoice_returns").where("invoice_id", "==", id).get();
  return { items: returns.docs.map((item) => ({ id: item.id, ...item.data(), items: (item.data().items || []).map(present) })) };
});

exports.getCashierReturnJournal = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const cursor = cleanText(request.data?.cursor, 128);
  let returns = db.collection("invoice_returns").orderBy("created_at", "desc").limit(51);
  if (cursor) {
    const previous = await db.doc(`invoice_returns/${cursor}`).get();
    if (!previous.exists) fail("Return page expired.");
    returns = returns.startAfter(previous);
  }
  const page = await returns.get();
  const visible = page.docs.slice(0, 50);
  const invoiceIds = [...new Set(visible.map((doc) => doc.data().invoice_id).filter(Boolean))];
  const names = new Map();
  for (let index = 0; index < invoiceIds.length; index += 30) {
    const batch = await db.collection("invoices").where(FieldPath.documentId(), "in", invoiceIds.slice(index, index + 30)).get();
    for (const invoice of batch.docs) names.set(invoice.id, invoice.data().customer_name || "عميل");
  }
  return { items: visible.map((doc) => {
    const record = doc.data();
    return { id: doc.id, invoice_id: record.invoice_id, customer_id: record.customer_id || null, customer_name: names.get(record.invoice_id) || "عميل", created_at: record.created_at,
      items: (record.items || []).map((item) => ({ product_id: item.product_id, product_name: item.product_name, quantity: item.quantity, unit_name: item.unit_name, original_unit_price: item.original_unit_price, refund_amount: item.refund_amount })),
      total_refund: record.total_refund, debt_reduction: record.debt_reduction, cash_refund: record.cash_refund,
      credit_issued: record.credit_issued || 0, credit_restored: record.credit_restored || 0, note: record.note || null };
  }), nextCursor: page.size > 50 ? visible.at(-1).id : null };
});

exports.getCashierInvoice = onCall(async (request) => {
  await roleOf(request);
  const id = cleanText(request.data?.id, 128);
  if (!id) fail("Select an invoice.");
  const doc = await db.doc(`invoices/${id}`).get();
  if (!doc.exists) throw new HttpsError("not-found", "Invoice not found.");
  const invoice = doc.data();
  return { ...invoice, id: doc.id, edit_revision: invoiceRevision(invoice), products: (invoice.products || []).map((line, index) => ({ ...line, line_id: line.line_id || `legacy-${index}` })) };
});

exports.getCashierDebtBook = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const [summaries, loans, customers, credits] = await Promise.all([
    db.collection("invoice_debt_summaries").where("remaining", ">", 0).get(),
    db.collection("customer_loans").where("remaining", ">", 0).get(),
    db.collection("customers").get(),
    db.collection("customer_credits").where("balance", ">", 0).get(),
  ]);
  const byLegacy = new Map();
  const customersById = new Map(customers.docs.map((item) => [item.id, item]));
  for (const doc of customers.docs) {
    const data = doc.data();
    const key = `${String(data.name || "").trim().toLocaleLowerCase()}|${String(data.phone ?? "").replace(/\D/g, "")}`;
    const found = byLegacy.get(key);
    byLegacy.set(key, found === undefined ? doc.id : null);
  }
  const book = new Map();
  const ensure = (data) => {
    const name = String(data.customer_name || "بدون اسم");
    const phone = data.customer_phone ?? null;
    const legacyKey = `${name.trim().toLocaleLowerCase()}|${String(phone ?? "").replace(/\D/g, "")}`;
    const customerId = data.customer_id || (String(phone ?? "").replace(/\D/g, "") ? byLegacy.get(legacyKey) : null);
    const key = customerId ? `id:${customerId}` : `legacy:${legacyKey}`;
    if (!book.has(key)) book.set(key, { key, customer_id: customerId || null, name, phone, invoices: [], loans: [], invoiceDebt: 0, loanDebt: 0, totalDebt: 0, creditBalance: 0, unpaidCount: 0 });
    return book.get(key);
  };
  for (const doc of summaries.docs) {
    const data = doc.data();
    const remaining = money(data.remaining);
    if (remaining <= 0) continue;
    const entry = ensure(data);
    entry.invoices.push({ id: doc.id, type: "invoice", total: money(data.total), paid: money(data.paid), remaining, date: data.date ?? null });
    entry.invoiceDebt = money(entry.invoiceDebt + remaining);
    entry.unpaidCount += 1;
  }
  for (const doc of loans.docs) {
    const data = doc.data();
    const remaining = money(data.remaining);
    if (remaining <= 0) continue;
    const entry = ensure(data);
    entry.loans.push({ id: doc.id, type: "loan", total: money(data.amount), paid: money(data.paid_amount), remaining, date: data.created_at ?? null, note: data.note ?? null });
    entry.loanDebt = money(entry.loanDebt + remaining);
  }
  for (const doc of credits.docs) {
    const customer = customersById.get(doc.id);
    if (!customer) continue;
    const entry = ensure({ customer_id: doc.id, customer_name: customer.data().name, customer_phone: customer.data().phone });
    entry.creditBalance = money(doc.data().balance);
  }
  return { items: [...book.values()].map((entry) => ({ ...entry, totalDebt: money(entry.invoiceDebt + entry.loanDebt) })).sort((a, b) => b.totalDebt - a.totalDebt) };
});

exports.getCashierPayments = onCall(async (request) => {
  if (await roleOf(request) !== "cashier") throw new HttpsError("permission-denied", "Cashier only.");
  const customerId = cleanText(request.data?.customerId, 128);
  if (!customerId) fail("Select a customer.");
  const snapshot = await db.collection("debt_payments").where("customer_id", "==", customerId).get();
  return { items: snapshot.docs.map((doc) => ({ id: doc.id, amount: doc.data().amount, source: doc.data().source ?? "cash", allocations: doc.data().allocations ?? [], note: doc.data().note ?? null, created_at: doc.data().created_at ?? null })).sort((a, b) => Number(b.created_at?.seconds || 0) - Number(a.created_at?.seconds || 0)) };
});

exports.getCustomerHistory = onCall(async (request) => {
  await roleOf(request);
  const customerId = cleanText(request.data?.customerId, 128);
  if (!customerId) fail("Select a customer.");
  const customer = await db.doc(`customers/${customerId}`).get();
  if (!customer.exists) throw new HttpsError("not-found", "Customer not found.");
  const [invoices, loans, returns, payments, credits] = await Promise.all([
    db.collection("invoices").where("customer_id", "==", customerId).get(),
    db.collection("customer_loans").where("customer_id", "==", customerId).get(),
    db.collection("invoice_returns").where("customer_id", "==", customerId).get(),
    db.collection("debt_payments").where("customer_id", "==", customerId).get(),
    db.collection("customer_credit_transactions").where("customer_id", "==", customerId).get(),
  ]);
  const paidLater = new Map();
  for (const payment of payments.docs) {
    for (const allocation of payment.data().allocations || []) {
      if (allocation.type !== "invoice") continue;
      paidLater.set(allocation.reference_id, money((paidLater.get(allocation.reference_id) || 0) + Number(allocation.amount || 0)));
    }
  }
  const entries = [
    ...invoices.docs.map((doc) => ({ id: doc.id, type: "deferred", amount: doc.data().paid_amount == null ? 0 : money(cashierInvoiceTotal(doc.data()) - Number(doc.data().paid_amount) + (paidLater.get(doc.id) || 0)), invoiceId: doc.id, date: doc.data().date ?? null, detail: "" })).filter((entry) => entry.amount > 0),
    ...loans.docs.map((doc) => ({ id: doc.id, type: "loan", amount: money(doc.data().amount), date: doc.data().created_at ?? null, detail: doc.data().note || "" })),
    ...returns.docs.map((doc) => ({ id: doc.id, type: "credit_added", amount: money(Number(doc.data().credit_issued || 0) + Number(doc.data().credit_restored || 0)), invoiceId: doc.data().invoice_id, date: doc.data().created_at ?? null, detail: "" })).filter((entry) => entry.amount > 0),
    ...payments.docs.map((doc) => ({ id: doc.id, type: doc.data().source === "credit" ? "settlement" : "payment", amount: money(doc.data().amount), date: doc.data().created_at ?? null, detail: doc.data().note || "" })),
    ...credits.docs.filter((doc) => doc.data().type === "redeemed").map((doc) => ({ id: doc.id, type: "credit_used", amount: money(doc.data().amount), invoiceId: doc.data().invoice_id || null, date: doc.data().created_at ?? null, detail: "" })),
  ];
  const time = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Number(value?.seconds) * 1000 || Date.parse(value || "") || 0);
  entries.sort((a, b) => time(b.date) - time(a.date));
  return { items: entries };
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
  if (!(Number(price) > 0)) fail("The selected selling unit is unavailable.");
  return { ...unit, price };
}

exports.createStaffSale = onCall(async (request) => {
  const input = request.data;
  const customerId = cleanText(input?.customer_id, 128);
  const rawLines = input?.products;
  if (!customerId || !Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 50) fail("Select a customer and 1 to 50 products.");
  const paid = input?.paid_amount;
  if (!validNumber(paid)) fail("Enter a valid paid amount.");
  const creditUsed = input?.credit_used ?? 0;
  if (!validNumber(creditUsed)) fail("Enter a valid customer credit amount.");
  const saleRef = db.collection("invoices").doc();
  const opRef = operationRef(request, "sale");
  const outcome = await db.runTransaction(async (tx) => {
    await authorize(request, tx);
    const previousOperation = await tx.get(opRef);
    if (previousOperation.exists) return previousOperation.data().result;
    const ids = [...new Set(rawLines.map((line) => cleanText(line.product_id, 128)))];
    if (ids.some((id) => !id)) fail("Invalid product.");
    const creditRef = db.doc(`customer_credits/${customerId}`);
    const [customer, cash, credit, ...productSnaps] = await Promise.all([
      tx.get(db.doc(`customers/${customerId}`)), tx.get(db.doc("cashbox/current")), tx.get(creditRef),
      ...ids.map((id) => tx.get(db.doc(`products/${id}`))),
    ]);
    if (!customer.exists) throw new HttpsError("not-found", "Customer not found.");
    if (!cash.exists && paid > 0) throw new HttpsError("failed-precondition", "Initialize the cashbox first.");
    if (money(creditUsed) - money(credit.data()?.balance || 0) > 0.005) throw new HttpsError("failed-precondition", "Customer credit is insufficient. Refresh it.");
    const products = new Map(productSnaps.map((snapshot) => [snapshot.id, snapshot]));
    const needs = new Map();
    const lines = rawLines.map((raw, index) => {
      const id = cleanText(raw.product_id, 128);
      const snapshot = products.get(id);
      if (!snapshot?.exists || snapshot.data().is_active === false) fail("A product is unavailable.");
      const product = snapshot.data();
      const unitId = cleanText(raw.unit_id, 128) || product.units?.[0]?.id || "legacy-base";
      const unit = sellableUnit(product, unitId);
      const quantity = raw.product_quantity;
      if (!validNumber(quantity, 0.000001) || Math.abs(quantity - cost4(quantity)) > 1e-9) fail("Enter a valid quantity with at most four decimal places.");
      if (unit.allows_fractional !== true && Math.abs(quantity - Math.round(quantity)) > 1e-9) fail("This unit does not allow fractional quantities.");
      const requestedPrice = raw.product_price;
      if (!validNumber(requestedPrice)) fail("Enter a valid selling price.");
      const stockKey = `${id}||${unit.id}`;
      needs.set(stockKey, cost4((needs.get(stockKey) || 0) + quantity));
      const unitCost = cost4(Number((unit.average_cost ?? product.cost_price) || 0));
      return {
        line_id: `${saleRef.id}-${index}`, product_id: id, product_name: product.name,
        unit_id: unit.id, unit_name: unit.name, unit_factor: 1,
        product_quantity: quantity, base_quantity: quantity, product_price: requestedPrice,
        product_cost_price: unitCost, base_cost_snapshot: unitCost,
        cost_groups: [{ base_quantity: quantity, unit_cost: unitCost }],
        option: cleanText(raw.option, 120), total: money(requestedPrice * quantity),
      };
    });
    for (const [key, need] of needs) {
      const [id, unitId] = key.split("||");
      const product = products.get(id).data();
      const unit = (product.units || []).find((entry) => entry.id === unitId);
      if (!unit || need - Number(unit.stock_quantity || 0) > 1e-9) throw new HttpsError("failed-precondition", `Insufficient stock for ${product.name}.`);
    }
    const numeric = (key) => {
      const value = input[key] == null || input[key] === "" ? 0 : Number(input[key]);
      if (!validNumber(value)) fail(`Invalid ${key}.`);
      return value;
    };
    const previous = 0;
    const delivery = numeric("delivery_price");
    const feeds = numeric("amount_of_animal_feeds");
    const mahros = numeric("amount_of_mahros");
    const discount = numeric("discount");
    const grossBeforeDiscount = money(lines.reduce((sum, line) => sum + line.product_price * line.product_quantity, 0) + previous + delivery + feeds + mahros);
    if ((input.discount_percentage === true && discount > 100) || (input.discount_percentage !== true && discount - grossBeforeDiscount > 0.005)) fail("Discount exceeds the invoice total.");
    const settled = money(paid + creditUsed);
    const { subtotal, currentGross, gross, discountValue, total, remaining, sales, cost, profit } = saleAmounts(lines, {
      previous, delivery, feeds, mahros, discount, discountPercentage: input.discount_percentage === true, paid: settled,
    });
    if (total < 0 || settled - total > 0.005) fail("Paid amount exceeds invoice total.");
    const status = statusOf(settled, remaining);
    const now = FieldValue.serverTimestamp();
    const date = Timestamp.now();
    const name = String(customer.data().name);
    const phone = customer.data().phone ?? null;
    const invoice = {
      customer_id: customerId, customer_name: name, customer_phone: phone,
      customer_name_norm: name.trim().toLocaleLowerCase(), customer_phone_digits: String(phone ?? "").replace(/\D/g, ""),
      products: lines, delivery_price: delivery, amount_of_animal_feeds: feeds,
      amount_of_mahros: mahros, discount, discount_percentage: input.discount_percentage === true,
      discount_for: cleanText(input.discount_for, 100) || null,
      paid_amount: settled, credit_used: money(creditUsed), remaining, inventory_applied: true, cashbox_applied: paid > 0,
      created_by: request.auth.uid, date, time: date,
    };
    tx.create(saleRef, invoice);
    tx.set(db.doc(`invoice_debt_summaries/${saleRef.id}`), {
      invoice_id: saleRef.id, customer_id: customerId, customer_name: name, customer_phone: phone,
      date, total, sales, paid: settled, remaining, profit, updated_at: now,
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
    if (creditUsed > 0) {
      tx.set(creditRef, { balance: money(Number(credit.data()?.balance || 0) - creditUsed), updated_at: now }, { merge: true });
      tx.create(db.collection("customer_credit_transactions").doc(), { customer_id: customerId, invoice_id: saleRef.id, type: "redeemed", amount: money(creditUsed), created_by: request.auth.uid, created_at: now });
    }
    const movementsByProduct = new Map();
    lines.forEach((line, index) => {
      const movement = db.collection("inventory_transactions").doc();
      const idsForProduct = movementsByProduct.get(line.product_id) || [];
      idsForProduct.push(movement.id);
      movementsByProduct.set(line.product_id, idsForProduct);
      tx.create(movement, {
        type: "sale", product_id: line.product_id, product_name: line.product_name,
        quantity: line.product_quantity, unit_id: line.unit_id, unit_name: line.unit_name,
        unit_factor: 1, unit_quantity: line.product_quantity, base_quantity: line.product_quantity, direction: "out",
        unit_cost: line.product_cost_price, invoice_id: saleRef.id, note: null,
        seq: index, created_by: request.auth.uid, created_at: now,
      });
    });
    for (const id of ids) {
      const product = products.get(id).data();
      const units = product.units.map((unit) => ({ ...unit, stock_quantity: cost4(Number(unit.stock_quantity || 0) - (needs.get(`${id}||${unit.id}`) || 0)) }));
      const movementIds = movementsByProduct.get(id);
      tx.update(db.doc(`products/${id}`), { units, last_inventory_transaction_id: movementIds.at(-1), last_inventory_transaction_ids: movementIds });
    }
    if (paid > 0) {
      tx.update(db.doc("cashbox/current"), { balance: money(Number(cash.data().balance || 0) + paid), updated_at: now });
      tx.create(db.collection("cash_transactions").doc(), {
        type: "invoice_sale", direction: "in", amount: money(paid), customer_id: customerId,
        invoice_id: saleRef.id, reference_type: "invoice", reference_id: saleRef.id,
        reference_label: `فاتورة بيع لـ ${name}`, note: null, created_by: request.auth.uid, created_at: now,
      });
    }
    const result = { id: saleRef.id, receipt: { ...invoice, id: saleRef.id, edit_revision: invoiceRevision(invoice) } };
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
  const source = request.data?.source ?? "cash";
  if (!["cash", "credit"].includes(source)) fail("Invalid payment source.");
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
  const opRef = operationRef(request, source === "credit" ? "credit_settlement" : "payment");
  return db.runTransaction(async (tx) => {
    await authorize(request, tx);
    const customerRef = db.doc(`customers/${customerId}`);
    const cashRef = db.doc("cashbox/current");
    const creditRef = db.doc(`customer_credits/${customerId}`);
    const [previous, customer, funding, ...snapshots] = await Promise.all([
      tx.get(opRef), tx.get(customerRef), tx.get(source === "credit" ? creditRef : cashRef),
      ...allocations.map((item) => tx.get(db.doc(`${item.type === "invoice" ? "invoices" : "customer_loans"}/${item.reference_id}`))),
    ]);
    if (previous.exists) return previous.data().result;
    const summarySnaps = await Promise.all(allocations.map((item) => item.type === "invoice" ? tx.get(db.doc(`invoice_debt_summaries/${item.reference_id}`)) : Promise.resolve(null)));
    if (!customer.exists || !funding.exists) throw new HttpsError("failed-precondition", "Customer credit or cashbox is unavailable.");
    if (source === "credit" && money(amount) - money(funding.data().balance || 0) > 0.005) throw new HttpsError("failed-precondition", "Customer credit is insufficient.");
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
    tx.create(paymentRef, { customer_id: customerId, amount: money(amount), cash_amount: source === "cash" ? money(amount) : 0, source, allocations: allocations.map((item) => ({ type: item.type, reference_id: item.reference_id, amount: money(item.amount) })), note, created_by: request.auth.uid, created_at: now });
    tx.create(opRef, { result: { id: paymentRef.id, total: money(amount) }, created_at: now });
    if (source === "cash") tx.update(cashRef, { balance: money(Number(funding.data().balance || 0) + amount), updated_at: now });
    else {
      tx.update(creditRef, { balance: money(Number(funding.data().balance || 0) - amount), updated_at: now });
      tx.create(db.collection("customer_credit_transactions").doc(), { customer_id: customerId, debt_payment_id: paymentRef.id, type: "debt_settlement", amount: money(amount), created_by: request.auth.uid, created_at: now });
    }
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
        tx.update(snapshot.ref, {
          paid_amount: paid,
          remaining,
          debt_payment_count: FieldValue.increment(1),
          ...(source === "credit" ? { credit_used: money(Number(data.credit_used || 0) + allocation.amount) } : {}),
        });
        tx.set(db.doc(`invoice_debt_summaries/${snapshot.id}`), { paid, remaining, updated_at: now }, { merge: true });
        invoicePayments = money(invoicePayments + allocation.amount);
        const invoiceDate = data.date?.toDate?.() || new Date();
        const period = asDateKey(invoiceDate);
        accrue(period.day, period.month, {
          total_paid: source === "cash" ? money(allocation.amount) : 0, outstanding_customer_debt: -money(allocation.amount),
          paid_invoice_count: (newStatus === "paid") - (oldStatus === "paid"),
          partial_invoice_count: (newStatus === "partial") - (oldStatus === "partial"),
          unpaid_invoice_count: (newStatus === "unpaid") - (oldStatus === "unpaid"),
        });
        if (source === "cash") tx.create(db.collection("cash_transactions").doc(), {
          type: "invoice_payment", direction: "in", amount: money(allocation.amount), customer_id: customerId,
          invoice_id: snapshot.id, debt_payment_id: paymentRef.id, note, created_by: request.auth.uid,
          created_at: now, reference_type: "invoice", reference_id: snapshot.id,
          reference_label: `فاتورة بيع لـ ${customerName}`,
        });
      } else {
        tx.update(snapshot.ref, { paid_amount: paid, remaining, status: remaining <= 0 ? "paid" : "partial" });
        if (source === "cash") accrue(keys.day, keys.month, { total_paid: money(allocation.amount) });
        if (source === "cash") tx.create(db.collection("cash_transactions").doc(), {
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

Object.assign(exports, require("./staffInvoiceActions.cjs")({ db, authorize, roleOf, operationRef }));
