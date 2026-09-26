import { collection, doc, getDocs } from "firebase/firestore";
import type { CustomerLoan, DebtPaymentAllocation } from "~/types/finance";
import type { Customer, Invoice } from "~/types";
import { loanStatusOf, normalizePhone, normalizeName, round2, toNum, outstandingDebtOf } from "./finance";
import { summarizeInvoice, writeDebtSummary } from "./debtSummaries";
import { toDateSafe } from "~/types";

export interface Obligation {
  kind: "invoice" | "loan";
  id: string;
  label: string;
  total: number;
  paid: number;
  remaining: number;
  date: Date | null;
  /** Minimal ref: loans carry their note; invoices carry nothing (fetched on demand). */
  ref: { note?: string | null } | null;
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

  /** Remaining for an invoice doc snapshot — shared legacy-safe rule. */
  function remainingOf(data: Record<string, unknown>): number {
    return outstandingDebtOf({
      products: (Array.isArray(data.products) ? data.products : []) as Invoice["products"],
      discount: data.discount as Invoice["discount"],
      discount_percentage: data.discount_percentage as boolean | undefined,
      debt: data.debt as Invoice["debt"],
      delivery_price: data.delivery_price as Invoice["delivery_price"],
      amount_of_animal_feeds: data.amount_of_animal_feeds as Invoice["amount_of_animal_feeds"],
      amount_of_mahros: data.amount_of_mahros as Invoice["amount_of_mahros"],
      paid_amount: data.paid_amount as Invoice["paid_amount"],
      remaining: data.remaining as Invoice["remaining"],
    });
  }
  /** Aggregation key: real id first; otherwise a composite legacy identity
   *  (normalized name + normalized phone) — never phone alone. */
  function customerKeyOf(o: { customer_id?: string | null; customer_phone?: string | number | null; customer_name?: string | null; phone?: string | number | null; name?: string }): string {
    if (o.customer_id) return `id:${o.customer_id}`;
    const phone = normalizePhone((o as { customer_phone?: unknown }).customer_phone ?? (o as { phone?: unknown }).phone);
    const name = normalizeName((o as { customer_name?: unknown }).customer_name ?? (o as { name?: unknown }).name);
    return `legacy:${name}|${phone}`;
  }

  function debtOfInvoice(inv: Invoice): number {
    return outstandingDebtOf(inv);
  }

