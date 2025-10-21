export const userDetails = computed(() => {
  const useAuthStore = useAuth()
  return formateActiveUserKey(useAuthStore.currentUserKey);
});

export const isAdmin = computed(() => useCookie("__AU").value === "su");

export function formateActiveUserKey(key) {
  switch (key) {
    case "su":
      return {
        avatar_text: "م ع",
        name: "مسؤل",
        position: "صلاحية مطلقة",
      };
    case "c_tarek":
      return {
        avatar_text: "ط أ",
        name: "طارق أبو قاسية",
        position: "كاشير خارجي",
      };
    case "c_saleh":
      return {
        avatar_text: "ص إ",
        name: "صالح إبراهيم",
        position: "كاشير داخلي",
      };
    case "c_abanob":
      return {
        avatar_text: "أ",
        name: "أبانوب",
        position: "كاشير",
      };
    default:
      return {
        avatar_text: "م ع",
        name: "مسؤل",
        position: "صلاحية مطلقة",
      };
  }
}

export const usersList = computed(() => {
  return [
    {
      label: "الكل",
      value: null,
    },
    {
      label: "المسؤل",
      value: "su",
    },
    {
      label: "طارق أبو قاسية",
      value: "c_tarek",
    },
  ];
});
