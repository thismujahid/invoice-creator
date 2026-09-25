// FLAG [S1]: client-only cookie gate — UI convenience only.
// Real authorization must be enforced by Firestore Security Rules +
// Firebase Custom Claims. Do not add sensitive server routes behind this alone.
export default defineNuxtRouteMiddleware(() => {
  const au = useCookie<string | null | undefined>("__AU");
  if (au.value !== "su") {
    return navigateTo("/");
  }
});
