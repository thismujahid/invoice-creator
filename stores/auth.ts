import type { UserKey } from "~/types";

export interface AuthUserData {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar?: string | null;
  id?: string;
}

export const useAuth = defineStore("auth", () => {
  // FLAG [S1]: "__AU" is a UI hint, NOT a security boundary.
  // sameSite=strict + secure reduce CSRF/leak; real auth must be
  // verified server-side (Custom Claims + Firestore rules).
  const currentUserKey = useCookie<UserKey | null | undefined>("__AU", {
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "strict",
    secure: import.meta.env.PROD,
    path: "/",
  });
  const userData = ref<AuthUserData | null>(null);
  const snackBarColor = ref<string>("primary");
  const userInfo = computed(() => userData.value);
  const snackBarText = ref<string>("");
  const currentUserKeyValue = computed(() => currentUserKey.value ?? null);

  function setUserKey(key: UserKey | null | undefined) {
    currentUserKey.value = key;
  }

  function clearSession() {
    userData.value = null;
    currentUserKey.value = null;
  }

  function notify(text: string, color = "success") {
    snackBarText.value = text;
    snackBarColor.value = color;
  }

  return {
    userData,
    userInfo,
    snackBarText,
    snackBarColor,
    currentUserKey: currentUserKeyValue,
    setUserKey,
    clearSession,
    notify,
  };
});
