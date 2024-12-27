export const useCustomers = defineStore("customers", ()=>{
    const list = ref([]);
    return {
        list
    }
})