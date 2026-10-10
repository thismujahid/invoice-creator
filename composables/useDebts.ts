import { collection, getDocs, query, where } from "firebase/firestore";
import type { CustomerLoan, DebtPaymentAllocation } from "~/types/finance";
import { normalizePhone, normalizeName, round2, toNum } from "./finance";
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
  const { db, readFrom } = useFirebase();
  let pendingLoan: { fingerprint: string; requestId: string } | null = null;
  let pendingPayment: { fingerprint: string; requestId: string } | null = null;
  /** Aggregation key: real id first; otherwise a composite legacy identity
   *  (normalized name + normalized phone) — never phone alone. */
  function customerKeyOf(o: { customer_id?: string | null; customer_phone?: string | number | null; customer_name?: string | null; phone?: string | number | null; name?: string }): string {
    if (o.customer_id) return `id:${o.customer_id}`;
    const phone = normalizePhone((o as { customer_phone?: unknown }).customer_phone ?? (o as { phone?: unknown }).phone);
    const name = normalizeName((o as { customer_name?: unknown }).customer_name ?? (o as { name?: unknown }).name);
    return `legacy:${name}|${phone}`;
  }

  /** Debt book from LIGHT summaries only — never preloads full invoices (#5).
   *  Each summary is a tiny doc maintained transactionally by every flow. */
  async function fetchDebtsBook(): Promise<CustomerDebt[]> {
    const [sumSnap, loans] = await Promise.all([
      getDocs(query(collection(db, "invoice_debt_summaries"), where("remaining", ">", 0))),
      readFrom<CustomerLoan>("customer_loans", { remaining_gt_zero: true }),
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
    try {
      const fingerprint = JSON.stringify(input);
      if (pendingLoan?.fingerprint !== fingerprint) pendingLoan = { fingerprint, requestId: crypto.randomUUID() };
      const result = await callStaff<{ requestId: string; customerId: string; amount: number; note?: string | null }, { id: string }>("createStaffLoan", {
        requestId: pendingLoan.requestId, customerId: input.customer_id, amount: input.amount, note: input.note,
      });
      pendingLoan = null;
      return { ok: true, id: result.id };
    } catch (error) {
      console.error(error);
      return { ok: false, error: "تعذر تسجيل السلفة. تحقق من رصيد الخزنة ومبلغ السلفة." };
    }
  }

  async function payDebts(input: {
    customer_id: string;
    amount?: number;
    allocations: DebtPaymentAllocation[];
    note?: string | null;
  }): Promise<{ ok: true; id: string; total: number } | { ok: false; error: string }> {
    try {
      const fingerprint = JSON.stringify(input);
      if (pendingPayment?.fingerprint !== fingerprint) pendingPayment = { fingerprint, requestId: crypto.randomUUID() };
      const total = round2(input.allocations.reduce((sum, item) => sum + Number(item.amount), 0));
      const result = await callStaff<{ requestId: string; customer_id: string; amount: number; allocations: DebtPaymentAllocation[]; note?: string | null }, { id: string; total: number }>("payStaffDebts", {
        requestId: pendingPayment.requestId, customer_id: input.customer_id, amount: input.amount ?? total,
        allocations: input.allocations, note: input.note,
      });
      pendingPayment = null;
      return { ok: true, id: result.id, total: result.total };
    } catch (error) {
      console.error(error);
      return { ok: false, error: "تعذر تسجيل السداد. راجع المبلغ والمتبقي ثم أعد المحاولة." };
    }
  }

  return { customerKeyOf, fetchDebtsBook, fetchLoansForCustomer, fetchPaymentsForCustomer, createLoan, payDebts };
});
