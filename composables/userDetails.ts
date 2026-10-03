import type { ActiveUser, UserKey } from "~/types";

// Single admin user — no roles or permission levels.
export const userDetails = computed<ActiveUser>(() => {
  const useAuthStore = useAuth();
  return formateActiveUserKey(useAuthStore.currentUserKey);
});

export function formateActiveUserKey(key: unknown): ActiveUser {
  switch (key) {
    case "su":
      return { avatar_text: "م ع", name: "مسؤل", position: "صلاحية مطلقة" };
    default:
      return { avatar_text: "م ع", name: "مسؤل", position: "صلاحية مطلقة" };
  }
}
