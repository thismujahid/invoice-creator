export const useAuth = defineStore("auth", ()=>{
    const userData = ref(null);
    const userInfo = computed(()=>userData.value);
    const snackBarText = ref('')
    return {
        userData,
        userInfo,
        snackBarText
    }
})