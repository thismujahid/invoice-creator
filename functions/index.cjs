const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");

require("./runtime.cjs");
const db = getFirestore();
const adminEmail = "mohamed.mojahead@gmail.com";
const resetCollections = [
  "invoices", "invoice_debt_summaries", "invoice_returns", "customer_loans",
  "debt_payments", "supplier_payments", "supplier_advances",
  "supplier_advance_transactions", "purchase_invoices", "supplier_returns",
  "inventory_transactions", "inventory_cost_adjustments", "cash_transactions",
  "operation_requests",
  "customer_credits", "customer_credit_transactions",
  "customer_summaries", "supplier_summaries", "store_stats",
  "invoice_stats_daily", "invoice_stats_monthly",
];
const stages = [...resetCollections, "products", "supplier_seed", "customer_seed", "stats_seed", "cashbox"];
const jobRef = db.doc("system_jobs/factory_reset");
Object.assign(exports, require("./staff.cjs"));

async function updateJob(changes) {
  await jobRef.set({ ...changes, updated_at: FieldValue.serverTimestamp() }, { merge: true });
}

async function resetProductPage(cursor) {
  let query = db.collection("products").orderBy(FieldPath.documentId()).limit(200);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) return { size: 0, cursor };
  const batch = db.batch();
  for (const item of page.docs) {
    const data = item.data();
    const units = Array.isArray(data.units) ? data.units.map((unit) => {
      const { stock_quantity: _sq, average_cost: _ac, low_stock_threshold: _lt, ...rest } = unit;
      void _sq; void _ac; void _lt;
      return { ...rest, selling_price: null, purchase_price: null };
    }) : [];
    const closedPackages = Object.fromEntries(units.filter((unit) => unit.stock_kind === "package").map((unit) => [unit.id, 0]));
    batch.update(item.ref, {
      inventory: { loose_base_quantity: 0, closed_packages: closedPackages },
      stock_quantity: FieldValue.delete(),
      average_cost: FieldValue.delete(),
      price: FieldValue.delete(),
      cost_price: null,
      units,
      count: FieldValue.delete(),
      last_inventory_transaction_id: FieldValue.delete(),
      last_inventory_transaction_ids: FieldValue.delete(),
      last_purchase_invoice_id: FieldValue.delete(),
      last_cost_adjustment_id: FieldValue.delete(),
    });
  }
  await batch.commit();
  return { size: page.size, cursor: page.docs.at(-1).id };
}

async function seedSummaries(source, destination, cursor) {
  let query = db.collection(source).orderBy(FieldPath.documentId()).limit(200);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) return { size: 0, cursor };
  const batch = db.batch();
  for (const item of page.docs) {
    const data = item.data();
    if (source === "suppliers") {
      batch.set(db.doc(`${destination}/${item.id}`), {
        supplier_id: item.id,
        supplier_name: data.name || null,
        invoice_count: 0,
        total_purchases: 0,
        outstanding_payable: 0,
        advance_receivable: 0,
        initialized: true,
        updated_at: FieldValue.serverTimestamp(),
      });
    } else {
      batch.set(db.doc(`${destination}/${item.id}`), {
        customer_id: item.id,
        customer_name: data.name || null,
        customer_phone: data.phone || null,
        invoice_count: 0,
        total_sales: 0,
        outstanding_debt: 0,
        initialized: true,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
  }
  await batch.commit();
  return { size: page.size, cursor: page.docs.at(-1).id };
}

exports.factoryReset = onCall({ timeoutSeconds: 3600, maxInstances: 1, concurrency: 1 }, async (request) => {
  if (request.auth?.token.email !== adminEmail) throw new HttpsError("permission-denied", "Admin access is required.");
  const requestId = request.data?.requestId;
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new HttpsError("invalid-argument", "Reset request is invalid.");
  let job = (await jobRef.get()).data();
  if (job?.request_id === requestId && job.status === "done") return { collections: resetCollections.length, documents: job.processed || 0 };
  if (job?.status === "done") job = null;
  if (!job) {
    let total = 0;
    for (const name of resetCollections) total += (await db.collection(name).count().get()).data().count;
    total += (await db.collection("products").count().get()).data().count;
    await jobRef.set({ request_id: requestId, status: "running", stage: 0, cursor: null, processed: 0, total, started_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() });
    job = (await jobRef.get()).data();
  }
  if (job.status !== "running") throw new HttpsError("failed-precondition", "Reset state is invalid.");
  let stage = job.stage;
  let cursor = job.cursor || null;
  let processed = job.processed || 0;
  while (stage < stages.length) {
    const name = stages[stage];
    let size = 0;
    let nextCursor = cursor;
    if (resetCollections.includes(name)) {
      const page = await db.collection(name).limit(200).get();
      size = page.size;
      if (size) {
        const batch = db.batch();
        for (const item of page.docs) batch.delete(item.ref);
        await batch.commit();
      }
    } else if (name === "products") {
      ({ size, cursor: nextCursor } = await resetProductPage(cursor));
    } else if (name === "supplier_seed") {
      ({ size, cursor: nextCursor } = await seedSummaries("suppliers", "supplier_summaries", cursor));
    } else if (name === "customer_seed") {
      ({ size, cursor: nextCursor } = await seedSummaries("customers", "customer_summaries", cursor));
    } else if (name === "stats_seed") {
      const customers = (await db.collection("customers").count().get()).data().count;
      await db.doc("store_stats/current").set({ customer_count: customers, invoice_count: 0, gross_sales: 0, total_sales: 0, total_discount: 0, total_paid: 0, outstanding_customer_debt: 0, total_cost: 0, total_profit: 0, return_count: 0, returns_total: 0, paid_invoice_count: 0, partial_invoice_count: 0, unpaid_invoice_count: 0, initialized: true, updated_at: FieldValue.serverTimestamp() });
    } else {
      await db.doc("cashbox/current").set({ balance: 0, updated_at: FieldValue.serverTimestamp() });
    }
    if (size) {
      processed += size;
      cursor = nextCursor;
      await updateJob({ stage, cursor, processed, collection: name });
    } else {
      stage += 1;
      cursor = null;
      await updateJob({ stage, cursor, processed, collection: stages[stage] || null });
    }
  }
  await updateJob({ status: "done", stage, cursor: null, processed, collection: null });
  return { collections: resetCollections.length, documents: processed };
});
