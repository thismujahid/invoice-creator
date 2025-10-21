// middleware/admin.ts
export default defineNuxtRouteMiddleware(() => {
  const au = useCookie("__AU")
  if (au.value !== "su") {
    return navigateTo("/");
  }
});
