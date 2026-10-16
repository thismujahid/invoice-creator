import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import { useProductsStore } from "../../stores/products";

const { callStaffMock } = vi.hoisted(() => ({ callStaffMock: vi.fn() }));

vi.mock("~/composables/staffApi", () => ({ callStaff: callStaffMock }));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("ref", ref);
  vi.stubGlobal("computed", computed);
  callStaffMock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("product fetch session guards", () => {
  it("does not apply an admin read after inventory is cleared", async () => {
    const pending = new Map<string, (items: unknown[]) => void>();
    const readFrom = vi.fn((module: string) => new Promise<unknown[]>((resolve) => pending.set(module, resolve)));
    vi.stubGlobal("useAuth", () => ({ role: "admin" }));
    vi.stubGlobal("useFirebase", () => ({ readFrom, db: {} }));

    const store = useProductsStore();
    const fetch = store.fetchProducts();
    store.clearInventory();
    pending.get("products")?.([{ id: "old", name: "قديم" }]);
    pending.get("product_families")?.([{ id: "family-old", name: "قديمة" }]);
    expect(await fetch).toBe(false);

    expect(store.list).toEqual([]);
    expect(store.families).toEqual([]);
    expect(store.syncError).toBeNull();
  });

  it("keeps the latest cashier catalog when responses arrive out of order", async () => {
    const auth = { role: "cashier" };
    vi.stubGlobal("useAuth", () => auth);
    vi.stubGlobal("useFirebase", () => ({ readFrom: vi.fn(), db: {} }));
    let resolveOld: (value: unknown) => void = () => {};
    let resolveNew: (value: unknown) => void = () => {};
    callStaffMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));

    const store = useProductsStore();
    const oldFetch = store.fetchProducts(undefined, true);
    const newFetch = store.fetchProducts(undefined, true);
    resolveNew({ items: [{ id: "new", cost_price: 9 }] });
    await newFetch;
    resolveOld({ items: [{ id: "old", cost_price: 5 }] });
    await oldFetch;

    expect(store.list.map((product) => product.id)).toEqual(["new"]);
    expect(store.list[0]?.cost_price).toBeNull();
    expect(store.inventorySyncState).toBe("live");
  });
});
