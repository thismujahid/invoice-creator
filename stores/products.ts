import { collection, doc } from "firebase/firestore";
import type { Product } from "~/types";
import { round2, toNum } from "~/composables/finance";

export const useProductsStore = defineStore("products", () => {
  const { readFrom, saveDataTo, updateItem, deleteItem, db, serverTimestamp } = useFirebase();
  const authStore = useAuth();
  const list = ref<Product[]>([]);
  const loaded = ref(false);
  const lastFetchedAt = ref(0);

  const fetchProducts = async (filters?: Record<string, string | number | boolean | Date | null | undefined>, force = false): Promise<boolean> => {
    const filtered = !!filters && Object.values(filters).some((value) => value !== undefined && value !== null && value !== "");
    if (!filtered && !force && loaded.value && Date.now() - lastFetchedAt.value < 30_000) return true;
    list.value = await readFrom<Product>("products", filters ?? {});
    if (!filtered) { loaded.value = true; lastFetchedAt.value = Date.now(); }
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

  return { list, loaded, lastFetchedAt, fetchProducts, addProduct, updateProduct, patchCached, upsertCached, invalidateCache, deleteProduct, deleteProductWithRecovery, archiveProduct };
});
