import { afterEach, describe, expect, it, vi } from "vitest";
import { useFirebase } from "../../composables/firebase";

const { getDocsMock } = vi.hoisted(() => ({ getDocsMock: vi.fn() }));

vi.mock("firebase/app", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase/app")>(),
  getApps: () => [],
  initializeApp: () => ({}),
}));
vi.mock("firebase/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase/auth")>(),
  getAuth: () => ({}),
}));
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase/firestore")>(),
  getFirestore: () => ({}),
  collection: () => ({}),
  getDocs: getDocsMock,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getDocsMock.mockReset();
});

describe("Firestore collection reads", () => {
  it("keeps an empty collection distinct from a failed read", async () => {
    vi.stubGlobal("useRuntimeConfig", () => ({ public: {} }));
    const { readFrom } = useFirebase();
    getDocsMock.mockResolvedValueOnce({ docs: [] });
    await expect(readFrom("products")).resolves.toEqual([]);

    const failure = new Error("permission-denied");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getDocsMock.mockRejectedValueOnce(failure);
    await expect(readFrom("products")).rejects.toBe(failure);
    expect(log).toHaveBeenCalledOnce();
  });
});
