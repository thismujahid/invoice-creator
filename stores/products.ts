import type { Product } from "~/types";

export const useProductsStore = defineStore("products", () => {
  const { readFrom, saveDataTo, updateItem, deleteItem } = useFirebase();
  const list = ref<Product[]>([]);

  const fetchProducts = async (filters?: Record<string, string | number | boolean | Date | null | undefined>): Promise<boolean> => {
    list.value = await readFrom<Product>("products", filters ?? {});
    return true;
  };

  const addProduct = async (product: Omit<Product, "id">) => {
    return await saveDataTo("products", product as Record<string, unknown>);
  };

  const updateProduct = async (id: string, updatedFields: Partial<Product>) => {
    return await updateItem("products", id, updatedFields as Record<string, unknown>);
  };

  const deleteProduct = async (id: string): Promise<boolean> => {
    const ok = await deleteItem("products", id);
    if (ok) list.value = list.value.filter((p) => p.id !== id);
    return ok;
  };

  return { list, fetchProducts, addProduct, updateProduct, deleteProduct };
});
