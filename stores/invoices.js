export const useInvoicesStore = defineStore("invoices", () => {
    const { readFrom, saveDataTo,updateItem, deleteItem } = useFirebase()
    const list = ref([]);
    const fetchInvoices = async (filters) => {
        list.value = await readFrom("invoices",filters);
        return true;
    };
    const addInvoice = async (product) => {
        return await saveDataTo("invoices", product)
    };
    const updateInvoice = async (id, updatedFields) => {
        return await updateItem("invoices", id, updatedFields)
    };
    const deleteInvoice = async (id) => {
        return await deleteItem("invoices", id)
    };
    return {
        list,
        fetchInvoices,
        addInvoice,
        updateInvoice,
        deleteInvoice
    }
})