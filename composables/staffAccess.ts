import { doc, getDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { ADMIN_EMAIL } from "~/constants/auth";

export type StaffRole = "admin" | "cashier";

export async function resolveStaffRole(user: User): Promise<StaffRole | null> {
  if (user.email === ADMIN_EMAIL) return "admin";
  const { db } = useFirebase();
  const snapshot = await getDoc(doc(db, "staff_users", user.uid));
  const data = snapshot.data();
  return data?.role === "cashier" && data.active === true && data.email === user.email
    ? "cashier"
    : null;
}
