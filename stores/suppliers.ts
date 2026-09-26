import type { Supplier } from "~/types/finance";

export const useSuppliersStore = defineStore("suppliers", () => {
  const { readFrom, saveDataTo, updateItem, deleteItem, serverTimestamp } = useFirebase();
  const list = ref<Supplier[]>([]);

  async function fetchSuppliers(): Promise<void> {
    list.value = (await readFrom<Supplier>("suppliers")) ?? [];
    list.value.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }
  async function addSupplier(supplier: Omit<Supplier, "id">): Promise<unknown> {
    return saveDataTo("suppliers", { ...supplier, created_at: serverTimestamp() } as Record<string, unknown>);
  }
  async function updateSupplier(id: string, supplier: Partial<Supplier>): Promise<unknown> {
    return updateItem("suppliers", id, supplier as Record<string, unknown>);
  }
  async function deleteSupplier(id: string): Promise<boolean> {
    const referenced = (await readFrom<import("~/types/finance").PurchaseInvoice>("purchase_invoices", { supplier_id: id })) ?? [];
    if (referenced.length) return false;
    return deleteItem("suppliers", id);
  }

  return { list, fetchSuppliers, addSupplier, updateSupplier, deleteSupplier };
});
