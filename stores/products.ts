import { collection, doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import type { Product } from "~/types";
import { isLowStock, isNegativeStock, isOutOfStock, round2, toNum } from "~/composables/finance";

export type InventorySyncState = "idle" | "loading" | "live" | "cache" | "error";

let inventoryUnsub: Unsubscribe | null = null;
let inventorySession = 0;
let inventoryUid: string | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    inventoryUnsub?.();
    inventoryUnsub = null;
  });
}

export const useProductsStore = defineStore("products", () => {
  const { readFrom, saveDataTo, updateItem, deleteItem, db, serverTimestamp } = useFirebase();
  const authStore = useAuth();
  const list = ref<Product[]>([]);
  const loaded = ref(false);
  const lastFetchedAt = ref(0);
  const inventoryReady = ref(false);
  const inventorySyncState = ref<InventorySyncState>("idle");
  const syncPendingWrites = ref(false);
  const syncError = ref<string | null>(null);

  const productsById = computed(() => new Map(list.value.filter((p) => p.id).map((p) => [p.id as string, p])));
  const activeProducts = computed(() => list.value.filter((p) => p.is_active !== false));
  const lowStockProducts = computed(() => activeProducts.value.filter((p) => isLowStock(p) && !isOutOfStock(p)));
  const outOfStockProducts = computed(() => activeProducts.value.filter((p) => isOutOfStock(p)));
  const negativeStockProducts = computed(() => activeProducts.value.filter((p) => isNegativeStock(p)));
  const lowStockCount = computed(() => lowStockProducts.value.length);

  function applySnapshotItems(items: Product[]): void {
    const byId = new Map(list.value.filter((p) => p.id).map((p) => [p.id as string, p]));
    for (const item of items) {
      if (item.id) byId.set(item.id, item);
    }
    list.value = [...byId.values()];
  }

  function ensureInventorySubscription(): void {
    if (!import.meta.client) return;
    const uid = useFirebase().auth.currentUser?.uid ?? null;
    if (!uid) return;
    if (inventoryUnsub) {
      if (inventoryUid === uid) return;
      stopInventorySubscription();
      list.value = [];
      loaded.value = false;
      inventoryReady.value = false;
    }
    inventoryUid = uid;
    const session = ++inventorySession;
    inventorySyncState.value = "loading";
    syncError.value = null;
    inventoryUnsub = onSnapshot(
      collection(db, "products"),
      { includeMetadataChanges: true },
      (snap) => {
        if (session !== inventorySession || !inventoryUnsub) return;
        const nextUid = useFirebase().auth.currentUser?.uid ?? null;
        if (nextUid !== uid) return;
        for (const change of snap.docChanges()) {
          const item = { id: change.doc.id, ...(change.doc.data() as object) } as Product;
          if (change.type === "removed") {
            list.value = list.value.filter((p) => p.id !== item.id);
          } else {
            const index = list.value.findIndex((p) => p.id === item.id);
            if (index < 0) list.value = [...list.value, item];
            else list.value = list.value.map((p) => (p.id === item.id ? item : p));
          }
        }
        loaded.value = true;
        inventoryReady.value = true;
        lastFetchedAt.value = Date.now();
        syncPendingWrites.value = snap.metadata.hasPendingWrites;
        inventorySyncState.value = snap.metadata.fromCache ? "cache" : "live";
      },
      (error) => {
        if (session !== inventorySession) return;
        if ((error as { code?: string }).code === "permission-denied") {
          stopInventorySubscription();
        }
        syncError.value = (error as Error).message ?? "sync error";
        inventorySyncState.value = "error";
      },
    );
  }

  function stopInventorySubscription(): void {
    inventorySession += 1;
    inventoryUnsub?.();
    inventoryUnsub = null;
    if (inventorySyncState.value !== "idle") inventorySyncState.value = "idle";
    syncPendingWrites.value = false;
  }

  function clearInventory(): void {
    stopInventorySubscription();
    inventoryUid = null;
    list.value = [];
    loaded.value = false;
    inventoryReady.value = false;
    lastFetchedAt.value = 0;
    syncError.value = null;
  }

  const fetchProducts = async (filters?: Record<string, string | number | boolean | Date | null | undefined>, force = false): Promise<boolean> => {
    const filtered = !!filters && Object.values(filters).some((value) => value !== undefined && value !== null && value !== "");
    if (filtered) return true;
    if (inventoryUnsub) return true;
    if (!force && loaded.value && Date.now() - lastFetchedAt.value < 30_000) return true;
    const session = inventorySession;
    const items = await readFrom<Product>("products", {});
    if (session !== inventorySession || inventoryUnsub) return true;
    list.value = items;
    loaded.value = true;
    inventoryReady.value = true;
    lastFetchedAt.value = Date.now();
    return true;
  };

  const addProduct = async (product: Omit<Product, "id">) => {
    const ref = await saveDataTo("products", product as Record<string, unknown>);
    if (ref) list.value.push({ ...product, id: ref.id });
    return ref;
  };

  const updateProduct = async (id: string, updatedFields: Partial<Product>) => {
    const result = await updateItem("products", id, updatedFields as Record<string, unknown>);
    if (result !== null) patchCached(id, updatedFields);
    return result;
  };

  function patchCached(id: string, changes: Partial<Product>): void {
    list.value = list.value.map((product) => product.id === id ? { ...product, ...changes } : product);
  }

  function upsertCached(product: Product): void {
    const index = list.value.findIndex((item) => item.id === product.id);
    if (index < 0) list.value = [...list.value, product];
    else list.value = list.value.map((item) => item.id === product.id ? { ...item, ...product } : item);
  }

  function invalidateCache(): void {
    loaded.value = false;
  }

  const deleteProduct = async (id: string): Promise<boolean> => {
    const ok = await deleteItem("products", id);
    if (ok) list.value = list.value.filter((p) => p.id !== id);
    return ok;
  };

  /** Archive a product instead of destructive deletion.
   *  Products with accounting history (invoices/movements) are never destroyed:
   *  they are marked inactive so reports keep their integrity. A real supplier
   *  return is a separate explicit financial workflow — deletion never mints
   *  cash. The legacy `recover` flag is ignored (no fake supplier_return). */
  async function archiveProduct(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await runTx(async (tx) => {
        const pRef = doc(db, "products", id);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error("VALIDATION:المنتج غير موجود.");
        tx.update(pRef, { is_active: false });
      });
      list.value = list.value.map((p) => (p.id === id ? { ...p, is_active: false } : p));
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر أرشفة المنتج." };
    }
  }

  /** Atomic delete with optional stock-value recovery to the cashbox.
   *  DEPRECATED: deleting never creates cash (no fake supplier_return).
   *  Prefer archiveProduct(). Kept for backward compat; `recover` is ignored
   *  and no cash movement is written. Destroys the doc only when explicitly
   *  requested by legacy callers. */
  async function deleteProductWithRecovery(
    id: string,
    _recover: boolean,
  ): Promise<{ ok: true; recovered: number } | { ok: false; error: string }> {
    void _recover;
    try {
      await runTx(async (tx) => {
        const pRef = doc(db, "products", id);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error("VALIDATION:المنتج غير موجود.");
        const data = pSnap.data();
        const stock = round2(toNum(data.stock_quantity));
        const now = serverTimestamp();
        const by = (authStore.currentUserKey as string) || null;
        if (stock > 0) {
          tx.set(doc(collection(db, "inventory_transactions")), {
            type: "manual_adjustment",
            product_id: id,
            product_name: String(data.name || ""),
            quantity: stock,
            base_quantity: stock,
            unit_factor: 1,
            direction: "out",
            unit_cost: null,
            reason: "product_delete",
            note: "حذف المنتج من السجل (بدون أثر نقدي — استخدم الأرشفة للمنتجات ذات السجل المحاسبي)",
            created_by: by,
            created_at: now,
          });
        }
        tx.delete(pRef);
      });
      list.value = list.value.filter((p) => p.id !== id);
      return { ok: true, recovered: 0 };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر حذف المنتج." };
    }
  }

  return { list, loaded, lastFetchedAt, inventoryReady, inventorySyncState, syncPendingWrites, syncError, productsById, activeProducts, lowStockProducts, outOfStockProducts, negativeStockProducts, lowStockCount, ensureInventorySubscription, stopInventorySubscription, clearInventory, fetchProducts, addProduct, updateProduct, patchCached, upsertCached, invalidateCache, deleteProduct, deleteProductWithRecovery, archiveProduct };
});
