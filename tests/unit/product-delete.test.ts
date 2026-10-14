import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const makeOperations = require("../../functions/inventoryOperations.cjs");

/** In-memory Firestore double: query-aware get (== / array-contains /
 *  limit), deferred writes applied only when the action resolves, so a
 *  rejected delete provably leaves every document untouched. */
function harness(role = "admin") {
  const documents = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const ref = (path: string) => ({ path, id: path.split("/").at(-1)! });
  const matches = (data: Record<string, unknown>, field: string, operator: string, value: unknown): boolean =>
    operator === "array-contains"
      ? Array.isArray(data[field]) && (data[field] as unknown[]).includes(value)
      : data[field] === value;
  const db = {
    doc: ref,
    collection: (path: string) => ({
      doc: () => ref(`${path}/id-${++counter}`),
      where: (field: string, operator: string, value: unknown) => {
        const query: Record<string, unknown> & { limit: (n: number) => unknown } = {
          collection: path, field, operator, value, limitCount: -1,
          limit(n: number) { query.limitCount = n; return query; },
        };
        return query;
      },
    }),
    runTransaction: async (action: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (target: { path?: string; collection?: string; field?: string; operator?: string; value?: unknown; limitCount?: number }) => {
          if (writes.length) throw new Error("READ_AFTER_WRITE");
          const snapshot = (path: string) => ({ ...ref(path), ref: ref(path), exists: documents.has(path), data: () => documents.get(path) });
          if (target.path) return snapshot(target.path);
          let docs = [...documents.entries()]
            .filter(([path, data]) => path.startsWith(`${target.collection}/`) && matches(data, target.field!, target.operator ?? "==", target.value))
            .map(([path]) => snapshot(path));
          if ((target.limitCount ?? -1) >= 0) docs = docs.slice(0, target.limitCount);
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
        set: (target: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => writes.push(() => documents.set(target.path, options?.merge ? { ...documents.get(target.path), ...data } : data)),
        update: (target: { path: string }, data: Record<string, unknown>) => writes.push(() => documents.set(target.path, { ...documents.get(target.path), ...data })),
        create: (target: { path: string }, data: Record<string, unknown>) => writes.push(() => documents.set(target.path, data)),
        delete: (target: { path: string }) => writes.push(() => documents.delete(target.path)),
      };
      const result = await action(tx);
      writes.forEach((write) => write());
      return result;
    },
  };
  const ops = makeOperations({ db, authorize: async () => role, operationRef: (request: { data: { requestId: string } }) => ref(`operations/${request.data.requestId}`) });
  return {
    documents,
    save: (data: Record<string, unknown>) => ops.saveInventoryProduct.run({ auth: { uid: "test-admin" }, data }),
    purchase: (data: Record<string, unknown>) => ops.executeInventoryPurchase.run({ auth: { uid: "test-admin" }, data }),
    remove: (data: Record<string, unknown>) => ops.deleteInventoryProduct.run({ auth: { uid: "test-admin" }, data }),
  };
}

const variant = (name: string) => ({
  variant_name: name, base_unit_id: "kg",
  units: [{ id: "kg", name: "كيلو", factor: 1, stock_kind: "loose", selling_price: 12, purchase_price: 10 }],
  inventory_alerts: { loose: { reorder_point: 2 } },
});
const key = "12345678-1234-1234-1234-123456789abc";

describe("hard delete of history-free products", () => {
  it("deletes a fresh product with zero stock and no history, keeping its family", async () => {
    const { save, remove, documents } = harness();
    const created = await save({ requestId: key, family_name: "مكرونة", uses_variants: true, variants: [variant("معوجة")] });
    const result = await remove({ ids: [created.id] });
    expect(result).toEqual({ deleted: true, ids: [created.id] });
    expect(documents.has(`products/${created.id}`)).toBe(false);
    expect(documents.has(`product_families/${created.family_id}`)).toBe(true);
  });

  it("refuses while stock remains, even with a valid purchase behind it", async () => {
    const { save, purchase, remove, documents } = harness();
    const created = await save({ requestId: key, family_name: "سكر", uses_variants: true, variants: [variant("ناعم")] });
    await purchase({ idempotencyKey: key, paidNow: 0, items: [{ product_id: created.id, unit_id: "kg", quantity: 2, unit_cost: 10, pricing: { mode: "auto" } }] });
    await expect(remove({ ids: [created.id] })).rejects.toThrow("مخزون");
    expect(documents.has(`products/${created.id}`)).toBe(true);
  });

  it("refuses when movements exist even after stock returns to zero", async () => {
    const { save, remove, documents } = harness();
    const created = await save({ requestId: key, family_name: "زيت", uses_variants: true, variants: [variant("شمس")] });
    documents.set("inventory_transactions/legacy-1", { product_id: created.id, type: "sale", base_quantity: 1 });
    await expect(remove({ ids: [created.id] })).rejects.toThrow("سجل حركة مخزون");
    expect(documents.has(`products/${created.id}`)).toBe(true);
  });

  it("refuses when a purchase invoice references the product", async () => {
    const { save, remove, documents } = harness();
    const created = await save({ requestId: key, family_name: "شاي", uses_variants: true, variants: [variant("أخضر")] });
    documents.set("purchase_invoices/imported-1", { product_ids: ["other-id", created.id] });
    await expect(remove({ ids: [created.id] })).rejects.toThrow("فواتير شراء");
    expect(documents.has(`products/${created.id}`)).toBe(true);
  });

  it("deletes a whole family atomically and rejects the batch when one variant is dirty", async () => {
    const { save, remove, documents } = harness();
    const created = await save({ requestId: key, family_name: "مكرونة", uses_variants: true, variants: [variant("معوجة"), variant("سباجيتي")] });
    const clean = await save({ requestId: `${key}-clean`, family_name: "أرز", uses_variants: true, variants: [variant("بسمتي")] });
    documents.set("inventory_transactions/t-9", { product_id: created.ids[0], type: "purchase", base_quantity: 5 });
    const size = documents.size;
    await expect(remove({ ids: [...created.ids, clean.id] })).rejects.toThrow("سجل حركة مخزون");
    expect(documents.size).toBe(size);
    for (const id of created.ids) expect(documents.has(`products/${id}`)).toBe(true);
    expect(documents.has(`products/${clean.id}`)).toBe(true);
    const result = await remove({ ids: [clean.id] });
    expect(result).toEqual({ deleted: true, ids: [clean.id] });
    expect(documents.has(`products/${clean.id}`)).toBe(false);
  });

  it("rejects unknown ids, malformed input, and non-admin callers", async () => {
    const { remove, documents } = harness();
    await expect(remove({ ids: ["ghost"] })).rejects.toThrow();
    await expect(remove({ ids: [] })).rejects.toThrow();
    await expect(remove({ ids: ["a/b"] })).rejects.toThrow();
    await expect(remove({ ids: Array.from({ length: 41 }, (_, i) => `p-${i}`) })).rejects.toThrow();
    expect(documents.size).toBe(0);
    const cashier = harness("cashier");
    await expect(cashier.remove({ ids: ["whatever"] })).rejects.toThrow();
  });
});
