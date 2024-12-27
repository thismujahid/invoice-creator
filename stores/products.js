export const useProductsStore = defineStore("products", ()=>{
    const list = ref([]);
    return {
        list
    }
})