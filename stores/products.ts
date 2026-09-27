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

  /** Atomic delete with optional stock-value recovery to the cashbox.
   *  Always writes an inventory audit record when stock is destroyed. */
  async function deleteProductWithRecovery(
    id: string,
    recover: boolean,
  ): Promise<{ ok: true; recovered: number } | { ok: false; error: string }> {
    try {
      let recovered = 0;
      await runTx(async (tx) => {
        const pRef = doc(db, "products", id);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error("VALIDATION:المنتج غير موجود.");
        const data = pSnap.data();
        const stock = round2(toNum(data.stock_quantity));
        const value = round2(stock * toNum(data.cost_price));
        const now = serverTimestamp();
        const by = (authStore.currentUserKey as string) || null;
        if (recover && stock > 0 && value > 0) {
          const cRef = doc(db, "cashbox", "current");
          const cSnap = await tx.get(cRef);
          const bal = cSnap.exists() ? round2(Number(cSnap.data().balance || 0)) : 0;
          tx.set(cRef, { balance: round2(bal + value), updated_at: now }, { merge: true });
          tx.set(doc(collection(db, "cash_transactions")), {
            type: "supplier_return",
            direction: "in",
            amount: value,
            product_id: id,
            reference_type: "product",
            reference_id: id,
            reference_label: `مرتجع للمورد ${String(data.name || "منتج")}`,
            note: `استرجاع منتجات للمورد: ${String(data.name || "")}`,
            created_by: by,
            created_at: now,
          });
          recovered = value;
        }
        if (stock > 0) {
          tx.set(doc(collection(db, "inventory_transactions")), {
            type: "manual_adjustment",
            product_id: id,
            product_name: String(data.name || ""),
            quantity: stock,
            direction: "out",
            unit_cost: round2(toNum(data.cost_price)),
            note: "حذف المنتج من السجل",
            created_by: by,
            created_at: now,
          });
        }
        tx.delete(pRef);
      });
      list.value = list.value.filter((p) => p.id !== id);
      return { ok: true, recovered };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر حذف المنتج." };
    }
  }

  return { list, loaded, lastFetchedAt, fetchProducts, addProduct, updateProduct, patchCached, upsertCached, invalidateCache, deleteProduct, deleteProductWithRecovery };
});
