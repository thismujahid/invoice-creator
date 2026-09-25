import { collection, doc } from "firebase/firestore";
import type { CustomerLoan, DebtPaymentAllocation } from "~/types/finance";
import type { Customer, Invoice } from "~/types";
import { loanStatusOf, normalizePhone, round2, toNum, invoiceTotals } from "./finance";
import { toDateSafe } from "~/types";

export interface Obligation {
  kind: "invoice" | "loan";
  id: string;
  label: string;
  total: number;
  paid: number;
  remaining: number;
  date: Date | null;
  ref: Invoice | CustomerLoan;
}

export interface CustomerDebt {
  key: string;
  customer_id: string | null;
  name: string;
  phone: string | number | null;
  invoices: Obligation[];
  loans: Obligation[];
  invoiceDebt: number;
  loanDebt: number;
  totalDebt: number;
  unpaidCount: number;
}

export const useDebts = defineStore("debts", () => {
  const { db, serverTimestamp, readFrom } = useFirebase();
  const authStore = useAuth();
  const { notify } = useAppToast();

  const creator = () => (authStore.currentUserKey as string) || null;

  /** Remaining for an invoice doc snapshot: stored first, computed fallback (legacy). */
  function remainingOf(data: Record<string, unknown>): number {
    if (data.remaining !== null && data.remaining !== undefined) return round2(toNum(data.remaining));
    const t = invoiceTotals({
      products: (Array.isArray(data.products) ? data.products : []) as Invoice["products"],
      discount: data.discount as Invoice["discount"],
      discount_percentage: data.discount_percentage as boolean | undefined,
      debt: data.debt as Invoice["debt"],
      delivery_price: data.delivery_price as Invoice["delivery_price"],
      amount_of_animal_feeds: data.amount_of_animal_feeds as Invoice["amount_of_animal_feeds"],
      amount_of_mahros: data.amount_of_mahros as Invoice["amount_of_mahros"],
      paid_amount: data.paid_amount as Invoice["paid_amount"],
    });
    return t.remaining;
  }
  /** Aggregation key: real id first, then normalized phone, then name. */
  function customerKeyOf(o: { customer_id?: string | null; customer_phone?: string | number | null; customer_name?: string | null; phone?: string | number | null; name?: string }): string {
    if (o.customer_id) return `id:${o.customer_id}`;
    const phone = normalizePhone((o as { customer_phone?: unknown }).customer_phone ?? (o as { phone?: unknown }).phone);
    if (phone) return `phone:${phone}`;
    return `name:${String((o as { customer_name?: unknown }).customer_name ?? (o as { name?: unknown }).name ?? "").trim()}`;
  }

  function debtOfInvoice(inv: Invoice): number {
    if (inv.remaining !== null && inv.remaining !== undefined) return round2(toNum(inv.remaining));
    const { invoiceTotals } = useFinance();
    return invoiceTotals(inv).remaining;
  }

  /** Aggregate all outstanding debts by customer (F15). Small scale: client-side. */
  async function fetchDebtsBook(): Promise<CustomerDebt[]> {
    const [invoices, loans] = await Promise.all([
      readFrom<Invoice>("invoices"),
      readFrom<CustomerLoan>("customer_loans"),
    ]);
    const map = new Map<string, CustomerDebt>();
    const ensure = (
      key: string,
      o: { customer_id?: string | null; name?: string | null; phone?: string | number | null },
    ): CustomerDebt => {
      let e = map.get(key);
      if (!e) {
        e = {
          key,
          customer_id: o.customer_id ?? null,
          name: String(o.name ?? "بدون اسم"),
          phone: (o.phone as string | number | null) ?? null,
          invoices: [],
          loans: [],
          invoiceDebt: 0,
          loanDebt: 0,
          totalDebt: 0,
          unpaidCount: 0,
        };
        map.set(key, e);
      }
      return e;
    };
    for (const inv of invoices) {
      const rem = debtOfInvoice(inv);
      if (!(rem > 0)) continue;
      const key = customerKeyOf({ customer_id: inv.customer_id, customer_phone: inv.customer_phone, customer_name: inv.customer_name });
      const e = ensure(key, { customer_id: inv.customer_id ?? null, name: inv.customer_name, phone: inv.customer_phone ?? null });
      e.invoices.push({
        kind: "invoice",
        id: inv.id as string,
        label: `فاتورة ${inv.customer_name || ""}`,
        total: round2(toNum(inv.paid_amount) + rem),
        paid: round2(toNum(inv.paid_amount)),
        remaining: rem,
        date: toDateSafe(inv.date),
        ref: inv,
      });
      e.invoiceDebt = round2(e.invoiceDebt + rem);
      e.unpaidCount += 1;
    }
    for (const loan of loans) {
      const rem = round2(toNum(loan.remaining));
      if (!(rem > 0)) continue;
      const key = customerKeyOf({ customer_id: loan.customer_id, phone: loan.customer_phone, name: loan.customer_name });
      const e = ensure(key, { customer_id: loan.customer_id, name: loan.customer_name, phone: loan.customer_phone ?? null });
      e.loans.push({
        kind: "loan",
        id: loan.id as string,
        label: `سلفة ${loan.customer_name}`,
        total: round2(toNum(loan.amount)),
        paid: round2(toNum(loan.paid_amount)),
        remaining: rem,
        date: toDateSafe(loan.created_at),
        ref: loan,
      });
      e.loanDebt = round2(e.loanDebt + rem);
    }
    const out = [...map.values()].map((e) => ({ ...e, totalDebt: round2(e.invoiceDebt + e.loanDebt) }));
    out.sort((a, b) => b.totalDebt - a.totalDebt);
    return out;
  }

  async function fetchLoansForCustomer(customer_id: string): Promise<CustomerLoan[]> {
    return readFrom<CustomerLoan>("customer_loans", { customer_id });
  }

  async function fetchPaymentsForCustomer(customer_id: string) {
    return readFrom<import("~/types/finance").DebtPayment>("debt_payments", { customer_id });
  }

  /** Atomic loan creation: loan doc + cashbox out + ledger (F17/F29). */
  async function createLoan(input: {
    customer_id: string;
    customer_name: string;
    customer_phone?: string | number | null;
    amount: number;
    note?: string | null;
  }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const amount = round2(input.amount);
    if (!input.customer_id) return { ok: false, error: "حدد العميل أولاً." };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "مبلغ السلفة يجب أن يكون أكبر من صفر." };
    try {
      let loanId = "";
      await runTx(async (tx) => {
        const cRef = doc(db, "cashbox", "current");
        const cSnap = await tx.get(cRef);
        const bal = cSnap.exists() ? round2(Number(cSnap.data().balance || 0)) : 0;
        if (bal < amount) throw new Error("VALIDATION:رصيد الخزنة لا يكفي مبلغ السلفة.");
        const now = serverTimestamp();
        const loanRef = doc(collection(db, "customer_loans"));
        loanId = loanRef.id;
        tx.set(loanRef, {
          customer_id: input.customer_id,
          customer_name: input.customer_name,
          customer_phone: input.customer_phone ?? null,
          amount,
          paid_amount: 0,
          remaining: amount,
          status: "open",
          note: input.note ?? null,
          created_by: creator(),
          created_at: now,
        });
        tx.set(cRef, { balance: round2(bal - amount), updated_at: now }, { merge: true });
        tx.set(doc(collection(db, "cash_transactions")), {
          type: "customer_loan",
          direction: "out",
          amount,
          customer_id: input.customer_id,
          loan_id: loanId,
          note: input.note ?? null,
          created_by: creator(),
          created_at: now,
        });
      });
      return { ok: true, id: loanId };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) return { ok: false, error: e.message.slice(11) };
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  /** Atomic debt payment with manual allocations (F18/F19/F29). */
  async function payDebts(input: {
    customer_id: string;
    allocations: DebtPaymentAllocation[];
    note?: string | null;
  }): Promise<{ ok: true; id: string; total: number } | { ok: false; error: string }> {
    const allocs = (input.allocations ?? [])
      .map((a) => ({ ...a, amount: round2(toNum(a.amount)) }))
      .filter((a) => a.reference_id && a.amount > 0 && (a.type === "invoice" || a.type === "loan"));
    if (!input.customer_id) return { ok: false, error: "حدد العميل أولاً." };
    if (!allocs.length) return { ok: false, error: "حدد مبلغاً واحداً على الأقل أكبر من صفر." };
    const total = round2(allocs.reduce((s, a) => s + a.amount, 0));
    try {
      let payId = "";
      await runTx(async (tx) => {
        // 1. Read + validate every obligation against its CURRENT remaining.
        const states: { a: DebtPaymentAllocation; remaining: number; paid: number; kind: "invoice" | "loan" }[] = [];
        for (const a of allocs) {
          if (a.type === "invoice") {
            const snap = await tx.get(doc(db, "invoices", a.reference_id));
            if (!snap.exists()) throw new Error("VALIDATION:إحدى الفواتير غير موجودة.");
            const d = snap.data() as Record<string, unknown>;
            const rem = remainingOf(d);
            if (a.amount - rem > 1e-9) throw new Error("VALIDATION:مبلغ مخصص يتجاوز المتبقي على إحدى الفواتير.");
            states.push({ a, remaining: rem, paid: round2(toNum(d.paid_amount)), kind: "invoice" });
          } else {
            const snap = await tx.get(doc(db, "customer_loans", a.reference_id));
            if (!snap.exists()) throw new Error("VALIDATION:إحدى السلف غير موجودة.");
            const d = snap.data() as Record<string, unknown>;
            const rem = round2(toNum(d.remaining));
            if (a.amount - rem > 1e-9) throw new Error("VALIDATION:مبلغ مخصص يتجاوز المتبقي على إحدى السلف.");
            states.push({ a, remaining: rem, paid: round2(toNum(d.paid_amount)), kind: "loan" });
          }
        }
        // 2. Cashbox in (always valid direction).
        const cRef = doc(db, "cashbox", "current");
        const cSnap = await tx.get(cRef);
        const bal = cSnap.exists() ? round2(Number(cSnap.data().balance || 0)) : 0;
        const now = serverTimestamp();
        const by = creator();
        // 3. Parent payment doc (id known for cash refs).
        const payRef = doc(collection(db, "debt_payments"));
        payId = payRef.id;
        tx.set(payRef, {
          customer_id: input.customer_id,
          amount: total,
          allocations: allocs,
          note: input.note ?? null,
          created_by: by,
          created_at: now,
        });
        tx.set(cRef, { balance: round2(bal + total), updated_at: now }, { merge: true });
        // 4. Apply + per-allocation cash txns (itemized ledger).
        for (const s of states) {
          const left = round2(s.remaining - s.a.amount);
          const paid = round2(s.paid + s.a.amount);
          if (s.kind === "invoice") {
            tx.update(doc(db, "invoices", s.a.reference_id), { remaining: left, paid_amount: paid });
            tx.set(doc(collection(db, "cash_transactions")), {
              type: "invoice_payment", direction: "in", amount: s.a.amount,
              customer_id: input.customer_id, invoice_id: s.a.reference_id,
              debt_payment_id: payId, note: input.note ?? null, created_by: by, created_at: now,
            });
          } else {
            tx.update(doc(db, "customer_loans", s.a.reference_id), {
              remaining: left, paid_amount: paid, status: loanStatusOf(paid, left),
            });
            tx.set(doc(collection(db, "cash_transactions")), {
              type: "loan_payment", direction: "in", amount: s.a.amount,
              customer_id: input.customer_id, loan_id: s.a.reference_id,
              debt_payment_id: payId, note: input.note ?? null, created_by: by, created_at: now,
            });
          }
        }
      });
      return { ok: true, id: payId, total };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) return { ok: false, error: e.message.slice(11) };
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  return { customerKeyOf, debtOfInvoice, fetchDebtsBook, fetchLoansForCustomer, fetchPaymentsForCustomer, createLoan, payDebts };
});
