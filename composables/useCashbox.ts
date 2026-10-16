import { collection, doc, getDocs, limit as fsLimit, onSnapshot, orderBy, query, startAfter, where, type QueryDocumentSnapshot, type Unsubscribe } from "firebase/firestore";
import type { CashDirection, CashTransaction, CashTransactionType, Cashbox } from "~/types/finance";
import { round2 } from "./finance";

let cashboxUnsub: Unsubscribe | null = null;
let cashboxSession = 0;
let cashboxUid: string | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cashboxUnsub?.();
    cashboxUnsub = null;
  });
}

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
  // Start true so pages render skeletons (not empty content) while auth
  // resolves and the first fetch runs; fetchers reset them afterwards.
  const loading = ref(true);
  const syncState = ref<"idle" | "loading" | "live" | "cache" | "snapshot" | "error">("idle");
  const syncError = ref<string | null>(null);
  const transactions = ref<CashTransaction[]>([]);
  const loadingTxns = ref(true);
  const transactionsPage = ref(1);
  const transactionsHasMore = ref(false);
  const transactionCursors = ref<(QueryDocumentSnapshot | null)[]>([null]);
  const transactionFilter = ref<string | null>(null);
  const revision = ref(0);
  let transactionGeneration = 0;

  const CASHBOX_REF = () => doc(db, "cashbox", "current");

  function ensureCashboxSubscription(): void {
    if (!import.meta.client) return;
    const uid = useFirebase().auth.currentUser?.uid ?? null;
    if (!uid) return;
    if (cashboxUnsub) {
      if (cashboxUid === uid) return;
      stopCashboxSubscription();
    }
    cashboxUid = uid;
    const session = ++cashboxSession;
    syncState.value = "loading";
    syncError.value = null;
    cashboxUnsub = onSnapshot(
      CASHBOX_REF(),
      { includeMetadataChanges: true },
      (snap) => {
        if (session !== cashboxSession || !cashboxUnsub) return;
        if ((useFirebase().auth.currentUser?.uid ?? null) !== uid) return;
        initialized.value = snap.exists();
        balance.value = snap.exists() ? round2(Number(snap.data().balance || 0)) : 0;
        loading.value = false;
        syncState.value = snap.metadata.fromCache ? "cache" : "live";
        syncError.value = null;
        revision.value += 1;
      },
      (error) => {
        if (session !== cashboxSession) return;
        stopCashboxSubscription();
        syncState.value = "error";
        syncError.value = error.message;
        loading.value = false;
      },
    );
  }

  function stopCashboxSubscription(): void {
    cashboxSession += 1;
    cashboxUnsub?.();
    cashboxUnsub = null;
    if (syncState.value !== "error") syncState.value = "idle";
  }

  function clearCashbox(): void {
    stopCashboxSubscription();
    transactionGeneration += 1;
    cashboxUid = null;
    balance.value = 0;
    initialized.value = false;
    loading.value = true;
    syncState.value = "idle";
    syncError.value = null;
    transactions.value = [];
    transactionsPage.value = 1;
    transactionsHasMore.value = false;
    transactionCursors.value = [null];
    transactionFilter.value = null;
    loadingTxns.value = true;
  }

  async function fetchCashbox(): Promise<void> {
    if (cashboxUnsub) return;
    const session = cashboxSession;
    loading.value = true;
    syncState.value = "loading";
    syncError.value = null;
    try {
      const snap = await getDoc(CASHBOX_REF());
      if (session !== cashboxSession || cashboxUnsub) return;
      initialized.value = snap.exists();
      balance.value = snap.exists() ? round2(Number(snap.data().balance || 0)) : 0;
      syncState.value = "snapshot";
    } catch (e) {
      if (session !== cashboxSession || cashboxUnsub) return;
      syncState.value = "error";
      syncError.value = e instanceof Error ? e.message : "تعذر تحميل الخزنة";
      notify("تعذر تحميل الخزنة.", "error");
    } finally {
      if (session === cashboxSession && !cashboxUnsub) loading.value = false;
    }
  }

  async function fetchTransactions(max = 25, reset = true, type = transactionFilter.value): Promise<void> {
    const generation = ++transactionGeneration;
    const session = cashboxSession;
    loadingTxns.value = true;
    try {
      if (reset) {
        transactionFilter.value = type ?? null;
        transactionsPage.value = 1;
        transactionCursors.value = [null];
      }
      let q = query(collection(db, "cash_transactions"));
      if (transactionFilter.value) q = query(q, where("type", "==", transactionFilter.value));
      q = query(q, orderBy("created_at", "desc"));
      const cursor = transactionCursors.value[transactionsPage.value - 1];
      if (cursor) q = query(q, startAfter(cursor));
      q = query(q, fsLimit(max + 1));
      const snap = await getDocs(q);
      if (generation !== transactionGeneration || session !== cashboxSession) return;
      const docs = snap.docs.slice(0, max);
      transactions.value = docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CashTransaction);
      transactionsHasMore.value = snap.docs.length > max;
      if (docs.length && transactionsHasMore.value) transactionCursors.value[transactionsPage.value] = docs.at(-1) ?? null;
    } catch (e) {
      if (generation !== transactionGeneration || session !== cashboxSession) return;
      notify("تعذر تحميل سجل الخزنة.", "error");
    } finally {
      if (generation === transactionGeneration && session === cashboxSession) loadingTxns.value = false;
    }
  }

  async function nextTransactionsPage(max = 25): Promise<void> {
    if (loadingTxns.value || !transactionsHasMore.value) return;
    transactionsPage.value += 1;
    await fetchTransactions(max, false);
  }

  async function previousTransactionsPage(max = 25): Promise<void> {
    if (loadingTxns.value || transactionsPage.value <= 1) return;
    transactionsPage.value -= 1;
    await fetchTransactions(max, false);
  }

  /** Atomic balance mutation + immutable ledger record (F29).
   *  Never allow negative balance via normal ops (opening excluded).
   *  Non-opening ops require an initialized cashbox; opening is enforced
   *  transactionally (not via client flag) so concurrent tabs can't double-apply. */
  async function adjustCash(input: CashAdjustInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const amount = round2(input.amount);
    const opening = input.type === "opening_balance";
    if (!Number.isFinite(amount) || amount < 0 || (!opening && amount <= 0)) {
      return { ok: false, error: "المبلغ يجب أن يكون أكبر من صفر." };
    }
    try {
      let resultingBalance = balance.value;
      await runTx(async (tx) => {
        const ref = CASHBOX_REF();
        const snap = await tx.get(ref);
        if (input.type === "opening_balance") {
          if (snap.exists()) throw new Error("ALREADY_INITIALIZED");
        } else if (!snap.exists()) {
          throw new Error("CASHBOX_NOT_INITIALIZED");
        }
        const current = snap.exists() ? round2(Number(snap.data().balance || 0)) : 0;
        if (input.direction === "out" && input.type !== "opening_balance" && current < amount) {
          throw new Error("INSUFFICIENT_FUNDS");
        }
        const now = serverTimestamp();
        resultingBalance = round2(input.direction === "in" ? current + amount : current - amount);
        tx.set(
          ref,
          {
            balance: resultingBalance,
            updated_at: now,
          },
          { merge: true },
        );
        if (amount > 0) {
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
            reference_label: input.invoice_id ? "فاتورة بيع لـ عميل" : input.loan_id ? "سلفة عميل" : input.return_id ? "مرتجع فاتورة" : input.product_id ? "تسوية مخزون" : input.direction === "in" ? "إيداع نقدي" : "سحب نقدي",
            note: input.note ?? null,
            created_by: (authStore.currentUserKey as string) || null,
            created_at: now,
          });
        }
      });
      balance.value = resultingBalance;
      initialized.value = true;
      await fetchTransactions(25, true);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message === "INSUFFICIENT_FUNDS") {
        return { ok: false, error: "الرصيد الحالي لا يكفي لهذه العملية." };
      }
      if (e instanceof Error && e.message === "ALREADY_INITIALIZED") {
        return { ok: false, error: "الخزنة مهيأة مسبقاً." };
      }
      if (e instanceof Error && e.message === "CASHBOX_NOT_INITIALIZED") {
        return { ok: false, error: "هيّئ الخزنة بالرصيد الافتتاحي أولاً." };
      }
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  /** One-time opening balance — idempotency enforced INSIDE the transaction
   *  (client flag is only a fast-path; two tabs/devices can't double-apply). */
  async function ensureOpeningBalance(amount: number, note?: string | null) {
    return adjustCash({ type: "opening_balance", direction: "in", amount, note: note || "رصيد افتتاحي" });
  }

  return { balance, initialized, loading, syncState, syncError, transactions, loadingTxns, transactionsPage, transactionsHasMore, revision, transactionFilter, ensureCashboxSubscription, stopCashboxSubscription, clearCashbox, fetchCashbox, fetchTransactions, nextTransactionsPage, previousTransactionsPage, adjustCash, ensureOpeningBalance };
});
