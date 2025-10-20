// middleware/admin.ts
export default defineNuxtRouteMiddleware(() => {
  if (useCookie("__AU").value !== "su") {
    return navigateTo("/");
  }
});
