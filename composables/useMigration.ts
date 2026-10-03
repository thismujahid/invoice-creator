import { collection, doc, getCountFromServer, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import type { Customer } from "~/types";
import type { Invoice } from "~/types";
import type { Product, ProductUnit } from "~/types";
import type { PurchaseInvoice, Supplier } from "~/types/finance";
import { ADMIN_EMAIL } from "~/constants/auth";
import { deriveSupplierInvoiceStatus } from "~/types/finance";
import { normalizeName, normalizePhone, round2, toNum } from "./finance";
import { summarizeInvoice } from "./debtSummaries";
import { customerSummaryId } from "./performanceSummaries";
import { invoiceDayKey, invoiceMonthKey, invoiceStatsOf, sumInvoiceStats } from "./invoiceStats";

const CHUNK = 100;
const MIN_PHONE_DIGITS = 7;

/** Customer/invoice link keys: normalized phone + name, with Egypt
 *  mobile country-code variants (01… ↔ 201…). Matching always requires
 *  exactly one unambiguous customer across all variants. */
function phoneVariants(phone: unknown): string[] {
  const digits = normalizePhone(phone);
  if (digits.length < MIN_PHONE_DIGITS) return [];
  const variants = new Set<string>([digits]);
  if (digits.length === 12 && digits.startsWith("20")) variants.add(`0${digits.slice(2)}`);
  if (digits.length === 14 && digits.startsWith("0020")) variants.add(`0${digits.slice(4)}`);
  if (digits.length === 11 && digits.startsWith("01")) variants.add(`20${digits.slice(1)}`);
  return [...variants];
}

function matchKeys(phone: unknown, name: unknown): string[] {
  const n = normalizeName(name);
  if (!n) return [];
  return phoneVariants(phone).map((p) => `${p}|${n}`);
}

function pushUnique(index: Map<string, string[]>, key: string, id: string): void {
  if (!index.has(key)) index.set(key, []);
  const bucket = index.get(key)!;
  if (!bucket.includes(id)) bucket.push(id);
}

/** One-time, idempotent, chunked migration tools (F22). No replay of cash. */
export const useMigration = defineStore("migration", () => {
  const { auth, db, writeBatch, serverTimestamp } = useFirebase();
  const authStore = useAuth();

  const by = () => (authStore.currentUserKey as string) || null;
  async function readAll<T extends { id?: string }>(collectionName: string): Promise<T[]> {
    const snapshot = await getDocs(collection(db, collectionName));
    return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as object) }) as T);
  }

  /** Backfill invoice.customer_id ONLY on unambiguous matches.
   *  Pass 1: normalized phone (country-code variants tolerated) + name.
   *  Pass 2 (phone-only): the invoice phone belongs to exactly one
   *  customer — covers old invoices whose saved name differs slightly.
   *  Ambiguous → left null. Never guesses. */
  async function backfillCustomerIds(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; matched: number; skipped: number }> {
    const [invoices, customers, debtSummaries] = await Promise.all([
      readAll<Invoice>("invoices"),
      readAll<Customer>("customers"),
      getDocs(collection(db, "invoice_debt_summaries")),
    ]);
    const existingDebtSummaryIds = new Set(debtSummaries.docs.map((item) => item.id));
    const index = new Map<string, string[]>();
    const phoneIndex = new Map<string, string[]>();
    for (const c of customers) {
      if (!c.id) continue;
      for (const k of matchKeys(c.phone, c.name)) pushUnique(index, k, c.id);
      for (const p of phoneVariants(c.phone)) pushUnique(phoneIndex, p, c.id);
    }
    const targets: { id: string; customer_id: string }[] = [];
    for (const inv of invoices) {
      if (!inv.id || inv.customer_id) continue;
      const hits = new Set<string>();
      for (const k of matchKeys(inv.customer_phone, inv.customer_name)) {
        for (const id of index.get(k) ?? []) hits.add(id);
      }
      if (hits.size === 1) {
        const only = [...hits][0];
        if (only) targets.push({ id: inv.id, customer_id: only });
        continue;
      }
      if (hits.size > 1) continue; // ambiguous: never guess
      const phoneHits = new Set<string>();
      for (const p of phoneVariants(inv.customer_phone)) {
        for (const id of phoneIndex.get(p) ?? []) phoneHits.add(id);
      }
      if (phoneHits.size === 1) {
        const only = [...phoneHits][0];
        if (only) targets.push({ id: inv.id, customer_id: only });
      }
    }
    let done = 0;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const t of targets.slice(i, i + CHUNK)) {
        batch.update(doc(db, "invoices", t.id), { customer_id: t.customer_id });
        if (existingDebtSummaryIds.has(t.id)) {
          batch.update(doc(db, "invoice_debt_summaries", t.id), { customer_id: t.customer_id });
        }
      }
      await batch.commit();
      done = Math.min(i + CHUNK, targets.length);
      onProgress?.(done, targets.length);
    }
    onProgress?.(targets.length, targets.length);
    return { total: invoices.length, matched: targets.length, skipped: invoices.length - targets.length };
  }

  /** Repair pass: re-validates every backfilled link with the same strict
   *  rule and clears obviously invalid ones (wrong customer, short/
   *  placeholder phones, name mismatch, dangling ids). Idempotent. */
  async function repairCustomerLinks(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ reviewed: number; kept: number; cleared: number }> {
    const [invoices, customers, debtSummaries] = await Promise.all([
      readAll<Invoice>("invoices"),
      readAll<Customer>("customers"),
      getDocs(collection(db, "invoice_debt_summaries")),
    ]);
    const phoneIndex = new Map<string, string[]>();
    for (const c of customers) {
      if (!c.id) continue;
      for (const p of phoneVariants(c.phone)) pushUnique(phoneIndex, p, c.id);
    }
    const existingDebtSummaryIds = new Set(debtSummaries.docs.map((item) => item.id));
    const linked = invoices.filter((inv) => inv.id && inv.customer_id);
    const cache = new Map<string, Customer | null>();
    async function getCustomer(id: string): Promise<Customer | null> {
      if (!cache.has(id)) {
        const snap = await getDoc(doc(db, "customers", id));
        cache.set(id, snap.exists() ? ({ id: snap.id, ...(snap.data() as object) }) as Customer : null);
      }
      return cache.get(id) ?? null;
    }
    const toClear: string[] = [];
    let done = 0;
    for (const inv of linked) {
      const c = await getCustomer(inv.customer_id as string);
      // Same tolerant rule as the backfill (country-code variants share a
      // key): a link is valid if invoice and customer share at least one.
      const invKeys = new Set(matchKeys(inv.customer_phone, inv.customer_name));
      const cusKeys = c ? matchKeys(c.phone, c.name) : [];
      const overlap = cusKeys.some((k) => invKeys.has(k));
      // Phone-only links (backfilled when the saved name differs) stay
      // valid if the invoice phone is uniquely owned by this customer.
      let phoneUnique = false;
      if (!overlap && c?.id) {
        const owners = new Set<string>();
        for (const p of phoneVariants(inv.customer_phone)) {
          for (const id of phoneIndex.get(p) ?? []) owners.add(id);
        }
        phoneUnique = owners.size === 1 && owners.has(c.id);
      }
      if (!c || invKeys.size === 0 || (!overlap && !phoneUnique)) {
        toClear.push(inv.id as string);
      }
      done += 1;
      if (done % 20 === 0) onProgress?.(done, linked.length);
    }
    for (let i = 0; i < toClear.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const id of toClear.slice(i, i + CHUNK)) {
        batch.update(doc(db, "invoices", id), { customer_id: null });
        if (existingDebtSummaryIds.has(id)) batch.update(doc(db, "invoice_debt_summaries", id), { customer_id: null });
      }
      await batch.commit();
    }
    onProgress?.(linked.length, linked.length);
    return { reviewed: linked.length, kept: linked.length - toClear.length, cleared: toClear.length };
  }

  /** Normalize phone storage to strings (invoices.customer_phone +
   *  customers.phone). Firestore `==` is type-strict and numeric storage
   *  loses leading zeros, silently breaking customer invoice filters and
   *  summary matching. Idempotent: only non-string phones are touched. */
  async function normalizeCustomerPhones(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ invoices: number; customers: number }> {
    const [invoices, customers] = await Promise.all([
      readAll<Invoice>("invoices"),
      readAll<Customer>("customers"),
    ]);
    const invoiceTargets = invoices.filter(
      (inv) => inv.id && inv.customer_phone !== null && inv.customer_phone !== undefined && typeof inv.customer_phone !== "string",
    );
    const customerTargets = customers.filter(
      (c) => c.id && c.phone !== null && c.phone !== undefined && typeof c.phone !== "string",
    );
    const writes: { collectionName: string; id: string; phone: string }[] = [];
    for (const inv of invoiceTargets) {
      if (inv.id) writes.push({ collectionName: "invoices", id: inv.id, phone: String(inv.customer_phone ?? "").trim() });
    }
    for (const c of customerTargets) {
      if (c.id) writes.push({ collectionName: "customers", id: c.id, phone: String(c.phone ?? "").trim() });
    }
    for (let i = 0; i < writes.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const w of writes.slice(i, i + CHUNK)) {
        batch.update(doc(db, w.collectionName, w.id), {
          [w.collectionName === "invoices" ? "customer_phone" : "phone"]: w.phone,
        });
      }
      await batch.commit();
      onProgress?.(Math.min(i + CHUNK, writes.length), writes.length);
    }
    onProgress?.(writes.length, writes.length);
    return { invoices: invoiceTargets.length, customers: customerTargets.length };
  }

  /** Explicit opening-stock entry (R4): sets stock_quantity only for products
   *  lacking it, plus one opening_stock audit record each. Idempotent. */
  async function setOpeningStocks(
    entries: { product_id: string; quantity: number; unit_cost?: number | null; low_stock_threshold?: number | null }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; set: number; skipped: number }> {
    const valid = entries.filter((e) => e.product_id && Number.isFinite(e.quantity) && e.quantity >= 0);
    const existing = await getDocs(
      query(collection(db, "inventory_transactions"), where("type", "==", "opening_stock")),
    );
    const seeded = new Set(existing.docs.map((d) => String((d.data() as Record<string, unknown>).product_id || "")));
    const products = await readAll<Product>("products");
    const byId = new Map(products.map((p) => [p.id, p]));
    const now = serverTimestamp();
    let set = 0;
    for (let i = 0; i < valid.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const e of valid.slice(i, i + CHUNK)) {
        const p = byId.get(e.product_id);
        if (!p) continue;
        if (p.stock_quantity !== null && p.stock_quantity !== undefined) continue;
        const threshold = e.low_stock_threshold ?? p.low_stock_threshold ?? 5;
        if (!Number.isFinite(threshold) || threshold < 0) continue;
        if (seeded.has(e.product_id)) continue;
        const quantity = round2(toNum(e.quantity));
        if (quantity > 0) {
          const ref = doc(collection(db, "inventory_transactions"));
          batch.update(doc(db, "products", e.product_id), {
            stock_quantity: quantity,
            low_stock_threshold: threshold,
            last_inventory_transaction_id: ref.id,
            last_inventory_transaction_ids: [ref.id],
          });
          batch.set(ref, {
            type: "opening_stock",
            product_id: e.product_id,
            product_name: p.name,
            quantity,
            direction: "in",
            unit_cost: e.unit_cost ?? toNum(p.cost_price),
            note: "رصيد افتتاحي",
            created_by: by(),
            created_at: now,
          });
        } else {
          batch.update(doc(db, "products", e.product_id), {
            stock_quantity: 0,
            low_stock_threshold: threshold,
          });
        }
        seeded.add(e.product_id);
        set += 1;
      }
      await batch.commit();
      onProgress?.(Math.min(i + CHUNK, valid.length), valid.length);
    }
    onProgress?.(valid.length, valid.length);
    return { total: valid.length, set, skipped: valid.length - set };
  }

  /** Rebuild every invoice debt summary from its source invoice. */
  async function backfillDebtSummaries(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; rebuilt: number }> {
    const invoices = await readAll<Invoice>("invoices");
    const targets = invoices.filter((inv) => inv.id);
    const now = serverTimestamp();
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const inv of targets.slice(i, i + CHUNK)) {
        const s = summarizeInvoice(inv);
        batch.set(doc(db, "invoice_debt_summaries", inv.id as string), {
          invoice_id: inv.id,
          customer_id: inv.customer_id || null,
          customer_name: inv.customer_name ?? null,
          customer_phone: (inv.customer_phone as string | number | null) ?? null,
          date: (inv.date as unknown) ?? null,
          ...s,
          created_at: now,
        });
      }
      await batch.commit();
      onProgress?.(Math.min(i + CHUNK, targets.length), targets.length);
    }
    onProgress?.(targets.length, targets.length);
    return { total: invoices.length, rebuilt: targets.length };
  }

  /** Explicit admin-only and intentionally expensive one-time historical backfill. */
  async function backfillPerformanceSummaries(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ invoices: number; customers: number; customerSummaries: number; debtSummaries: number; supplierInvoices: number; suppliers: number; dailyStats: number; monthlyStats: number; returns: number; returnsTotal: number }> {
    if (auth.currentUser?.email !== ADMIN_EMAIL) throw new Error("Admin access is required to rebuild performance summaries.");
    const [invoices, customers, purchaseInvoices, suppliers, existingDebtSummaries, existingCustomerSummaries, existingSupplierSummaries, returnSnapshots, existingDaily, existingMonthly] = await Promise.all([
      readAll<Invoice>("invoices"),
      readAll<Customer>("customers"),
      readAll<PurchaseInvoice>("purchase_invoices"),
      readAll<Supplier>("suppliers"),
      getDocs(collection(db, "invoice_debt_summaries")),
      getDocs(collection(db, "customer_summaries")),
      getDocs(collection(db, "supplier_summaries")),
      getDocs(collection(db, "invoice_returns")),
      getDocs(collection(db, "invoice_stats_daily")),
      getDocs(collection(db, "invoice_stats_monthly")),
    ]);
    const invoiceIds = new Set(invoices.map((invoice) => invoice.id).filter((id): id is string => !!id));
    const aggregates = new Map<string, { customer_id: string | null; customer_name: string | null; customer_phone: string | number | null; invoice_count: number; total_sales: number; outstanding_debt: number }>();
    for (const customer of customers) {
      if (!customer.id) continue;
      aggregates.set(customer.id, { customer_id: customer.id, customer_name: customer.name, customer_phone: customer.phone ?? null, invoice_count: 0, total_sales: 0, outstanding_debt: 0 });
    }
    let storeStats = invoiceStatsOf(null);
    const dailyStats = new Map<string, ReturnType<typeof invoiceStatsOf>>();
    const monthlyStats = new Map<string, ReturnType<typeof invoiceStatsOf>>();
    for (const invoice of invoices) {
      const totals = summarizeInvoice(invoice);
      const contribution = invoiceStatsOf(invoice);
      storeStats = sumInvoiceStats(storeStats, contribution);
      const dayKey = invoiceDayKey(invoice);
      const monthKey = invoiceMonthKey(invoice);
      if (dayKey) dailyStats.set(dayKey, sumInvoiceStats(dailyStats.get(dayKey) ?? {}, contribution));
      if (monthKey) monthlyStats.set(monthKey, sumInvoiceStats(monthlyStats.get(monthKey) ?? {}, contribution));
      const id = customerSummaryId(invoice);
      if (!id) continue;
      const aggregate = aggregates.get(id) ?? {
        customer_id: invoice.customer_id ?? null,
        customer_name: invoice.customer_name ?? null,
        customer_phone: invoice.customer_phone ?? null,
        invoice_count: 0,
        total_sales: 0,
        outstanding_debt: 0,
      };
      aggregate.invoice_count += 1;
      aggregate.total_sales = round2(aggregate.total_sales + totals.total);
      aggregate.outstanding_debt = round2(aggregate.outstanding_debt + totals.remaining);
      aggregates.set(id, aggregate);
    }
    let returnsTotal = 0;
    for (const returnSnapshot of returnSnapshots.docs) {
      const returned = returnSnapshot.data() as { invoice_id?: string; total_refund?: number; created_at?: unknown };
      const total = round2(toNum(returned.total_refund));
      returnsTotal = round2(returnsTotal + total);
      storeStats = sumInvoiceStats(storeStats, { return_count: 1, returns_total: total });
      const delta = { return_count: 1, returns_total: total };
      const returnDate = returned.created_at ? { date: returned.created_at } : null;
      const dayKey = returnDate ? invoiceDayKey(returnDate) : null;
      const monthKey = returnDate ? invoiceMonthKey(returnDate) : null;
      if (dayKey) dailyStats.set(dayKey, sumInvoiceStats(dailyStats.get(dayKey) ?? {}, delta));
      if (monthKey) monthlyStats.set(monthKey, sumInvoiceStats(monthlyStats.get(monthKey) ?? {}, delta));
    }
    const supplierAggregates = new Map<string, { supplier_id: string; supplier_name: string; invoice_count: number; total_purchases: number; outstanding_payable: number }>();
    for (const supplier of suppliers) if (supplier.id) supplierAggregates.set(supplier.id, { supplier_id: supplier.id, supplier_name: supplier.name, invoice_count: 0, total_purchases: 0, outstanding_payable: 0 });
    const suppliersByName = new Map<string, Supplier[]>();
    for (const supplier of suppliers) {
      const name = normalizeName(supplier.name);
      if (!name) continue;
      const matches = suppliersByName.get(name) ?? [];
      matches.push(supplier);
      suppliersByName.set(name, matches);
    }
    for (const invoice of purchaseInvoices) {
      const supplier = invoice.supplier_id
        ? suppliers.find((item) => item.id === invoice.supplier_id)
        : (suppliersByName.get(normalizeName(invoice.supplier_name)) ?? []).length === 1
          ? suppliersByName.get(normalizeName(invoice.supplier_name))?.[0]
          : undefined;
      if (!supplier?.id) continue;
      const aggregate = supplierAggregates.get(supplier.id) ?? { supplier_id: supplier.id, supplier_name: supplier.name, invoice_count: 0, total_purchases: 0, outstanding_payable: 0 };
      aggregate.invoice_count += 1;
      aggregate.total_purchases = round2(aggregate.total_purchases + toNum(invoice.total_amount));
      aggregate.outstanding_payable = round2(aggregate.outstanding_payable + toNum(invoice.remaining_amount));
      supplierAggregates.set(supplier.id, aggregate);
    }
    const docs = [...aggregates.entries()];
    const supplierDocs = [...supplierAggregates.entries()];
    const currentCustomerSummaryIds = new Set(aggregates.keys());
    const currentSupplierSummaryIds = new Set(supplierAggregates.keys());
    const staleSummaryDocs = [
      ...existingDebtSummaries.docs.filter((snapshot) => !invoiceIds.has(snapshot.id)).map((snapshot) => ({ collection: "invoice_debt_summaries", id: snapshot.id })),
      ...existingCustomerSummaries.docs.filter((snapshot) => !currentCustomerSummaryIds.has(snapshot.id)).map((snapshot) => ({ collection: "customer_summaries", id: snapshot.id })),
      ...existingSupplierSummaries.docs.filter((snapshot) => !currentSupplierSummaryIds.has(snapshot.id)).map((snapshot) => ({ collection: "supplier_summaries", id: snapshot.id })),
    ];
    const currentDailyIds = new Set(dailyStats.keys());
    const currentMonthlyIds = new Set(monthlyStats.keys());
    const stalePeriods = [
      ...existingDaily.docs.filter((snapshot) => !currentDailyIds.has(snapshot.id)).map((snapshot) => ({ collection: "invoice_stats_daily", id: snapshot.id })),
      ...existingMonthly.docs.filter((snapshot) => !currentMonthlyIds.has(snapshot.id)).map((snapshot) => ({ collection: "invoice_stats_monthly", id: snapshot.id })),
    ];
    const periodDocs = dailyStats.size + monthlyStats.size;
    const totalWrites = docs.length + supplierDocs.length + invoices.filter((invoice) => invoice.id).length + periodDocs + stalePeriods.length + staleSummaryDocs.length + 1;
    let completed = 0;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const [id, data] of docs.slice(i, i + CHUNK)) {
        batch.set(doc(db, "customer_summaries", id), { ...data, initialized: true, updated_at: serverTimestamp() });
      }
      await batch.commit();
      completed += Math.min(CHUNK, docs.length - i);
      onProgress?.(completed, totalWrites);
    }
    for (let i = 0; i < supplierDocs.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const [id, data] of supplierDocs.slice(i, i + CHUNK)) batch.set(doc(db, "supplier_summaries", id), { ...data, initialized: true, updated_at: serverTimestamp() });
      await batch.commit();
      completed += Math.min(CHUNK, supplierDocs.length - i);
      onProgress?.(completed, totalWrites);
    }
    const debtSummariesToWrite = invoices.filter((invoice) => invoice.id);
    for (let i = 0; i < debtSummariesToWrite.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const invoice of debtSummariesToWrite.slice(i, i + CHUNK)) {
        const totals = summarizeInvoice(invoice);
        batch.set(doc(db, "invoice_debt_summaries", invoice.id as string), {
          invoice_id: invoice.id,
          customer_id: invoice.customer_id || null,
          customer_name: invoice.customer_name ?? null,
          customer_phone: (invoice.customer_phone as string | number | null) ?? null,
          date: (invoice.date as unknown) ?? null,
          ...totals,
          created_at: serverTimestamp(),
        });
      }
      await batch.commit();
      completed += Math.min(CHUNK, debtSummariesToWrite.length - i);
      onProgress?.(completed, totalWrites);
    }
    const periodEntries = [
      ...[...dailyStats.entries()].map(([id, data]) => ({ collection: "invoice_stats_daily", id, data })),
      ...[...monthlyStats.entries()].map(([id, data]) => ({ collection: "invoice_stats_monthly", id, data })),
    ];
    for (let i = 0; i < periodEntries.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const entry of periodEntries.slice(i, i + CHUNK)) {
        batch.set(doc(db, entry.collection, entry.id), { ...entry.data, updated_at: serverTimestamp() });
      }
      await batch.commit();
      completed += Math.min(CHUNK, periodEntries.length - i);
      onProgress?.(completed, totalWrites);
    }
    for (let i = 0; i < stalePeriods.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const entry of stalePeriods.slice(i, i + CHUNK)) batch.delete(doc(db, entry.collection, entry.id));
      await batch.commit();
      completed += Math.min(CHUNK, stalePeriods.length - i);
      onProgress?.(completed, totalWrites);
    }
    for (let i = 0; i < staleSummaryDocs.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const entry of staleSummaryDocs.slice(i, i + CHUNK)) batch.delete(doc(db, entry.collection, entry.id));
      await batch.commit();
      completed += Math.min(CHUNK, staleSummaryDocs.length - i);
      onProgress?.(completed, totalWrites);
    }
    const statsBatch = writeBatch(db);
    statsBatch.set(doc(db, "store_stats", "current"), {
      ...storeStats,
      customer_count: customers.length,
      initialized: true,
      updated_at: serverTimestamp(),
    });
    await statsBatch.commit();
    onProgress?.(totalWrites, totalWrites);
    return { invoices: invoices.length, customers: customers.length, customerSummaries: docs.length, debtSummaries: debtSummariesToWrite.length, supplierInvoices: purchaseInvoices.length, suppliers: suppliers.length, dailyStats: dailyStats.size, monthlyStats: monthlyStats.size, returns: returnSnapshots.size, returnsTotal };
  }

  /** Backfill per-unit pricing: ensures every product has a units[] array
   *  with a base entry carrying selling_price (+purchase_price mirror).
   *  Legacy docs without units get a synthesized base; existing additional
   *  units keep purchase_price null until their first real purchase.
   *  Idempotent: only writes when something is missing. */
  async function backfillProductUnits(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; updated: number; skipped: number }> {
    const products = await readAll<Product>("products");
    const targets: { id: string; units: ProductUnit[]; patch: Record<string, unknown> }[] = [];
    for (const p of products) {
      if (!p.id) continue;
      const baseId = p.base_unit_id || "base";
      const baseName = (p.base_unit_name || "وحدة").trim() || "وحدة";
      const configured = Array.isArray(p.units) ? p.units.filter((u) => u && Number.isFinite(Number(u.factor)) && Number(u.factor) > 0) : [];
      const baseEntry = configured.find((u) => u.is_base) ?? configured.find((u) => u.id === baseId) ?? null;
      const needBase =
        !baseEntry ||
        baseEntry.selling_price === null ||
        baseEntry.selling_price === undefined ||
        baseEntry.purchase_price === null ||
        baseEntry.purchase_price === undefined;
      if (configured.length && !needBase) continue;
      const units: ProductUnit[] = [
        {
          id: baseEntry?.id || baseId,
          name: (baseEntry?.name || baseName).trim() || "وحدة",
          factor: 1,
          selling_price: baseEntry?.selling_price ?? p.price ?? null,
          purchase_price: baseEntry?.purchase_price ?? p.cost_price ?? null,
          is_base: true,
          can_purchase: baseEntry?.can_purchase ?? true,
          can_sell: true,
        },
        ...configured
          .filter((u) => u !== baseEntry && !u.is_base && u.id !== (baseEntry?.id || baseId))
          .map((u) => ({
            id: u.id,
            name: (u.name || "").trim(),
            factor: Number(u.factor),
            selling_price: u.selling_price ?? null,
            purchase_price: u.purchase_price ?? null,
            is_base: false,
            can_purchase: u.can_purchase ?? true,
            can_sell: u.can_sell ?? false,
          })),
      ];
      const patch: Record<string, unknown> = { units };
      if (!p.base_unit_id) patch.base_unit_id = baseId;
      if (!p.base_unit_name) patch.base_unit_name = baseName;
      targets.push({ id: p.id, units, patch });
    }
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const t of targets.slice(i, i + CHUNK)) {
        batch.update(doc(db, "products", t.id), t.patch);
      }
      await batch.commit();
      onProgress?.(Math.min(i + CHUNK, targets.length), targets.length);
    }
    onProgress?.(targets.length, targets.length);
    return { total: products.length, updated: targets.length, skipped: products.length - targets.length };
  }

  /** Explicit admin migration: intentionally scans purchase invoices once, then updates only missing or invalid status fields. */
  async function backfillSupplierInvoiceStatuses(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; updated: number; skipped: number }> {
    const invoices = await readAll<PurchaseInvoice>("purchase_invoices");
    const targets = invoices.filter((invoice) =>
      invoice.id && invoice.status !== "paid" && invoice.status !== "partial" && invoice.status !== "unpaid",
    );
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const invoice of targets.slice(i, i + CHUNK)) {
        batch.update(doc(db, "purchase_invoices", invoice.id as string), {
          status: deriveSupplierInvoiceStatus(invoice.paid_amount, invoice.remaining_amount, invoice.total_amount),
        });
      }
      await batch.commit();
      onProgress?.(Math.min(i + CHUNK, targets.length), targets.length);
    }
    onProgress?.(targets.length, targets.length);
    return { total: invoices.length, updated: targets.length, skipped: invoices.length - targets.length };
  }

  /** FACTORY RESET: deletes EVERY document in ALL app collections.
   *  Admin-only (callers must verify the password first), chunked,
   *  idempotent. There is no undo — the UI confirms twice. Auth users are
   *  NOT touched (Firebase Auth is separate from Firestore). */
  const FACTORY_RESET_COLLECTIONS = [
    "invoices",
    "invoice_debt_summaries",
    "invoice_returns",
    "customers",
    "customer_summaries",
    "customer_loans",
    "debt_payments",
    "suppliers",
    "supplier_summaries",
    "supplier_payments",
    "purchase_invoices",
    "products",
    "inventory_transactions",
    "inventory_cost_adjustments",
    "cash_transactions",
    "cashbox",
    "store_stats",
    "invoice_stats_daily",
    "invoice_stats_monthly",
  ];
  async function factoryReset(
    onProgress?: (done: number, total: number, collectionName: string) => void,
  ): Promise<{ collections: number; documents: number }> {
    if (auth.currentUser?.email !== ADMIN_EMAIL) throw new Error("Admin access is required.");
    const BATCH = 400;
    let documents = 0;
    let collectionsDone = 0;
    // Cheap count pass (aggregation, no doc reads) so progress has a total.
    let total = 0;
    for (const name of FACTORY_RESET_COLLECTIONS) {
      total += (await getCountFromServer(collection(db, name))).data().count;
    }
    onProgress?.(0, total, "");
    for (const name of FACTORY_RESET_COLLECTIONS) {
      for (;;) {
        const snap = await getDocs(query(collection(db, name), limit(BATCH)));
        if (snap.empty) break;
        const batch = writeBatch(db);
        for (const d of snap.docs) batch.delete(d.ref);
        await batch.commit();
        documents += snap.size;
        onProgress?.(documents, total, name);
        if (snap.size < BATCH) break;
      }
      collectionsDone += 1;
    }
    onProgress?.(total, total, "");
    return { collections: collectionsDone, documents };
  }

  return { backfillCustomerIds, repairCustomerLinks, normalizeCustomerPhones, backfillProductUnits, factoryReset, setOpeningStocks, backfillDebtSummaries, backfillPerformanceSummaries, backfillSupplierInvoiceStatuses };
});