  /** Debt book from LIGHT summaries only — never preloads full invoices (#5).
   *  Each summary is a tiny doc maintained transactionally by every flow. */
  async function fetchDebtsBook(): Promise<CustomerDebt[]> {
    const [sumSnap, loans] = await Promise.all([
      getDocs(collection(db, "invoice_debt_summaries")),
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
    for (const d of sumSnap.docs) {
      const s = d.data() as Record<string, unknown>;
      const rem = round2(toNum(s.remaining));
      if (!(rem > 0)) continue;
      const key = customerKeyOf({
        customer_id: (s.customer_id as string) || null,
        customer_phone: s.customer_phone as string | number | null,
        customer_name: s.customer_name as string | null,
      });
      const e = ensure(key, {
        customer_id: (s.customer_id as string) || null,
        name: s.customer_name as string | null,
        phone: (s.customer_phone as string | number | null) ?? null,
      });
      e.invoices.push({
        kind: "invoice",
        id: d.id,
        label: `فاتورة ${String(s.customer_name || "")}`,
        total: round2(toNum(s.total)),
        paid: round2(toNum(s.paid)),
        remaining: rem,
        date: toDateSafe(s.date),
        ref: null,
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
        ref: { note: loan.note ?? null },
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
          reference_type: "loan",
          reference_id: loanId,
          reference_label: `Customer Loan - ${input.customer_name}`,
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
    amount?: number;
    allocations: DebtPaymentAllocation[];
    note?: string | null;
  }): Promise<{ ok: true; id: string; total: number } | { ok: false; error: string }> {
    if (!input.customer_id) return { ok: false, error: "حدد العميل أولاً." };
    const rawAllocations = input.allocations ?? [];
    if (!Array.isArray(rawAllocations) || rawAllocations.some((a) => !a.reference_id || !Number.isFinite(Number(a.amount)) || !(Number(a.amount) > 0) || (a.type !== "invoice" && a.type !== "loan"))) {
      return { ok: false, error: "تأكد من صحة كل المبالغ والفواتير المحددة." };
    }
    const allocs = rawAllocations.map((a) => ({ ...a, amount: round2(Number(a.amount)) }));
    if (!allocs.length) return { ok: false, error: "حدد مبلغاً واحداً على الأقل أكبر من صفر." };
    const allocationKeys = new Set<string>();
    for (const a of allocs) {
      const key = `${a.type}:${a.reference_id}`;
      if (allocationKeys.has(key)) return { ok: false, error: "لا يمكن تكرار الفاتورة أو السلفة في دفعة واحدة." };
      allocationKeys.add(key);
    }
    const total = round2(allocs.reduce((s, a) => s + a.amount, 0));
    if (input.amount !== undefined && (!Number.isFinite(Number(input.amount)) || Math.abs(total - round2(input.amount)) > 0.005)) {
      return { ok: false, error: "مجموع التوزيعات لا يساوي مبلغ الدفعة." };
    }
    try {
      let payId = "";
      await runTx(async (tx) => {
        // 1. Read + validate every obligation against its CURRENT remaining.
        const states: { a: DebtPaymentAllocation; remaining: number; paid: number; kind: "invoice" | "loan"; doc: Record<string, unknown> }[] = [];
        let legacyCustomer: Record<string, unknown> | null = null;
        for (const a of allocs) {
          if (a.type === "invoice") {
            const snap = await tx.get(doc(db, "invoices", a.reference_id));
            if (!snap.exists()) throw new Error("VALIDATION:إحدى الفواتير غير موجودة.");
            const d = snap.data() as Record<string, unknown>;
            if (typeof d.customer_id === "string" && d.customer_id !== input.customer_id) {
              throw new Error("VALIDATION:الفاتورة المحددة لا تخص هذا العميل.");
            }
            if (!d.customer_id) {
              if (!legacyCustomer) {
                const customerSnap = await tx.get(doc(db, "customers", input.customer_id));
                if (customerSnap.exists()) legacyCustomer = customerSnap.data() as Record<string, unknown>;
              }
              const legacyMatches = !!legacyCustomer
                && normalizeName(d.customer_name) === normalizeName(legacyCustomer.name)
                && !!normalizePhone(d.customer_phone)
                && normalizePhone(d.customer_phone) === normalizePhone(legacyCustomer.phone);
              if (!legacyMatches) throw new Error("VALIDATION:تعذر التحقق من ملكية الفاتورة القديمة لهذا العميل.");
            }
            const rem = remainingOf(d);
            if (a.amount - rem > 1e-9) throw new Error("VALIDATION:مبلغ مخصص يتجاوز المتبقي على إحدى الفواتير.");
            states.push({ a, remaining: rem, paid: round2(toNum(d.paid_amount)), kind: "invoice", doc: d });
          } else {
            const snap = await tx.get(doc(db, "customer_loans", a.reference_id));
            if (!snap.exists()) throw new Error("VALIDATION:إحدى السلف غير موجودة.");
            const d = snap.data() as Record<string, unknown>;
            if (d.customer_id !== input.customer_id) throw new Error("VALIDATION:السلفة المحددة لا تخص هذا العميل.");
            const rem = round2(toNum(d.remaining));
            if (a.amount - rem > 1e-9) throw new Error("VALIDATION:مبلغ مخصص يتجاوز المتبقي على إحدى السلف.");
            states.push({ a, remaining: rem, paid: round2(toNum(d.paid_amount)), kind: "loan", doc: d });
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
            writeDebtSummary(tx, db, {
              invoice_id: s.a.reference_id,
              customer_id: (s.doc.customer_id as string) || null,
              customer_name: (s.doc.customer_name as string | null) ?? null,
              customer_phone: (s.doc.customer_phone as string | number | null) ?? null,
              date: (s.doc.date as unknown) ?? null,
              ...summarizeInvoice({ ...(s.doc as object), paid_amount: paid, remaining: left } as Invoice),
            });
            tx.set(doc(collection(db, "cash_transactions")), {
              type: "invoice_payment", direction: "in", amount: s.a.amount,
              customer_id: input.customer_id, invoice_id: s.a.reference_id,
              debt_payment_id: payId, note: input.note ?? null, created_by: by, created_at: now,
              reference_type: "invoice", reference_id: s.a.reference_id,
              reference_label: `Debt Payment - ${String(s.doc.customer_name || "Customer")}`,
            });
          } else {
            tx.update(doc(db, "customer_loans", s.a.reference_id), {
              remaining: left, paid_amount: paid, status: loanStatusOf(paid, left),
            });
            tx.set(doc(collection(db, "cash_transactions")), {
              type: "loan_payment", direction: "in", amount: s.a.amount,
              customer_id: input.customer_id, loan_id: s.a.reference_id,
              debt_payment_id: payId, note: input.note ?? null, created_by: by, created_at: now,
              reference_type: "loan", reference_id: s.a.reference_id,
              reference_label: `Loan Payment - ${String(s.doc.customer_name || "Customer")}`,
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

  return { customerKeyOf, fetchDebtsBook, fetchLoansForCustomer, fetchPaymentsForCustomer, createLoan, payDebts };
});
