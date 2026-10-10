export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  const { auth } = useFirebase();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return to.path === "/login" ? undefined : navigateTo("/login", { replace: true });
  const store = useAuth();
  const role = store.userData?.id === user.uid && store.role
    ? store.role
    : await resolveStaffRole(user).catch(() => null);
  if (!role) {
    await auth.signOut();
    store.clearSession();
    return to.path === "/login" ? undefined : navigateTo("/login", { replace: true });
  }
  store.role = role;
  if (to.path === "/login") return navigateTo("/", { replace: true });
  if (role === "cashier" && !["/", "/invoices", "/debts", "/products", "/cashier-cashbox"].includes(to.path)) {
    return navigateTo("/", { replace: true });
  }
});
