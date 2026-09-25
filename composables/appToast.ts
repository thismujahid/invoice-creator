// Single render path: writers only set the store; app.vue watches
// snackBarText and shows exactly one Nuxt UI toast per message.
export function useAppToast() {
  const auth = useAuth();

  function notify(text: string, color: "success" | "error" | "info" = "success") {
    auth.snackBarText = text;
    auth.snackBarColor = color === "info" ? "primary" : color;
  }

  return { notify };
}
