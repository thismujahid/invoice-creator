import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

export async function callStaff<TInput, TResult>(name: string, input: TInput): Promise<TResult> {
  const user = getAuth(getApp()).currentUser;
  if (!user) throw new Error("Sign in first.");
  const token = await user.getIdToken();
  return $fetch<TResult>(`/api/staff/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
