import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

export async function callStaff<TInput, TResult>(name: string, input: TInput): Promise<TResult> {
  const user = getAuth(getApp()).currentUser;
  if (!user) throw new Error("Sign in first.");
  const token = await user.getIdToken();
  try {
    return await $fetch<TResult>(`/api/staff/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    });
  } catch (cause) {
    const data = cause && typeof cause === "object" && "data" in cause ? cause.data : null;
    const details = data && typeof data === "object" && "data" in data ? data.data : null;
    const message = details && typeof details === "object" && "userMessage" in details ? details.userMessage : null;
    throw new Error(typeof message === "string" && message.trim() ? message : "تعذر إتمام العملية. احتفظ بمدخلاتك وحاول مرة أخرى.");
  }
}
