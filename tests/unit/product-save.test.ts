import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const makeOperations = require("../../functions/inventoryOperations.cjs");

function harness() {
  const documents = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const ref = (path: string) => ({ path, id: path.split("/").at(-1)! });
  const db = {
    doc: ref,
    collection: (path: string) => ({
      doc: () => ref(`${path}/id-${++counter}`),
      where: (field: string, _operator: string, value: unknown) => ({ collection: path, field, value }),
    }),
    runTransaction: async (action: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (target: { path?: string; collection?: string; field?: string; value?: unknown }) => {
          if (writes.length) throw new Error("READ_AFTER_WRITE");
          const snapshot = (path: string) => ({ ...ref(path), ref: ref(path), exists: documents.has(path), data: () => documents.get(path) });
          if (target.path) return snapshot(target.path);
          return { docs: [...documents.entries()].filter(([path, data]) => path.startsWith(`${target.collection}/`) && data[target.field!] === target.value).map(([path]) => snapshot(path)) };
        },
        set: (target: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => writes.push(() => documents.set(target.path, options?.merge ? { ...documents.get(target.path), ...data } : data)),
        update: (target: { path: string }, data: Record<string, unknown>) => writes.push(() => documents.set(target.path, { ...documents.get(target.path), ...data })),
        create: (target: { path: string }, data: Record<string, unknown>) => writes.push(() => documents.set(target.path, data)),
      };
      const result = await action(tx);
      writes.forEach(write => write());
      return result;
    },
  };
  const ops = makeOperations({ db, authorize: async () => "admin", operationRef: (request: { data: { requestId: string } }) => ref(`operations/${request.data.requestId}`) });
  return { documents, purchase: (data: Record<string, unknown>) => ops.executeInventoryPurchase.run({ auth: { uid: "test-admin" }, data }), save: (data: Record<string, unknown>) => ops.saveInventoryProduct.run({ auth: { uid: "test-admin" }, data }) };
}

const variant = (name: string) => ({ variant_name: name, base_unit_id: "kg", units: [{ id: "kg", name: "كيلو", factor: 1, stock_kind: "loose", selling_price: 12, purchase_price: 10 }], inventory_alerts: { loose: { reorder_point: 2 } } });
const packSize = (name: string, key = "default", type = "أساسي") => ({
  variant_name: type, variant_key: key, pack_size_name: name, base_unit_id: "piece",
  units: [
    { id: "piece", name: "عبوة", factor: 1, stock_kind: "loose", selling_price: 12, purchase_price: 10, allows_fractional: false },
    { id: "carton", name: "كرتونة", factor: 12, stock_kind: "package", selling_price: 130, purchase_price: 110, allows_fractional: false },
  ],
  inventory_alerts: { loose: { reorder_point: 2 }, packages: { carton: { reorder_point: 1 } } },
});
const key = "12345678-1234-1234-1234-123456789abc";

describe("atomic product family save with transaction double", () => {
  it("saves both variants atomically and retrying does not duplicate them", async () => {
    const { save, documents } = harness();
    const input = { requestId: key, family_name: "مكرونة", uses_variants: true, variants: [variant("معوجة"), variant("سباجيتي")] };
    const first = await save(input);
    expect(first.ids).toHaveLength(2);
    expect(await save(input)).toEqual(first);
    expect([...documents.keys()].filter(path => path.startsWith("products/"))).toHaveLength(2);
    expect((documents.get(`products/${first.ids[0]}`)?.units as Array<{ profit_margin: number }>)[0]?.profit_margin).toBeCloseTo(0.2);
  });
  it("stores a hidden default variant and prevents duplicate names without writes", async () => {
    const { save, documents } = harness();
    const result = await save({ requestId: key, family_name: "سكر", uses_variants: false, variants: [variant("")] });
    expect(documents.get(`products/${result.id}`)?.variant_name).toBe("أساسي");
    expect(documents.get(`products/${result.id}`)?.name).toBe("سكر");
    const size = documents.size;
    await expect(save({ requestId: key + "x", family_name: "زيت", uses_variants: true, variants: [variant("شمس"), variant("شمس")] })).rejects.toThrow();
    expect(documents.size).toBe(size);
  });
  it("rejects omitted variants so concurrent additions cannot be lost", async () => {
    const { save, documents } = harness();
    const result = await save({ requestId: key, family_name: "مكرونة", uses_variants: true, variants: [variant("معوجة"), variant("سباجيتي")] });
    const size = documents.size;
    await expect(save({ requestId: key + "x", family_id: result.family_id, family_name: "مكرونة", uses_variants: true, variants: [{ ...variant("معوجة"), product_id: result.id }] })).rejects.toThrow("تغيّرت أنواع المنتج");
    expect(documents.size).toBe(size);
  });
});


