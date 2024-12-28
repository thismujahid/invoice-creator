export const useCustomersStore = defineStore("customers", () => {
    const { readFrom, saveDataTo,updateItem, deleteItem } = useFirebase()
    const list = ref([]);
    const fetchCustomers = async (filters) => {
        list.value = await readFrom("customers",filters);
        return true;
    };
    const addCustomer = async (product) => {
        return await saveDataTo("customers", product)
    };
    const updateCustomer = async (id, updatedFields) => {
        return await updateItem("customers", id, updatedFields)
    };
    const deleteCustomer = async (id) => {
        return await deleteItem("customers", id)
    };
    return {
        list,
        fetchCustomers,
        addCustomer,
        updateCustomer,
        deleteCustomer
    }
})