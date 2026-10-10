import { doc, getDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { ADMIN_EMAIL, CASHIER_EMAIL } from "~/constants/auth";

export type StaffRole = "admin" | "cashier";
const CASHIER_UID = "q1EgNKKwcvgeuf57TD49rqLbqlL2";

export async function resolveStaffRole(user: User): Promise<StaffRole | null> {
  if (user.email === ADMIN_EMAIL) return "admin";
  const { db } = useFirebase();
  const snapshot = await getDoc(doc(db, "staff_users", user.uid));
  const data = snapshot.data();
  if (user.uid === CASHIER_UID && user.email === CASHIER_EMAIL && (!data || (data.active === true && data.email === CASHIER_EMAIL))) return "cashier";
  return data?.role === "cashier" && data.active === true && data.email === user.email
    ? "cashier"
    : null;
}
