/**
 * Shared Firebase-auth readiness gate.
 *
 * The default layout owns the single `onAuthStateChanged` subscription and
 * reports every change via `reportAuthState()`. Pages `await useAuthReady()`
 * before their first Firestore fetch so they never fire unauthenticated
 * reads (which Firestore Rules would deny) while the auth state is still
 * restoring — and the `<slot />` outlet stays mounted the whole time, so
 * pages render their skeletons instead of a blocking app-wide loader.
 */
let settled = false;
let currentAuthed = false;
let waiters: Array<(authed: boolean) => void> = [];

export function useAuthReady(): Promise<boolean> {
  if (settled) return Promise.resolve(currentAuthed);
  return new Promise<boolean>((resolve) => {
    waiters.push(resolve);
  });
}

export function reportAuthState(authed: boolean): void {
  currentAuthed = authed;
  if (settled) return;
  settled = true;
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve(authed);
}
