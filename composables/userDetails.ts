import type { ActiveUser, UserKey } from "~/types";

// FLAG [S1]: role is still derived from client cookie "__AU".
// Do not rely on this for real authorization — enforce via Firestore
// Security Rules + Firebase Custom Claims server-side. This file only
// controls UI visibility.
export const userDetails = computed<ActiveUser>(() => {
  const useAuthStore = useAuth();
  return formateActiveUserKey(useAuthStore.currentUserKey);
});

// FLAG [S1]: trivially forgeable client check (`document.cookie="__AU=su"`).
// Middleware `admin-only` must be backed by server-verified claims.
export const isAdmin = computed<boolean>(() => useCookie<string | null | undefined>("__AU").value === "su");

export function formateActiveUserKey(key: unknown): ActiveUser {
  switch (key) {
    case "su":
      return { avatar_text: "م ع", name: "مسؤل", position: "صلاحية مطلقة" };
    case "c_tarek":
      return { avatar_text: "ط أ", name: "طارق أبو قاسية", position: "كاشير خارجي" };
    case "c_saleh":
      return { avatar_text: "ص إ", name: "صالح إبراهيم", position: "كاشير داخلي" };
    case "c_abanob":
      return { avatar_text: "أ", name: "أبانوب", position: "كاشير" };
    default:
      return { avatar_text: "م ع", name: "مسؤل", position: "صلاحية مطلقة" };
  }
}

export const usersList = computed<Array<{ label: string; value: string | null }>>(() => {
  return [
    { label: "الكل", value: null },
    { label: "المسؤل", value: "su" },
    { label: "طارق أبو قاسية", value: "c_tarek" },
  ];
});
