import type { Customer } from "~/types";

export const useCustomersStore = defineStore("customers", () => {
  const { readFrom, saveDataTo, updateItem, deleteItem } = useFirebase();
  const list = ref<Customer[]>([]);

  const fetchCustomers = async (filters?: Record<string, string | number | boolean | Date | null | undefined>): Promise<boolean> => {
    list.value = await readFrom<Customer>("customers", filters ?? {});
    return true;
  };

  const addCustomer = async (customer: Omit<Customer, "id">) => {
    return await saveDataTo("customers", customer as Record<string, unknown>);
  };

  const updateCustomer = async (id: string, updatedFields: Partial<Customer>) => {
    return await updateItem("customers", id, updatedFields as Record<string, unknown>);
  };

  const deleteCustomer = async (id: string): Promise<boolean> => {
    const ok = await deleteItem("customers", id);
    if (ok) list.value = list.value.filter((c) => c.id !== id);
    return ok;
  };

  return { list, fetchCustomers, addCustomer, updateCustomer, deleteCustomer };
});
