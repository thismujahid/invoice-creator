export const useAuth = defineStore("auth", () => {
    const currentUserKey = useCookie("__AU", {
        maxAge: 60 * 60 * 24 * 30
    });
    const userData = ref(null);
    const snackBarColor = ref("primary")
    const userInfo = computed(() => userData.value);
    const snackBarText = ref('');
    function setUserKey(key){
        currentUserKey.value = key
    }
    return {
        userData,
        userInfo,
        snackBarText,
        snackBarColor,
        currentUserKey:computed(()=>currentUserKey.value),
        setUserKey
    }
})