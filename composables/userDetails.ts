import type { ActiveUser, UserKey } from "~/types";

export const userDetails = computed<ActiveUser>(() => {
  const useAuthStore = useAuth();
  if (useAuthStore.role === "cashier") return { avatar_text: "ك", name: "كاشير", position: "المبيعات والتحصيل" };
  return formateActiveUserKey(useAuthStore.currentUserKey);
});

export function formateActiveUserKey(key: unknown): ActiveUser {
  switch (key) {
    case "su":
      return { avatar_text: "م ع", name: "مسؤول", position: "صلاحية مطلقة" };
    default:
      return { avatar_text: "م ع", name: "مسؤول", position: "صلاحية مطلقة" };
  }
}
