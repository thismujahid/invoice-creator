import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, defineStore, setActivePinia } from "pinia";
import { ref } from "vue";

let useCashbox: typeof import("../../composables/useCashbox").useCashbox;

const { getDocsMock } = vi.hoisted(() => ({ getDocsMock: vi.fn() }));

vi.mock("firebase/firestore", () => ({
  collection: () => ({}),
  doc: () => ({}),
  getDocs: getDocsMock,
  limit: () => ({}),
  onSnapshot: vi.fn(),
  orderBy: () => ({}),
  query: () => ({}),
  startAfter: () => ({}),
  where: () => ({}),
}));

beforeEach(async () => {
  setActivePinia(createPinia());
  vi.stubGlobal("defineStore", defineStore);
  vi.stubGlobal("ref", ref);
  vi.stubGlobal("useFirebase", () => ({ db: {}, getDoc: vi.fn(), serverTimestamp: vi.fn() }));
  vi.stubGlobal("useAuth", () => ({ role: "admin" }));
  vi.stubGlobal("useAppToast", () => ({ notify: vi.fn() }));
  getDocsMock.mockReset();
  ({ useCashbox } = await import("../../composables/useCashbox"));
});

afterEach(() => vi.unstubAllGlobals());

describe("cashbox transaction reads", () => {
  it("does not restore another session's transactions after clearing cashbox", async () => {
    let resolveRead: (value: unknown) => void = () => {};
    getDocsMock.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    const store = useCashbox();
    const read = store.fetchTransactions();
    store.clearCashbox();
    resolveRead({ docs: [{ id: "old", data: () => ({ amount: 10 }) }] });
    await read;

    expect(store.transactions).toEqual([]);
    expect(store.transactionsPage).toBe(1);
    expect(store.transactionsHasMore).toBe(false);
  });

  it("keeps the newer transaction page when reads complete out of order", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    let resolveNew: (value: unknown) => void = () => {};
    getDocsMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    const store = useCashbox();
    const oldRead = store.fetchTransactions();
    const newRead = store.fetchTransactions();
    resolveNew({ docs: [{ id: "new", data: () => ({ amount: 20 }) }] });
    await newRead;
    resolveOld({ docs: [{ id: "old", data: () => ({ amount: 10 }) }] });
    await oldRead;

    expect(store.transactions.map((item) => item.id)).toEqual(["new"]);
    expect(store.loadingTxns).toBe(false);
  });
});
