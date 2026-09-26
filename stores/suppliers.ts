import { collection, doc } from "firebase/firestore";
import type { Supplier } from "~/types/finance";

export const useSuppliersStore = defineStore("suppliers", () => {
  const { readFrom, countFrom, updateItem, deleteItem, db, serverTimestamp } = useFirebase();
  const list = ref<Supplier[]>([]);
  const loaded = ref(false);
  const lastFetchedAt = ref(0);

  async function fetchSuppliers(force = false): Promise<void> {
    if (!force && loaded.value && Date.now() - lastFetchedAt.value < 30_000) return;
    list.value = (await readFrom<Supplier>("suppliers")) ?? [];
    list.value.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    loaded.value = true;
    lastFetchedAt.value = Date.now();
  }
  async function addSupplier(supplier: Omit<Supplier, "id">): Promise<unknown> {
    const ref = doc(collection(db, "suppliers"));
    await runTx(async (tx) => {
      tx.set(ref, { ...supplier, created_at: serverTimestamp() } as Record<string, unknown>);
      tx.set(doc(db, "supplier_summaries", ref.id), {
        supplier_id: ref.id,
        supplier_name: supplier.name,
        invoice_count: 0,
        total_purchases: 0,
        outstanding_payable: 0,
        initialized: true,
        updated_at: serverTimestamp(),
      });
    });
    list.value.push({ ...supplier, id: ref.id });
    list.value.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    return ref;
  }
  async function updateSupplier(id: string, supplier: Partial<Supplier>): Promise<unknown> {
    const result = await updateItem("suppliers", id, supplier as Record<string, unknown>);
    if (result !== null) { list.value = list.value.map((item) => item.id === id ? { ...item, ...supplier } : item); list.value.sort((a, b) => a.name.localeCompare(b.name, "ar")); }
    return result;
  }
  async function deleteSupplier(id: string): Promise<boolean> {
    const referenceCount = await countFrom("purchase_invoices", { supplier_id: id });
    if (referenceCount === null || referenceCount > 0) return false;
    const deleted = await deleteItem("suppliers", id);
    if (deleted) list.value = list.value.filter((supplier) => supplier.id !== id);
    return deleted;
  }

  return { list, loaded, lastFetchedAt, fetchSuppliers, addSupplier, updateSupplier, deleteSupplier };
});
