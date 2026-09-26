import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import type { Customer } from "~/types";
import type { Invoice } from "~/types";
import type { Product } from "~/types";
import { normalizeName, normalizePhone, round2, toNum } from "./finance";
import { summarizeInvoice } from "./debtSummaries";

const CHUNK = 100;
const MIN_PHONE_DIGITS = 7;

function matchKey(phone: unknown, name: unknown): string | null {
  const p = normalizePhone(phone);
  if (p.length < MIN_PHONE_DIGITS) return null;
  const n = normalizeName(name);
  if (!n) return null;
  return `${p}|${n}`;
}

/** One-time, idempotent, chunked migration tools (F22). No replay of cash. */
export const useMigration = defineStore("migration", () => {
  const { db, writeBatch, serverTimestamp, readFrom } = useFirebase();
  const authStore = useAuth();

  const by = () => (authStore.currentUserKey as string) || null;

  /** Backfill invoice.customer_id ONLY on unambiguous exact matches:
   *  normalized phone (≥7 digits) + normalized name, exactly one customer.
   *  Ambiguous or unreliable → left null. Never guesses. */
  async function backfillCustomerIds(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; matched: number; skipped: number }> {
    const [invoices, customers] = await Promise.all([
      readFrom<Invoice>("invoices"),
      readFrom<Customer>("customers"),
    ]);
    const index = new Map<string, string[]>();
    for (const c of customers) {
      if (!c.id) continue;
      const k = matchKey(c.phone, c.name);
      if (!k) continue;
      if (!index.has(k)) index.set(k, []);
      index.get(k)!.push(c.id);
    }
    const targets: { id: string; customer_id: string }[] = [];
    for (const inv of invoices) {
      if (!inv.id || inv.customer_id) continue;
      const k = matchKey(inv.customer_phone, inv.customer_name);
      if (!k) continue;
      const hits = index.get(k) ?? [];
      if (hits.length === 1 && hits[0]) targets.push({ id: inv.id, customer_id: hits[0] });
    }
    let done = 0;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const t of targets.slice(i, i + CHUNK)) {
        batch.update(doc(db, "invoices", t.id), { customer_id: t.customer_id });
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
    const invoices = await readFrom<Invoice>("invoices");
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
      const invKey = matchKey(inv.customer_phone, inv.customer_name);
      const cusKey = c ? matchKey(c.phone, c.name) : null;
      if (!c || !invKey || !cusKey || invKey !== cusKey) {
        toClear.push(inv.id as string);
      }
      done += 1;
      if (done % 20 === 0) onProgress?.(done, linked.length);
    }
    for (let i = 0; i < toClear.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const id of toClear.slice(i, i + CHUNK)) {
        batch.update(doc(db, "invoices", id), { customer_id: null });
      }
      await batch.commit();
    }
    onProgress?.(linked.length, linked.length);
    return { reviewed: linked.length, kept: linked.length - toClear.length, cleared: toClear.length };
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
    const products = await readFrom<Product>("products");
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
        if (!seeded.has(e.product_id)) {
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
        } else {
          batch.update(doc(db, "products", e.product_id), {
            stock_quantity: round2(toNum(e.quantity)),
            low_stock_threshold: threshold,
          });
        }
        set += 1;
      }
      await batch.commit();
      onProgress?.(Math.min(i + CHUNK, valid.length), valid.length);
    }
    onProgress?.(valid.length, valid.length);
    return { total: valid.length, set, skipped: valid.length - set };
  }

  /** Backfill debt summaries for ALL invoices missing them (idempotent).
   *  Legacy invoices (no paid state) get paid 0 / remaining 0 — they stay
   *  out of the debt book by rule while contributing to sales/profit totals. */
  async function backfillDebtSummaries(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; created: number; skipped: number }> {
    const [invoices, existing] = await Promise.all([
      readFrom<Invoice>("invoices"),
      getDocs(collection(db, "invoice_debt_summaries")),
    ]);
    const have = new Set(existing.docs.map((d) => d.id));
    const targets = invoices.filter((inv) => inv.id && !have.has(inv.id));
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
    return { total: invoices.length, created: targets.length, skipped: invoices.length - targets.length };
  }

  return { backfillCustomerIds, repairCustomerLinks, setOpeningStocks, backfillDebtSummaries };
});
