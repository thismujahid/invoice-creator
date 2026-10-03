import { collection, doc, increment } from "firebase/firestore";
import type { Customer } from "~/types";

export const useCustomersStore = defineStore("customers", () => {
  const { readFrom, updateItem, db, serverTimestamp } = useFirebase();
  const list = ref<Customer[]>([]);
  const loaded = ref(false);
  const lastFetchedAt = ref(0);

  const fetchCustomers = async (filters?: Record<string, string | number | boolean | Date | null | undefined>, force = false): Promise<boolean> => {
    const filtered = !!filters && Object.values(filters).some((value) => value !== undefined && value !== null && value !== "");
    if (!filtered && !force && loaded.value && Date.now() - lastFetchedAt.value < 30_000) return true;
    list.value = await readFrom<Customer>("customers", filters ?? {});
    if (!filtered) { loaded.value = true; lastFetchedAt.value = Date.now(); }
    return true;
  };

  // Phones are always stored as trimmed strings: Firestore `==` is
  // type-strict, so numeric phones break customer invoice filters and
  // summary matching (leading zeros are lost in numeric storage).
  function normalizePhoneField(phone: unknown): string | null {
    const s = String(phone ?? "").trim();
    return s === "" ? null : s;
  }

  const addCustomer = async (customer: Omit<Customer, "id">) => {
    const normalized: Omit<Customer, "id"> = { ...customer, phone: normalizePhoneField(customer.phone) };
    const ref = doc(collection(db, "customers"));
    await runTx(async (tx) => {
      tx.set(ref, normalized as Record<string, unknown>);
      tx.set(doc(db, "store_stats", "current"), { customer_count: increment(1), updated_at: serverTimestamp() }, { merge: true });
      tx.set(doc(db, "customer_summaries", ref.id), {
        customer_id: ref.id,
        customer_name: normalized.name,
        customer_phone: normalized.phone,
        invoice_count: 0,
        total_sales: 0,
        outstanding_debt: 0,
        initialized: true,
        updated_at: serverTimestamp(),
      });
    });
    list.value.push({ ...normalized, id: ref.id });
    return ref;
  };

  const updateCustomer = async (id: string, updatedFields: Partial<Customer>) => {
    const normalized: Partial<Customer> =
      "phone" in updatedFields
        ? { ...updatedFields, phone: normalizePhoneField(updatedFields.phone) }
        : updatedFields;
    const result = await updateItem("customers", id, normalized as Record<string, unknown>);
    if (result !== null) list.value = list.value.map((customer) => customer.id === id ? { ...customer, ...normalized } : customer);
    return result;
  };

  const deleteCustomer = async (id: string): Promise<boolean> => {
    try {
      await runTx(async (tx) => {
        tx.delete(doc(db, "customers", id));
        tx.set(doc(db, "store_stats", "current"), { customer_count: increment(-1), updated_at: serverTimestamp() }, { merge: true });
      });
      list.value = list.value.filter((c) => c.id !== id);
      return true;
    } catch {
      return false;
    }
  };

  return { list, loaded, lastFetchedAt, fetchCustomers, addCustomer, updateCustomer, deleteCustomer };
});
