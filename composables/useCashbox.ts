import { collection, doc, getDocs, limit as fsLimit, orderBy, query } from "firebase/firestore";
import type { CashDirection, CashTransaction, CashTransactionType, Cashbox } from "~/types/finance";
import { round2 } from "./finance";

export interface CashAdjustInput {
  type: CashTransactionType;
  direction: CashDirection;
  amount: number;
  note?: string | null;
  customer_id?: string | null;
  invoice_id?: string | null;
  return_id?: string | null;
  loan_id?: string | null;
  product_id?: string | null;
}

export const useCashbox = defineStore("cashbox", () => {
  const { db, getDoc, serverTimestamp } = useFirebase();
  const authStore = useAuth();
  const { notify } = useAppToast();

  const balance = ref(0);
  const initialized = ref(false);
  const loading = ref(false);
  const transactions = ref<CashTransaction[]>([]);
  const loadingTxns = ref(false);

  const CASHBOX_REF = () => doc(db, "cashbox", "current");

  async function fetchCashbox(): Promise<void> {
    loading.value = true;
    try {
      const snap = await getDoc(CASHBOX_REF());
      initialized.value = snap.exists();
      balance.value = snap.exists() ? round2(Number(snap.data().balance || 0)) : 0;
    } catch (e) {
      notify("تعذر تحميل الخزنة.", "error");
    } finally {
      loading.value = false;
    }
  }

  async function fetchTransactions(max = 200): Promise<void> {
    loadingTxns.value = true;
    try {
      const q = query(collection(db, "cash_transactions"), orderBy("created_at", "desc"), fsLimit(max));
      const snap = await getDocs(q);
      transactions.value = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CashTransaction);
    } catch (e) {
      notify("تعذر تحميل سجل الخزنة.", "error");
    } finally {
      loadingTxns.value = false;
    }
  }

  /** Atomic balance mutation + immutable ledger record (F29).
   *  Never allow negative balance via normal ops (opening excluded). */
  async function adjustCash(input: CashAdjustInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const amount = round2(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "المبلغ يجب أن يكون أكبر من صفر." };
    }
    try {
      await runTx(async (tx) => {
        const ref = CASHBOX_REF();
        const snap = await tx.get(ref);
        const current = snap.exists() ? round2(Number(snap.data().balance || 0)) : 0;
        if (input.direction === "out" && input.type !== "opening_balance" && current < amount) {
          throw new Error("INSUFFICIENT_FUNDS");
        }
        const now = serverTimestamp();
        tx.set(
          ref,
          {
            balance: round2(input.direction === "in" ? current + amount : current - amount),
            updated_at: now,
          },
          { merge: true },
        );
        const logRef = doc(collection(db, "cash_transactions"));
        tx.set(logRef, {
          type: input.type,
          direction: input.direction,
          amount,
          customer_id: input.customer_id ?? null,
          invoice_id: input.invoice_id ?? null,
          return_id: input.return_id ?? null,
          loan_id: input.loan_id ?? null,
          product_id: input.product_id ?? null,
          reference_type: input.invoice_id ? "invoice" : input.loan_id ? "loan" : input.return_id ? "return" : input.product_id ? "product" : "manual",
          reference_id: input.invoice_id ?? input.loan_id ?? input.return_id ?? input.product_id ?? null,
          reference_label: input.invoice_id ? "Invoice - Customer" : input.loan_id ? "Customer Loan" : input.return_id ? "Invoice Return" : input.product_id ? "Product Adjustment" : input.direction === "in" ? "Cash Deposit" : "Cash Withdrawal",
          note: input.note ?? null,
          created_by: (authStore.currentUserKey as string) || null,
          created_at: now,
        });
      });
      await Promise.all([fetchCashbox(), fetchTransactions()]);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message === "INSUFFICIENT_FUNDS") {
        return { ok: false, error: "الرصيد الحالي لا يكفي لهذه العملية." };
      }
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  /** One-time opening balance (idempotent — refuses if cashbox exists). */
  async function ensureOpeningBalance(amount: number, note?: string | null) {
    if (initialized.value) return { ok: false as const, error: "الخزنة مهيأة مسبقاً." };
    return adjustCash({ type: "opening_balance", direction: "in", amount, note: note || "رصيد افتتاحي" });
  }

  return { balance, initialized, loading, transactions, loadingTxns, fetchCashbox, fetchTransactions, adjustCash, ensureOpeningBalance };
});