it("applies automatic prices and weighted inventory costs in the same purchase transaction", async () => {
  const { save, purchase, documents } = harness();
  const draft = variant("معوجة");
  draft.units.push({ id: "carton", name: "كرتونة", factor: 10, stock_kind: "package", selling_price: 110, purchase_price: 100 });
  const created = await save({ requestId: key, family_name: "مكرونة", uses_variants: true, variants: [draft] });
  const input = { idempotencyKey: key, paidNow: 0, items: [{ product_id: created.id, unit_id: "carton", quantity: 2, unit_cost: 110, pricing: { mode: "auto" } }] };
  await purchase(input);
  const stored = documents.get(`products/${created.id}`)!;
  expect(stored.cost_price).toBe(11);
  expect(stored.last_purchase_base_cost).toBe(11);
  expect((stored.units as Array<{ selling_price: number }>).map(unit => unit.selling_price)).toEqual([13.2, 121]);
  expect(stored.inventory).toEqual({ loose_base_quantity: 0, closed_packages: { carton: 2 } });
  const count = documents.size;
  expect((await purchase(input)).duplicate).toBe(true);
  expect(documents.size).toBe(count);
  await purchase({ idempotencyKey: key + "x", paidNow: 0, items: [
    { product_id: created.id, unit_id: "kg", quantity: 2, unit_cost: 12, pricing: { mode: "auto" } },
    { product_id: created.id, unit_id: "carton", quantity: 1, unit_cost: 130, pricing: { mode: "auto" } },
  ] });
  const mixed = documents.get(`products/${created.id}`)!;
  expect(mixed.cost_price).toBe(374 / 32);
  expect(mixed.last_purchase_base_cost).toBe(13);
  expect((mixed.units as Array<{ selling_price: number }>).map(unit => unit.selling_price)).toEqual([15.6, 143]);
});


it("reuses an empty family left after deleting its variants", async () => {
  const { save, documents } = harness();
  const input = { requestId: key, family_name: "مكرونة", uses_variants: true, variants: [variant("معوجة")] };
  const created = await save(input);
  documents.delete(`products/${created.id}`);
  const saved = await save({ ...input, requestId: key + "new", variants: [variant("معوجة"), variant("سباجيتي"), variant("أقلام")] });
  expect(saved.family_id).toBe(created.family_id);
  expect(saved.ids).toHaveLength(3);
  expect([...documents.keys()].filter(path => path.startsWith("product_families/"))).toHaveLength(1);
});

it("still rejects creating a duplicate product when existing variants remain", async () => {
  const { save, documents } = harness();
  const input = { requestId: key, family_name: "مكرونة", uses_variants: true, variants: [variant("معوجة")] };
  await save(input);
  const size = documents.size;
  await expect(save({ ...input, requestId: key + "new" })).rejects.toThrow("اسم المنتج مسجل بالفعل");
  expect(documents.size).toBe(size);
});

it("stores independent package sizes as separate SKUs and purchases only the selected size", async () => {
  const { save, purchase, documents } = harness();
  const created = await save({ requestId: key, family_name: "شاي", uses_variants: false, inventory_mode: "independent", variants: [packSize("ربع"), packSize("ثمن"), packSize("100 جرام")] });
  expect(created.ids).toHaveLength(3);
  const quarterId = created.ids[0];
  await purchase({ idempotencyKey: key, paidNow: 0, items: [{ product_id: quarterId, unit_id: "piece", quantity: 4, unit_cost: 10, pricing: { mode: "auto" } }] });
  expect(documents.get(`products/${quarterId}`)?.inventory).toEqual({ loose_base_quantity: 4, closed_packages: {} });
  expect((documents.get(`products/${quarterId}`)?.units as Array<{ id: string; selling_price: number }>).map(unit => [unit.id, unit.selling_price])).toEqual([["piece", 12], ["carton", 130]]);
  expect(documents.get(`products/${created.ids[1]}`)?.inventory).toEqual({ loose_base_quantity: 0, closed_packages: {} });
  expect(documents.get(`products/${created.ids[2]}`)?.cost_price).toBeNull();

  await purchase({ idempotencyKey: key + "piece", paidNow: 0, items: [{ product_id: quarterId, unit_id: "piece", quantity: 2, unit_cost: 12, pricing: { mode: "auto" } }] });
  expect((documents.get(`products/${quarterId}`)?.units as Array<{ id: string; selling_price: number }>).map(unit => [unit.id, unit.selling_price])).toEqual([["piece", 14.4], ["carton", 130]]);

  await purchase({ idempotencyKey: key + "carton", paidNow: 0, items: [{ product_id: quarterId, unit_id: "carton", quantity: 1, unit_cost: 120, pricing: { mode: "auto" } }] });
  expect((documents.get(`products/${quarterId}`)?.units as Array<{ id: string; selling_price: number }>).map(unit => [unit.id, unit.selling_price])).toEqual([["piece", 14.4], ["carton", 141.82]]);
});

it("rejects fractional package sizes and changing inventory mode after stock history", async () => {
  const { save, purchase, documents } = harness();
  await expect(save({ requestId: key, family_name: "شاي", uses_variants: false, inventory_mode: "independent", variants: [{ ...packSize("ربع"), units: [{ id: "piece", name: "عبوة", factor: 1, stock_kind: "loose", selling_price: 12, allows_fractional: true }] }] })).rejects.toThrow("لا تقبل الكسور");
  const created = await save({ requestId: key + "a", family_name: "شاي", uses_variants: false, inventory_mode: "independent", variants: [packSize("ربع")] });
  await purchase({ idempotencyKey: key + "a", paidNow: 0, items: [{ product_id: created.id, unit_id: "piece", quantity: 1, unit_cost: 10, pricing: { mode: "auto" } }] });
  await expect(save({ requestId: key + "b", family_id: created.family_id, family_name: "شاي", uses_variants: false, inventory_mode: "convertible", variants: [{ ...variant(""), product_id: created.id, expected_updated_at: documents.get(`products/${created.id}`)?.updated_at }] })).rejects.toThrow("لا يمكن تغيير طريقة المخزون");
});
