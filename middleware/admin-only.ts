// FLAG [S1]: client-only cookie gate — UI convenience only.
// Real authorization must be enforced by Firestore Security Rules using
// the authenticated Firebase email. Do not use this for sensitive server routes.
export default defineNuxtRouteMiddleware(() => {
  const au = useCookie<string | null | undefined>("__AU");
  if (au.value !== "su") {
    return navigateTo("/");
  }
});
