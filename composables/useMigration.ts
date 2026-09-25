import { collection, doc, getDocs, query, where } from "firebase/firestore";
import type { Customer } from "~/types";
import type { Invoice } from "~/types";
import type { Product } from "~/types";
import { normalizePhone } from "./finance";

const CHUNK = 100;

/** One-time, idempotent, chunked migration tools (F22). No replay of cash. */
export const useMigration = defineStore("migration", () => {
  const { db, writeBatch, serverTimestamp, readFrom } = useFirebase();
  const authStore = useAuth();

  const by = () => (authStore.currentUserKey as string) || null;

  /** Backfill invoice.customer_id by normalized phone match. Skips set/unmatched. */
  async function backfillCustomerIds(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; matched: number; skipped: number }> {
    const [invoices, customers] = await Promise.all([
      readFrom<Invoice>("invoices"),
      readFrom<Customer>("customers"),
    ]);
    const byPhone = new Map<string, string>();
    for (const c of customers) {
      const p = normalizePhone(c.phone);
      if (p && c.id && !byPhone.has(p)) byPhone.set(p, c.id);
    }
    const targets: { id: string; customer_id: string }[] = [];
    for (const inv of invoices) {
      if (!inv.id || inv.customer_id) continue;
      const hit = byPhone.get(normalizePhone(inv.customer_phone));
      if (hit) targets.push({ id: inv.id, customer_id: hit });
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

  /** Seed opening_stock inventory txns once per product (idempotent). */
  async function seedOpeningStock(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; created: number; skipped: number }> {
    const [products, existing] = await Promise.all([
      readFrom<Product>("products"),
      getDocs(query(collection(db, "inventory_transactions"), where("type", "==", "opening_stock"))),
    ]);
    const seeded = new Set(existing.docs.map((d) => String((d.data() as Record<string, unknown>).product_id || "")));
    const missing = products.filter((p) => p.id && !seeded.has(p.id));
    const now = serverTimestamp();
    for (let i = 0; i < missing.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const p of missing.slice(i, i + CHUNK)) {
        const ref = doc(collection(db, "inventory_transactions"));
        batch.set(ref, {
          type: "opening_stock",
          product_id: p.id,
          product_name: p.name,
          quantity: Number(p.count || 0),
          direction: "in",
          unit_cost: Number(p.cost_price || 0),
          note: "رصيد افتتاحي",
          created_by: by(),
          created_at: now,
        });
      }
      await batch.commit();
      onProgress?.(Math.min(i + CHUNK, missing.length), missing.length);
    }
    onProgress?.(missing.length, missing.length);
    return { total: products.length, created: missing.length, skipped: products.length - missing.length };
  }

  return { backfillCustomerIds, seedOpeningStock };
});
