import { defineStore } from "pinia";
import { collection, doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import type { Product, ProductFamily } from "~/types";
import { hasShortageAlert, isLowStock, isNegativeStock, isOutOfStock, shortageUnitRowsOf, toNum } from "~/composables/finance";
import { inventoryTotal } from "../functions/shared/inventoryCore.mjs";
import { callStaff } from "~/composables/staffApi";

export type InventorySyncState = "idle" | "loading" | "live" | "cache" | "error";

let inventoryUnsub: Unsubscribe | null = null;
let inventorySession = 0;
let inventoryUid: string | null = null;
let familyUnsub: Unsubscribe | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    inventoryUnsub?.();
    familyUnsub?.();
    inventoryUnsub = null;
    familyUnsub = null;
  });
}

export const useProductsStore = defineStore("products", () => {
  const { readFrom, db } = useFirebase();
  const authStore = useAuth();
  const list = ref<Product[]>([]);
  const families = ref<ProductFamily[]>([]);
  const loaded = ref(false);
  const lastFetchedAt = ref(0);
  const inventoryReady = ref(false);
  const inventorySyncState = ref<InventorySyncState>("idle");
  const syncPendingWrites = ref(false);
  const syncError = ref<string | null>(null);
  let pendingProductSave: { fingerprint: string; requestId: string } | null = null;

  const productsById = computed(() => new Map(list.value.filter((p) => p.id).map((p) => [p.id as string, p])));
  const activeProducts = computed(() => list.value.filter((p) => p.is_active !== false));
  const lowStockProducts = computed(() => activeProducts.value.filter((p) => isLowStock(p)));
  const outOfStockProducts = computed(() => activeProducts.value.filter((p) => isOutOfStock(p) && hasShortageAlert(p)));
  const negativeStockProducts = computed(() => activeProducts.value.filter((p) => isNegativeStock(p)));
  const lowStockCount = computed(() => new Set(shortageUnitRowsOf(activeProducts.value).map(({ product }) => product.id)).size);
  const shortageUnitCount = computed(() => shortageUnitRowsOf(list.value).length);
  /** Of those rows, how many sit at zero/negative stock. */
  const shortageOutUnitCount = computed(
    () => shortageUnitRowsOf(list.value).filter(({ current }) => current <= 0).length,
  );

  function presentProduct(id: string, data: Record<string, unknown>): Product {
    const familyId = typeof data.family_id === "string" ? data.family_id : null;
    const family = families.value.find((entry) => entry.id === familyId);
    const familyName = family?.name || (typeof data.family_name === "string" ? data.family_name : "");
    const variantName = typeof data.variant_name === "string" ? data.variant_name : String(data.name || "");
    const inventoryMode = data.inventory_mode === "independent" ? "independent" : "convertible";
    const packSizeName = typeof data.pack_size_name === "string" ? data.pack_size_name : "";
    const units = Array.isArray(data.units) ? data.units : [];
    const inventory = data.inventory && typeof data.inventory === "object"
      ? data.inventory as Product["inventory"]
      : null;
    let stockQuantity: number | null = null;
    if (inventory) {
      try { stockQuantity = inventoryTotal(inventory, units as never); }
      catch { stockQuantity = null; }
    }
    return {
      ...data,
      id,
      family_id: familyId,
      family_name: familyName,
      variant_name: variantName,
      inventory_mode: inventoryMode,
      pack_size_name: packSizeName || null,
      name: inventoryMode === "independent"
        ? data.uses_variants === false
          ? [familyName, packSizeName].filter(Boolean).join(" — ")
          : [familyName, variantName, packSizeName].filter(Boolean).join(" — ")
        : data.uses_variants === false ? familyName : familyName ? `${familyName} — ${variantName}` : variantName,
      inventory,
      units,
      stock_quantity: stockQuantity,
    } as Product;
  }

  function refreshNames(): void {
    list.value = list.value.map((product) => product.id
      ? presentProduct(product.id, product as unknown as Record<string, unknown>)
      : product);
  }

  function ensureInventorySubscription(): void {
    if (!import.meta.client) return;
    if (authStore.role === "cashier") return;
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
    familyUnsub = onSnapshot(collection(db, "product_families"), (snap) => {
      if (session !== inventorySession || !inventoryUnsub || useFirebase().auth.currentUser?.uid !== uid) return;
      families.value = snap.docs.map((family) => ({ id: family.id, ...(family.data() as object) }) as ProductFamily);
      refreshNames();
    }, (error) => {
      if (session !== inventorySession) return;
      syncError.value = (error as Error).message ?? "family sync error";
      inventorySyncState.value = "error";
    });
    inventoryUnsub = onSnapshot(
      collection(db, "products"),
      { includeMetadataChanges: true },
      (snap) => {
        if (session !== inventorySession || !inventoryUnsub) return;
        const nextUid = useFirebase().auth.currentUser?.uid ?? null;
        if (nextUid !== uid) return;
        for (const change of snap.docChanges()) {
          const item = presentProduct(change.doc.id, change.doc.data() as Record<string, unknown>);
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
    familyUnsub?.();
    inventoryUnsub = null;
    familyUnsub = null;
    if (inventorySyncState.value !== "idle") inventorySyncState.value = "idle";
    syncPendingWrites.value = false;
  }

  function clearInventory(): void {
    stopInventorySubscription();
    inventoryUid = null;
    list.value = [];
    families.value = [];
    loaded.value = false;
    inventoryReady.value = false;
    lastFetchedAt.value = 0;
    syncError.value = null;
  }

  const fetchProducts = async (filters?: Record<string, string | number | boolean | Date | null | undefined>, force = false): Promise<boolean> => {
    if (authStore.role === "cashier") {
      if (!force && loaded.value && Date.now() - lastFetchedAt.value < 15_000) return true;
      inventorySyncState.value = "loading";
      try {
        const response = await callStaff<Record<string, never>, { items: Product[] }>("getCashierCatalog", {});
        list.value = response.items.map((product) => ({ ...product, cost_price: null }));
        loaded.value = true;
        inventoryReady.value = true;
        lastFetchedAt.value = Date.now();
        inventorySyncState.value = "live";
        syncError.value = null;
        return true;
      } catch (error) {
        syncError.value = error instanceof Error ? error.message : "تعذر تحميل المنتجات";
        inventorySyncState.value = "error";
        throw error;
      }
    }
    const filtered = !!filters && Object.values(filters).some((value) => value !== undefined && value !== null && value !== "");
    if (filtered) return true;
    if (inventoryUnsub) return true;
    if (!force && loaded.value && Date.now() - lastFetchedAt.value < 30_000) return true;
    const session = inventorySession;
    const [items, familyItems] = await Promise.all([
      readFrom<Product>("products", {}),
      readFrom<ProductFamily>("product_families", {}),
    ]);
    families.value = familyItems;
    if (session !== inventorySession || inventoryUnsub) return true;
    list.value = items.map((product) => presentProduct(product.id || "", product as unknown as Record<string, unknown>));
    loaded.value = true;
    inventoryReady.value = true;
    lastFetchedAt.value = Date.now();
    return true;
  };

  const updateProduct = async (id: string, updatedFields: Partial<Product>) => {
    const current = productsById.value.get(id);
    if (!current) return null;
    const merged = { ...current, ...updatedFields };
    const payload = {
      product_id: id,
      family_id: merged.family_id,
      family_name: merged.family_name || "",
      variant_name: merged.variant_name || merged.name || "",
      inventory_mode: merged.inventory_mode || "convertible",
      variant_key: merged.variant_key,
      pack_size_name: merged.pack_size_name,
      pack_size_order: merged.pack_size_order,
      base_unit_id: merged.base_unit_id || "",
      units: merged.units || [],
      inventory_alerts: merged.inventory_alerts || {},
    };
    const fingerprint = JSON.stringify(payload);
    if (pendingProductSave?.fingerprint !== fingerprint) pendingProductSave = { fingerprint, requestId: crypto.randomUUID() };
    const result = await callStaff<typeof payload & { requestId: string }, { id: string }>("saveInventoryProduct", {
      ...payload, requestId: pendingProductSave.requestId,
    });
    pendingProductSave = null;
    invalidateCache();
    return result;
  };

  async function saveProductFamily(input: { family_id?: string; family_name: string; uses_variants: boolean; inventory_mode: "convertible" | "independent"; variants: Product[] }): Promise<void> {
    const payload = {
      family_id: input.family_id,
      family_name: input.family_name,
      uses_variants: input.uses_variants,
      inventory_mode: input.inventory_mode,
      variants: input.variants.map((variant) => ({
        product_id: variant.id,
        expected_updated_at: variant.updated_at ?? null,
        variant_name: variant.variant_name,
        variant_key: variant.variant_key,
        variant_order: variant.variant_order,
        pack_size_name: variant.pack_size_name,
        pack_size_order: variant.pack_size_order,
        base_unit_id: variant.base_unit_id,
        units: variant.units || [],
        inventory_alerts: variant.inventory_alerts || {},
      })),
    };
    const fingerprint = JSON.stringify(payload);
    if (pendingProductSave?.fingerprint !== fingerprint) pendingProductSave = { fingerprint, requestId: crypto.randomUUID() };
    await callStaff("saveInventoryProduct", { ...payload, requestId: pendingProductSave.requestId });
    pendingProductSave = null;
    invalidateCache();
  }

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

  /** Archive a product instead of destructive deletion.
   *  Products with accounting history (invoices/movements) are never destroyed:
   *  they are marked inactive so reports keep their integrity. A real supplier
   *  return is a separate explicit financial workflow — deletion never mints
   *  cash. The legacy `recover` flag is ignored (no fake supplier_return). */
  async function archiveProduct(id: string, ids: string[] = [id]): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await callStaff("archiveInventoryProduct", { ids });
      list.value = list.value.map((p) => (p.id && ids.includes(p.id) ? { ...p, is_active: false } : p));
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر أرشفة المنتج." };
    }
  }

  async function unarchiveProduct(id: string, ids: string[] = [id]): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await callStaff("unarchiveInventoryProduct", { ids });
      list.value = list.value.map((p) => (p.id && ids.includes(p.id) ? { ...p, is_active: true } : p));
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر إلغاء أرشفة المنتج." };
    }
  }

  /** Hard-delete products the server proves have zero stock and zero history
   *  (no movements, no purchase references). Server messages are specific
   *  (stock vs history), so they surface as-is instead of a generic error. */
  async function deleteProduct(id: string, ids: string[] = [id]): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await callStaff("deleteInventoryProduct", { ids });
      const gone = new Set(ids);
      list.value = list.value.filter((p) => !(p.id && gone.has(p.id)));
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      if (e instanceof Error && e.message.trim()) return { ok: false, error: e.message };
      console.error(e);
      return { ok: false, error: "تعذر حذف المنتج." };
    }
  }

  return { list, families, loaded, lastFetchedAt, inventoryReady, inventorySyncState, syncPendingWrites, syncError, productsById, activeProducts, lowStockProducts, outOfStockProducts, negativeStockProducts, lowStockCount, shortageUnitCount, shortageOutUnitCount, ensureInventorySubscription, stopInventorySubscription, clearInventory, fetchProducts, updateProduct, saveProductFamily, patchCached, upsertCached, invalidateCache, archiveProduct, unarchiveProduct, deleteProduct };
});
