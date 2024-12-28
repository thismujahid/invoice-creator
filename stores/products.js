export const useProductsStore = defineStore("products", () => {
    const { readFrom, saveDataTo,updateItem, deleteItem } = useFirebase()
    const list = ref([]);
    const fetchProducts = async (filters) => {
        list.value = await readFrom("products",filters);
        return true;
    };
    const addProduct = async (product) => {
        return await saveDataTo("products", product)
    };
    const updateProduct = async (id, updatedFields) => {
        return await updateItem("products", id, updatedFields)
    };
    const deleteProduct = async (id) => {
        return await deleteItem("products", id)
    };
    return {
        list,
        fetchProducts,
        addProduct,
        updateProduct,
        deleteProduct
    }
})