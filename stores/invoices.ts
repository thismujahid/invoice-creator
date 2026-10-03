import { and, collection, doc, getDocs, limit as fsLimit, orderBy, or, query, startAfter, Timestamp, where, type Query, type QueryDocumentSnapshot } from "firebase/firestore";
import type { Invoice } from "~/types";
import { toDateSafe } from "~/types";
import { applyStockGroup, invoiceEditCashOutflowError, invoiceEditCustomerChangeError, invoiceEditPaymentError, invoiceEditStockChanges, invoiceHasReturnHistory, invoiceTotals, lineBaseQuantity, lineUnitFactor, merchandiseProfitOf, round2, round4, toNum } from "~/composables/finance";
import { summarizeInvoice, writeDebtSummary } from "~/composables/debtSummaries";
import { customerSummaryId, writeCustomerSummaryDelta, writeInvoiceStatsDelta } from "~/composables/performanceSummaries";
import { formatInvoiceLineName } from "~/composables/helpers";

const STOCK_EPS = 1e-9;
const INVOICE_PAGE_SIZE = 25;

export const useInvoicesStore = defineStore("invoices", () => {
  const { readFrom, saveDataTo, updateItem, db, serverTimestamp, getDoc } = useFirebase();
  const authStore = useAuth();
  const { notify } = useAppToast();
  const list = ref<Invoice[]>([]);
  const invoiceToEdit = ref<Invoice | undefined>(undefined);

  // Substring search without per-keystroke full scans:
  // - New docs carry normalized `customer_name_norm` + `customer_phone_digits`
  //   so prefix queries serve the common case with bounded reads.
  // - True middle-match still falls back to one TTL-cached full read, but only
  //   when prefix candidates are insufficient (not on every keystroke path).
  let searchCache: { at: number; docs: { snap: QueryDocumentSnapshot; data: Invoice }[] } | null = null;
  const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
  function invalidateCache(): void {
    searchCache = null;
  }
  function invoiceSearchKeys(name: unknown, phone: unknown): { customer_name_norm: string; customer_phone_digits: string } {
    return {
      customer_name_norm: String(name ?? "").trim().toLocaleLowerCase(),
      customer_phone_digits: String(phone ?? "").replace(/\D/g, ""),
    };
  }
  async function readAllInvoicesCached(): Promise<{ snap: QueryDocumentSnapshot; data: Invoice }[]> {
    if (searchCache && Date.now() - searchCache.at < SEARCH_CACHE_TTL_MS) return searchCache.docs;
    const snapshot = await getDocs(collection(db, "invoices"));
    const docs = snapshot.docs.map((d) => ({ snap: d, data: { id: d.id, ...(d.data() as object) } as Invoice }));
    searchCache = { at: Date.now(), docs };
    return docs;
  }
  async function readPrefixCandidates(term: string, termDigits: string, pageSize: number): Promise<{ snap: QueryDocumentSnapshot; data: Invoice }[]> {
    const out = new Map<string, { snap: QueryDocumentSnapshot; data: Invoice }>();
    const collect = (docs: { snap: QueryDocumentSnapshot; data: Invoice }[]): void => {
      for (const entry of docs) if (!out.has(entry.snap.id)) out.set(entry.snap.id, entry);
    };
    try {
      const lower = term.toLocaleLowerCase();
      if (lower) {
        // Prefix on normalized name (bounded, indexed single-field range).
        const nameQ = query(
          collection(db, "invoices"),
          where("customer_name_norm", ">=", lower),
          where("customer_name_norm", "<=", `${lower}\uf8ff`),
          fsLimit(Math.max(pageSize * 2, 25)),
        );
        const nameSnap = await getDocs(nameQ);
        collect(nameSnap.docs.map((d) => ({ snap: d, data: { id: d.id, ...(d.data() as object) } as Invoice })));
      }
      if (termDigits) {
        const phoneQ = query(
          collection(db, "invoices"),
          where("customer_phone_digits", ">=", termDigits),
          where("customer_phone_digits", "<=", `${termDigits}\uf8ff`),
          fsLimit(Math.max(pageSize * 2, 25)),
        );
        const phoneSnap = await getDocs(phoneQ);
        collect(phoneSnap.docs.map((d) => ({ snap: d, data: { id: d.id, ...(d.data() as object) } as Invoice })));
      }
    } catch {
      // Missing normalized fields/indexes on legacy docs → caller falls back.
    }
    return [...out.values()];
  }

  function invoicesQuery(filters: Record<string, string | number | boolean | Date | null | undefined>) {
    let q: Query = collection(db, "invoices");
    if (filters.date instanceof Date) {
      const start = new Date(filters.date); start.setHours(0, 0, 0, 0);
      const end = new Date(filters.date); end.setHours(23, 59, 59, 999);
      q = query(q, where("date", ">=", Timestamp.fromDate(start)), where("date", "<=", Timestamp.fromDate(end)));
    }
    if (filters.remaining) q = query(q, where("remaining", ">=", 0.1));
    const customerId = String(filters.customer_id ?? "");
    const customerName = String(filters.customer_name ?? "");
    const customerPhone = filters.customer_phone;
    // Phones are historically mixed string|number in Firestore and `==` is
    // type-strict: a string param never matches a numeric field (leading
    // zeros are also lost in numeric storage). Query both spellings so old
    // invoices link regardless of how the phone was stored.
    const phoneStr = String(customerPhone ?? "");
    const phoneDigits = phoneStr.replace(/\D/g, "");
    const phoneNum = phoneDigits.length >= 7 ? Number(phoneDigits) : NaN;
    const namePhoneBranches = [
      and(where("customer_name", "==", customerName), where("customer_phone", "==", customerPhone)),
    ];
    if (Number.isFinite(phoneNum)) {
      namePhoneBranches.push(
        and(where("customer_name", "==", customerName), where("customer_phone", "==", phoneNum)),
      );
    }
    if (customerId && customerName && phoneStr !== "") {
      q = query(q, or(where("customer_id", "==", customerId), ...namePhoneBranches));
    } else if (customerId) q = query(q, where("customer_id", "==", customerId));
    else if (customerName && phoneStr !== "") q = query(q, or(...namePhoneBranches));
    return q;
  }

  /** Client-side predicate for the merged fetch below: a row must satisfy
   *  every active criterion (customer + search + date + remaining). */
  function matchesScopedInvoice(
    inv: Invoice,
    criteria: {
      customerId: string;
      customerName: string;
      phoneStr: string;
      phoneNum: number;
      date: Date | null;
      remaining: number | null;
      term: string;
      termDigits: string;
    },
  ): boolean {
    if (criteria.customerId && inv.customer_id !== criteria.customerId) {
      // Fall back to name+phone when the row itself was never linked.
      if (
        !criteria.customerName ||
        inv.customer_name !== criteria.customerName ||
        !phonesEqual(inv.customer_phone, criteria.phoneStr, criteria.phoneNum)
      ) {
        return false;
      }
    } else if (criteria.customerName && criteria.phoneStr) {
      if (inv.customer_name !== criteria.customerName || !phonesEqual(inv.customer_phone, criteria.phoneStr, criteria.phoneNum)) return false;
    }
    if (criteria.term) {
      const name = String(inv.customer_name ?? "").toLocaleLowerCase();
      const phoneText = String(inv.customer_phone ?? "");
      const phoneDigits = phoneText.replace(/\D/g, "");
      const termLower = criteria.term.toLocaleLowerCase();
      const hit =
        name.includes(termLower) ||
        phoneText.includes(criteria.term) ||
        (criteria.termDigits !== "" && phoneDigits.includes(criteria.termDigits));
      if (!hit) return false;
    }
    if (criteria.date) {
      const d = toDateSafe(inv.date);
      if (!d || d.toDateString() !== criteria.date.toDateString()) return false;
    }
    if (criteria.remaining !== null) {
      const outstanding = Number((inv as { remaining?: unknown }).remaining ?? 0);
      if (!(outstanding >= criteria.remaining)) return false;
    }
    return true;
  }

  function phonesEqual(stored: unknown, phoneStr: string, phoneNum: number): boolean {
    if (stored === phoneStr) return true;
    if (typeof stored === "number" && Number.isFinite(phoneNum) && stored === phoneNum) return true;
    if (typeof stored === "string" && phoneStr !== "") {
      const a = stored.replace(/\D/g, "");
      const b = phoneStr.replace(/\D/g, "");
      if (a !== "" && a === b) return true;
    }
    return false;
  }

  async function fetchInvoicePage(
    filters: Record<string, string | number | boolean | Date | null | undefined>,
    cursor: QueryDocumentSnapshot | null,
    pageSize = INVOICE_PAGE_SIZE,
  ): Promise<{ items: Invoice[]; cursor: QueryDocumentSnapshot | null; hasMore: boolean; error?: string | null }> {
    try {
      const customerId = String(filters.customer_id ?? "");
      const customerName = String(filters.customer_name ?? "");
      const phoneStr = String(filters.customer_phone ?? "");
      const phoneDigits = phoneStr.replace(/\D/g, "");
      const phoneNum = phoneDigits.length >= 7 ? Number(phoneDigits) : NaN;
      const term = String(filters.search ?? "").trim();
      const termDigits = term.replace(/\D/g, "");
      const dateFilter = filters.date instanceof Date ? filters.date : null;
      const remainingFilter =
        filters.remaining === undefined || filters.remaining === null || filters.remaining === ""
          ? null
          : Number(filters.remaining);
      const customerFiltered = !!customerId || (customerName !== "" && phoneStr !== "");
      if (customerFiltered || term !== "") {
        // Scoped fetch: bounded prefix queries first (cheap), full cached scan
        // only as a middle-match fallback when prefixes are insufficient.
        const seen = new Map<string, { snap: QueryDocumentSnapshot; data: Invoice }>();
        const collect = (docs: { snap: QueryDocumentSnapshot; data: Invoice }[]): void => {
          for (const entry of docs) {
            if (!seen.has(entry.snap.id)) seen.set(entry.snap.id, entry);
          }
        };
        if (term !== "") {
          collect(await readPrefixCandidates(term, termDigits, pageSize));
          // Fallback preserves %text% middle-match correctness for legacy docs
          // lacking normalized keys or non-prefix hits — still TTL-cached.
          if (seen.size < pageSize) collect(await readAllInvoicesCached());
        } else {
          const subqueries: Query[] = [];
          if (customerId) subqueries.push(query(collection(db, "invoices"), where("customer_id", "==", customerId)));
          if (customerName !== "" && phoneStr !== "") {
            subqueries.push(query(collection(db, "invoices"), where("customer_name", "==", customerName), where("customer_phone", "==", filters.customer_phone)));
            if (Number.isFinite(phoneNum)) {
              subqueries.push(query(collection(db, "invoices"), where("customer_name", "==", customerName), where("customer_phone", "==", phoneNum)));
            }
          }
          for (const sub of subqueries) {
            const snapshot = await getDocs(sub);
            collect(snapshot.docs.map((d) => ({ snap: d, data: { id: d.id, ...(d.data() as object) } as Invoice })));
          }
        }
        // Union fetches are a superset: intersect every active criterion here.
        const criteria = {
          customerId,
          customerName,
          phoneStr,
          phoneNum,
          date: dateFilter,
          remaining: Number.isFinite(remainingFilter) ? (remainingFilter as number) : null,
          term,
          termDigits,
        };
        const sorted = [...seen.values()]
          .filter((entry) => matchesScopedInvoice(entry.data, criteria))
          .sort((a, b) => {
          const ta = toDateSafe(a.data.date)?.getTime() ?? 0;
          const tb = toDateSafe(b.data.date)?.getTime() ?? 0;
          return tb - ta;
        });
        let start = 0;
        if (cursor) {
          const idx = sorted.findIndex((entry) => entry.snap.id === cursor.id);
          start = idx >= 0 ? idx + 1 : 0;
        }
        const docs = sorted.slice(start, start + pageSize);
        return {
          items: docs.map((d) => d.data),
          cursor: docs.at(-1)?.snap ?? null,
          hasMore: sorted.length > start + pageSize,
        };
      }
      let q = query(invoicesQuery(filters), orderBy("date", "desc"));
      if (cursor) q = query(q, startAfter(cursor));
      q = query(q, fsLimit(pageSize + 1));
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.slice(0, pageSize);
      return {
        items: docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Invoice),
        cursor: docs.at(-1) ?? null,
        hasMore: snapshot.docs.length > pageSize,
      };
    } catch (error) {
      console.error("Unable to load invoice page:", error);
      return { items: [], cursor: null, hasMore: false, error: invoicePageErrorMessage(error) };
    }
  }

  function invoicePageErrorMessage(error: unknown): string {
    const code = (error as { code?: string } | null)?.code ?? "";
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (code === "failed-precondition" || /index/i.test(message)) {
      return "تعذر تحميل الفواتير: الفهرس المطلوب غير مُنشأ. نفّذ الأمر firebase deploy --only firestore:indexes ثم أعد المحاولة.";
    }
    if (code === "permission-denied") return "تعذر تحميل الفواتير: لا توجد صلاحية قراءة. سجّل الدخول بحساب المدير.";
    if (code === "unavailable") return "تعذر الاتصال بقاعدة البيانات. تحقق من الإنترنت ثم أعد المحاولة.";
    return "تعذر تحميل الفواتير. أعد المحاولة.";
  }

  async function fetchInvoicesForExport(filters: Record<string, string | number | boolean | Date | null | undefined>): Promise<Invoice[]> {
    try {
      const snapshot = await getDocs(query(invoicesQuery(filters), orderBy("date", "desc")));
      return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Invoice);
    } catch (error) {
      console.error("Unable to load invoices for explicit export:", error);
      return [];
    }
  }

  /** Legacy full-list API retained for explicit export/admin callers; normal browsing uses fetchInvoicePage. */
  const fetchInvoices = async (filters: Record<string, string | number | boolean | Date | null | undefined> = {}): Promise<boolean> => {
    list.value = await readFrom<Invoice>("invoices", filters);
    return true;
  };

  const addInvoice = async (invoice: Omit<Invoice, "id">) => {
    const saved = await saveDataTo("invoices", invoice as Record<string, unknown>);
    if (saved) invalidateCache();
    return saved;
  };

  const updateInvoice = async (id: string, updatedFields: Partial<Invoice>) => {
    const result = await updateItem("invoices", id, updatedFields as Record<string, unknown>);
    if (result !== null) invalidateCache();
    return result;
  };

  /** Atomic invoice creation (F9/F29): invoice + stock decrement +
   *  inventory logs + cashbox (paid only). Flags the doc applied. */
  async function createInvoiceWithAccounting(
    payload: Omit<Invoice, "id">,
  ): Promise<{ ok: true; id: string; cashSkipped: boolean } | { ok: false; error: string }> {
    const lines = (payload.products ?? [])
      .filter((l) => l.product_id && toNum(l.product_quantity) > 0)
      .map((line) => ({ ...line, base_quantity: round2(toNum(line.product_quantity) * lineUnitFactor(line)) }));
    if (!lines.length) return { ok: false, error: "لا يمكن حفظ فاتورة فارغة." };
    const paid = round2(toNum(payload.paid_amount));
    try {
      let invoiceId = "";
      let cashSkipped = false;
      await runTx(async (tx) => {
        // 1. Read stock + CURRENT cost + validate aggregated need per product.
        // Sale-line costs are snapshotted from these txn reads (never the
        // possibly-stale form), so later cost changes can't rewrite history.
        const ids = [...new Set(lines.map((l) => l.product_id as string))];
        const stocks = new Map<string, { stock: number; name: string; cost: number; units: { id: string; factor: number; can_sell?: boolean; is_base?: boolean }[]; baseUnitId: string | null }>();
        for (const pid of ids) {
          const snap = await tx.get(doc(db, "products", pid));
          if (!snap.exists()) throw new Error("VALIDATION:منتج غير موجود بالمخزون.");
          stocks.set(pid, {
            stock: toNum(snap.data().stock_quantity),
            name: String(snap.data().name || ""),
            cost: round4(toNum(snap.data().cost_price)),
            units: Array.isArray(snap.data().units) ? snap.data().units as { id: string; factor: number; can_sell?: boolean; is_base?: boolean }[] : [],
            baseUnitId: typeof snap.data().base_unit_id === "string" ? snap.data().base_unit_id : null,
          });
        }
        const needByProduct = new Map<string, number>();
        for (const l of lines) {
          const pid = l.product_id as string;
          const product = stocks.get(pid)!;
          const unitId = typeof l.unit_id === "string" ? l.unit_id : product.baseUnitId ?? product.units.find((unit) => unit.is_base)?.id ?? product.units[0]?.id;
          const configuredUnit = product.units.find((unit) => unit.id === unitId);
          if (product.units.length && (!configuredUnit || Math.abs(Number(configuredUnit.factor) - lineUnitFactor(l)) > STOCK_EPS)) {
            throw new Error("VALIDATION:وحدة البيع المختارة غير متاحة أو تغير إعدادها. حدّث الفاتورة وحاول مرة أخرى.");
          }
          if (!product.units.length && lineUnitFactor(l) !== 1) {
            throw new Error("VALIDATION:هذا المنتج القديم يدعم وحدة مخزون واحدة فقط.");
          }
          needByProduct.set(pid, round2((needByProduct.get(pid) ?? 0) + lineBaseQuantity(l)));
        }
        for (const [pid, need] of needByProduct) {
          const st = stocks.get(pid)!;
          if (need - st.stock > STOCK_EPS) {
            throw new Error(`VALIDATION:الكمية المطلوبة (${need}) تتجاوز المخزون المتاح (${st.stock}) لمنتج ${st.name}.`);
          }
          st.stock = round2(st.stock - need);
        }
        // 2. Cashbox state. Atomicity invariant: a paid invoice MUST have its
        // cash movement. Missing cashbox + paid > 0 rejects the whole op —
        // no invoice, no stock change, no partial effects.
        const cashRef = doc(db, "cashbox", "current");
        const cashSnap = await tx.get(cashRef);
        const cashReady = cashSnap.exists();
        const cashBal = cashReady ? round2(Number(cashSnap.data()?.balance || 0)) : 0;
        if (paid > 0 && !cashReady) {
          throw new Error("VALIDATION:لا يمكن حفظ فاتورة مدفوعة قبل تهيئة الخزنة. هيّئ الخزنة أولاً ثم أعد الحفظ.");
        }
        cashSkipped = false;
        // 3. Invoice doc (id known upfront for log references).
        // Line costs are snapshotted from the txn-read products above —
        // form costs may predate a newer purchase and must not leak in.
        const invRef = doc(collection(db, "invoices"));
        invoiceId = invRef.id;
        const now = serverTimestamp();
        const pricedLines = lines.map((l, index) => ({
          ...l,
          line_id: l.line_id || invRef.id + "-" + index,
          product_cost_price: stocks.get(l.product_id as string)!.cost,
          unit_factor: Number.isFinite(Number(l.unit_factor)) && Number(l.unit_factor) > 0 ? Number(l.unit_factor) : 1,
          base_quantity: lineBaseQuantity(l),
          base_cost_snapshot: stocks.get(l.product_id as string)!.cost,
          cost_groups: [{ base_quantity: lineBaseQuantity(l), unit_cost: stocks.get(l.product_id as string)!.cost }],
        }));
        tx.set(invRef, {
          ...(payload as Record<string, unknown>),
          products: pricedLines,
          inventory_applied: true,
          cashbox_applied: paid > 0,
          ...invoiceSearchKeys(payload.customer_name, payload.customer_phone),
        });
        // 3b. Debt summary for the lightweight debt book (same txn).
        writeDebtSummary(tx, db, {
          invoice_id: invoiceId,
          customer_id: (payload.customer_id as string) || null,
          customer_name: payload.customer_name ?? null,
          customer_phone: (payload.customer_phone as string | number | null) ?? null,
          date: (payload.date as unknown) ?? null,
          ...summarizeInvoice(payload as Invoice),
        });
        writeInvoiceStatsDelta(tx, db, null, { ...(payload as Invoice), products: pricedLines });
        const newSummary = summarizeInvoice(payload as Invoice);
        writeCustomerSummaryDelta(tx, db, payload as Invoice, {
          invoice_count: 1,
          total_sales: newSummary.sales,
          outstanding_debt: newSummary.remaining,
        });
        // 4. Stock (final balances from step 1) + per-line inventory logs.
        // Logs carry the same txn-fresh snapshot cost as the saved lines.
        let saleSeq = 0;
        const saleMovements = pricedLines.map(() => doc(collection(db, "inventory_transactions")));
        const lastSaleMovementByProduct = new Map<string, string>();
        const saleMovementIdsByProduct = new Map<string, string[]>();
        for (const [index, l] of pricedLines.entries()) {
          const pid = l.product_id as string;
          lastSaleMovementByProduct.set(pid, saleMovements[index]!.id);
          const movementIds = saleMovementIdsByProduct.get(pid) ?? [];
          movementIds.push(saleMovements[index]!.id);
          saleMovementIdsByProduct.set(pid, movementIds);
          tx.set(saleMovements[index]!, {
            type: "sale",
            product_id: pid,
            product_name: l.product_name || stocks.get(pid)!.name,
            quantity: round2(toNum(l.product_quantity)),
            unit_id: l.unit_id ?? null,
            unit_name: l.unit_name ?? null,
            unit_factor: l.unit_factor,
            base_quantity: lineBaseQuantity(l),
            direction: "out",
            unit_cost: round4(toNum(l.product_cost_price)),
            invoice_id: invoiceId,
            note: null,
            seq: saleSeq++,
            created_by: (authStore.currentUserKey as string) || null,
            created_at: now,
          });
        }
        for (const [pid, st] of stocks) {
          tx.update(doc(db, "products", pid), {
            stock_quantity: st.stock,
            last_inventory_transaction_id: lastSaleMovementByProduct.get(pid),
            last_inventory_transaction_ids: saleMovementIdsByProduct.get(pid) ?? [],
          });
        }
        // 5. Cash (paid only, never zero-value txns).
        if (paid > 0 && cashReady) {
          tx.set(cashRef, { balance: round2(cashBal + paid), updated_at: now }, { merge: true });
          tx.set(doc(collection(db, "cash_transactions")), {
            type: "invoice_sale",
            direction: "in",
            amount: paid,
            customer_id: (payload.customer_id as string) || null,
            invoice_id: invoiceId,
            reference_type: "invoice",
            reference_id: invoiceId,
            reference_label: `فاتورة بيع لـ ${payload.customer_name || "عميل"}`,
            note: null,
            created_by: (authStore.currentUserKey as string) || null,
            created_at: now,
          });
        }
      });
      useProductsStore().invalidateCache();
      invalidateCache();
      return { ok: true, id: invoiceId, cashSkipped };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  /** Atomic invoice edit (F10/F29): reads the persisted original, applies
   *  stock quantity deltas + paid-amount delta with corrective logs. */
  async function updateInvoiceWithAccounting(
    id: string,
    payload: Omit<Invoice, "id">,
  ): Promise<{ ok: true; cashSkipped: boolean } | { ok: false; error: string }> {
    const lines = (payload.products ?? [])
      .filter((l) => l.product_id && toNum(l.product_quantity) > 0)
      .map((line) => ({ ...line, base_quantity: round2(toNum(line.product_quantity) * lineUnitFactor(line)) }));
    if (!lines.length) return { ok: false, error: "لا يمكن حفظ فاتورة فارغة." };
    try {
      const preliminary = await getDoc(doc(db, "invoices", id));
      if (!preliminary.exists()) return { ok: false, error: "الفاتورة غير موجودة." };
      const preliminaryData = preliminary.data() as Record<string, unknown>;
      const [returnSnapshot, cashHistorySnapshot, debtPaymentSnapshot] = await Promise.all([
        getDocs(query(collection(db, "invoice_returns"), where("invoice_id", "==", id))),
        getDocs(query(collection(db, "cash_transactions"), where("invoice_id", "==", id))),
        preliminaryData.customer_id
          ? getDocs(query(collection(db, "debt_payments"), where("customer_id", "==", preliminaryData.customer_id)))
          : Promise.resolve(null),
      ]);
      const returnRefs = returnSnapshot.docs.map((item) => item.ref);
      const cashHistoryRefs = cashHistorySnapshot.docs.map((item) => item.ref);
      const debtPaymentRefs = debtPaymentSnapshot?.docs
        .filter((item) => Array.isArray(item.data().allocations) && (item.data().allocations as { type?: string; reference_id?: string }[])
          .some((allocation) => allocation.type === "invoice" && allocation.reference_id === id))
        .map((item) => item.ref) ?? [];
      if (returnRefs.length + cashHistoryRefs.length + debtPaymentRefs.length > 350) {
        return { ok: false, error: "يتعذر التحقق من سجل الفاتورة بأمان. يرجى مراجعة الدعم قبل تعديلها." };
      }
      let cashSkipped = false;
      await runTx(async (tx) => {
        // 1. Persisted original — never diff against stale UI state.
        const invRef = doc(db, "invoices", id);
        const invSnap = await tx.get(invRef);
        if (!invSnap.exists()) throw new Error("VALIDATION:الفاتورة غير موجودة.");
        const orig = invSnap.data() as Record<string, unknown>;
        const oldLines = (Array.isArray(orig.products) ? orig.products : []) as Invoice["products"];
        const returnRecords = await Promise.all(returnRefs.map((ref) => tx.get(ref)));
        const cashHistory = await Promise.all(cashHistoryRefs.map((ref) => tx.get(ref)));
        const debtPaymentRecords = await Promise.all(debtPaymentRefs.map((ref) => tx.get(ref)));
        const hasReturnHistory = invoiceHasReturnHistory(
          returnRecords.some((record) => record.exists()),
          orig.returned_base_quantity,
          orig.return_status,
          orig.returned as Record<string, unknown> | null | undefined,
        );
        if (hasReturnHistory) {
          throw new Error("VALIDATION:لا يمكن تعديل فاتورة تحتوي على مرتجع. استخدم عمليات المرتجع والتسوية بدلاً من تعديل الفاتورة.");
        }
        const hasDebtPaymentHistory = Number(orig.debt_payment_count) > 0
          || cashHistory.some((record) => record.exists() && (record.data().type === "invoice_payment" || !!record.data().debt_payment_id))
          || debtPaymentRecords.some((record) => record.exists())
          || (round2(toNum(orig.paid_amount)) !== round2(toNum(preliminaryData.paid_amount))
            || round2(toNum(orig.remaining)) !== round2(toNum(preliminaryData.remaining)));
        const oldInvoice = { ...orig, id } as unknown as Invoice;
        const oldCustomerSummaryId = customerSummaryId(oldInvoice);
        const newCustomerSummaryId = customerSummaryId(payload as Invoice);
        if (invoiceEditCustomerChangeError(oldCustomerSummaryId, newCustomerSummaryId, hasDebtPaymentHistory)) {
          throw new Error("VALIDATION:لا يمكن تغيير العميل بعد تسجيل دفعة على الفاتورة.");
        }
        const requestedPayable = invoiceTotals({ ...payload, paid_amount: 0 }).net;
        const rawPaid = payload.paid_amount;
        const newPaid = Number(rawPaid ?? 0);
        const paidError = invoiceEditPaymentError(payload);
        if (paidError === "paid amount must be a valid non-negative number") throw new Error("VALIDATION:المبلغ المدفوع يجب أن يكون رقماً صالحاً ويساوي صفراً أو أكثر.");
        if (paidError === "paid amount cannot exceed invoice total") throw new Error("VALIDATION:المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الفاتورة.");
        const oldPaid = orig.paid_amount === null || orig.paid_amount === undefined
          ? invoiceTotals({ ...(oldInvoice as object), paid_amount: 0 } as Invoice).net
          : round2(toNum(orig.paid_amount));
        const normalizedPaid = round2(newPaid);
        const remaining = round2(requestedPayable - normalizedPaid);
        if (remaining < -STOCK_EPS) throw new Error("VALIDATION:المتبقي على الفاتورة لا يمكن أن يكون سالباً.");
        const preliminaryChanges = invoiceEditStockChanges(oldLines, lines, new Map());
        const affectedIds = [...new Set([
          ...preliminaryChanges.takes.map((movement) => movement.product_id),
          ...preliminaryChanges.restores.map((movement) => movement.product_id),
        ])];
        const currentCostByProduct = new Map<string, number>();
        const stocks = new Map<string, { stock: number; cost: number; name: string }>();
        for (const productId of affectedIds) {
          const productSnap = await tx.get(doc(db, "products", productId));
          const name = String(lines.find((line) => line.product_id === productId)?.product_name
            ?? oldLines.find((line) => line.product_id === productId)?.product_name ?? "");
          if (!productSnap.exists()) throw new Error(`VALIDATION:المنتج ${name} غير موجود بالمخزون.`);
          const stock = toNum(productSnap.data().stock_quantity);
          const cost = round4(toNum(productSnap.data().cost_price));
          stocks.set(productId, { stock, cost, name: String(productSnap.data().name || name) });
          currentCostByProduct.set(productId, cost);
        }
        const editChanges = invoiceEditStockChanges(oldLines, lines, currentCostByProduct);
        const effectiveLines = editChanges.lines;
        const effectivePayload = {
          ...payload,
          products: effectiveLines,
          paid_amount: normalizedPaid,
          remaining,
        };
        const paidDelta = round2(normalizedPaid - oldPaid);
        const takes = editChanges.takes;
        const restores = editChanges.restores;
        const pids = [...new Set([...takes.map((movement) => movement.product_id), ...restores.map((movement) => movement.product_id)])];
        for (const d of takes) {
          const restoredQuantity = restores.filter((group) => group.product_id === d.product_id)
            .reduce((sum, group) => sum + group.qty, 0);
          if (-d.delta - ((stocks.get(d.product_id)?.stock ?? 0) + restoredQuantity) > STOCK_EPS) {
            throw new Error(`VALIDATION:الكمية المطلوبة تتجاوز المخزون المتاح لمنتج ${d.product_name}.`);
          }
        }
        // 3. Cashbox state. Any paid delta requires an initialized cashbox;
        // otherwise the whole edit is rejected (no partial effects).
        const cashRef = doc(db, "cashbox", "current");
        const cashSnap = await tx.get(cashRef);
        const cashReady = cashSnap.exists();
        const cashBal = cashReady ? round2(Number(cashSnap.data()?.balance || 0)) : 0;
        if (paidDelta !== 0 && !cashReady) {
          throw new Error("VALIDATION:لا يمكن تغيير المبلغ المدفوع قبل تهيئة الخزنة. هيّئ الخزنة أولاً ثم أعد الحفظ.");
        }
        if (paidDelta < 0 && invoiceEditCashOutflowError(cashBal, paidDelta)) {
          throw new Error("VALIDATION:رصيد الخزنة لا يكفي لتقليل المبلغ المدفوع بهذه القيمة.");
        }
        cashSkipped = false;
        const now = serverTimestamp();
        const by = (authStore.currentUserKey as string) || null;
        // 4. Invoice doc.
        tx.update(invRef, {
          ...(effectivePayload as Record<string, unknown>),
          products: effectiveLines,
          inventory_applied: true,
          cashbox_applied: true,
          ...invoiceSearchKeys(effectivePayload.customer_name, effectivePayload.customer_phone),
        });
        writeDebtSummary(tx, db, {
          invoice_id: id,
          customer_id: (effectivePayload.customer_id as string) || null,
          customer_name: effectivePayload.customer_name ?? null,
          customer_phone: (effectivePayload.customer_phone as string | number | null) ?? null,
          date: (effectivePayload.date as unknown) ?? null,
          ...summarizeInvoice(effectivePayload as Invoice),
        });
        const oldSummary = summarizeInvoice(orig as unknown as Invoice);
        const newSummary = summarizeInvoice(effectivePayload as Invoice);
        writeInvoiceStatsDelta(tx, db, oldInvoice, effectivePayload as Invoice);
        if (oldCustomerSummaryId === newCustomerSummaryId) {
          writeCustomerSummaryDelta(tx, db, effectivePayload as Invoice, {
            total_sales: round2(newSummary.sales - oldSummary.sales),
            outstanding_debt: round2(newSummary.remaining - oldSummary.remaining),
          });
        } else {
          writeCustomerSummaryDelta(tx, db, orig as unknown as Invoice, {
            invoice_count: -1,
            total_sales: -oldSummary.sales,
            outstanding_debt: -oldSummary.remaining,
          });
          writeCustomerSummaryDelta(tx, db, effectivePayload as Invoice, {
            invoice_count: 1,
            total_sales: newSummary.sales,
            outstanding_debt: newSummary.remaining,
          });
        }
        // 5. Stock + logs. Takes leave cost untouched; each restore group
        // re-enters at its own historical cost with its own log. Product
        // updates go through the canonical applyStockGroup (mirrors replay).
        let seq = 0;
        const lastMovementByProduct = new Map<string, string>();
        const movementIdsByProduct = new Map<string, string[]>();
        for (const g of restores) {
          const movementRef = doc(collection(db, "inventory_transactions"));
          lastMovementByProduct.set(g.product_id, movementRef.id);
          const movementIds = movementIdsByProduct.get(g.product_id) ?? [];
          movementIds.push(movementRef.id);
          movementIdsByProduct.set(g.product_id, movementIds);
          tx.set(movementRef, {
            type: "sale",
            product_id: g.product_id,
            product_name: g.product_name,
            quantity: g.qty,
            unit_name: "وحدة مخزون أساسية",
            unit_factor: 1,
            base_quantity: g.qty,
            direction: "in",
            unit_cost: g.unit_cost,
            invoice_id: id,
            reason: "invoice_edit",
            note: "تعديل فاتورة",
            seq: seq++,
            created_by: by,
            created_at: now,
          });
        }
        for (const d of takes) {
          const movementRef = doc(collection(db, "inventory_transactions"));
          if (!lastMovementByProduct.has(d.product_id)) {
            lastMovementByProduct.set(d.product_id, movementRef.id);
          }
          const movementIds = movementIdsByProduct.get(d.product_id) ?? [];
          movementIds.push(movementRef.id);
          movementIdsByProduct.set(d.product_id, movementIds);
          tx.set(movementRef, {
            type: "sale",
            product_id: d.product_id,
            product_name: d.product_name,
            quantity: Math.abs(d.delta),
            unit_name: "وحدة مخزون أساسية",
            unit_factor: 1,
            base_quantity: Math.abs(d.delta),
            direction: "out",
            unit_cost: round2(d.unit_cost),
            invoice_id: id,
            reason: "invoice_edit",
            note: "تعديل فاتورة",
            seq: seq++,
            created_by: by,
            created_at: now,
          });
        }
        for (const pid of pids) {
          const st = stocks.get(pid)!;
          const takeQty = round2(-(takes.find((d) => d.product_id === pid)?.delta ?? 0));
          const inflows = restores
            .filter((g) => g.product_id === pid)
            .map((g) => ({ qty: g.qty, cost: g.unit_cost as number | null }));
          const r = applyStockGroup(st.stock, st.cost, takeQty, inflows);
          const patch: Record<string, unknown> = {
            stock_quantity: r.stock,
            last_inventory_transaction_id: lastMovementByProduct.get(pid),
            last_inventory_transaction_ids: movementIdsByProduct.get(pid) ?? [],
          };
          if (inflows.length > 0 && r.avg !== undefined) {
            patch.cost_price = r.avg;
          }
          tx.update(doc(db, "products", pid), patch);
        }
        // 6. Cash delta (corrective dir + matching log).
        if (paidDelta !== 0 && cashReady) {
          const dir = paidDelta > 0 ? "in" : "out";
          tx.set(cashRef, { balance: round2(cashBal + paidDelta), updated_at: now }, { merge: true });
          tx.set(doc(collection(db, "cash_transactions")), {
            type: "invoice_edit_adjustment",
            direction: dir,
            amount: Math.abs(paidDelta),
            invoice_id: id,
            reference_type: "invoice",
            reference_id: id,
            reference_label: `فاتورة بيع لـ ${effectivePayload.customer_name || "عميل"}`,
            note: "فرق تعديل فاتورة",
            created_by: by,
            created_at: now,
          });
        }
      });
      useProductsStore().invalidateCache();
      invalidateCache();
      return { ok: true, cashSkipped };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  const deleteInvoice = async (id: string): Promise<{ ok: boolean; blocked?: boolean }> => {
    // F26: never silently erase financial history — block when the invoice
    // has applied effects or linked audit records.
    try {
      const snap = await getDoc(doc(db, "invoices", id));
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
      const hasEffects = data.inventory_applied === true || data.cashbox_applied === true;
      let linked = false;
      if (!hasEffects) {
        const [ret, cash] = await Promise.all([
          getDocs(query(collection(db, "invoice_returns"), where("invoice_id", "==", id), fsLimit(1))),
          getDocs(query(collection(db, "cash_transactions"), where("invoice_id", "==", id), fsLimit(1))),
        ]);
        linked = !ret.empty || !cash.empty;
      }
      if (hasEffects || linked) {
        notify("لا يمكن حذف فاتورة لها حركات مخزنية أو نقدية — استخدم المرتجع بدلاً من الحذف.", "error");
        return { ok: false, blocked: true };
      }
    } catch (e) {
      console.error(e);
      return { ok: false };
    }
    try {
      await runTx(async (tx) => {
        const invoiceRef = doc(db, "invoices", id);
        const [invoiceSnap, statsSnap] = await Promise.all([
          tx.get(invoiceRef),
          tx.get(doc(db, "store_stats", "current")),
        ]);
        if (!invoiceSnap.exists()) return;
        const invoice = { id: invoiceSnap.id, ...(invoiceSnap.data() as object) } as Invoice;
        const data = invoiceSnap.data();
        if (data.inventory_applied === true || data.cashbox_applied === true) {
          throw new Error("VALIDATION:لا يمكن حذف فاتورة لها حركات مخزنية أو نقدية — استخدم المرتجع بدلاً من الحذف.");
        }
        tx.delete(invoiceRef);
        tx.delete(doc(db, "invoice_debt_summaries", id));
        if (statsSnap.exists() && statsSnap.data().initialized === true) {
          writeInvoiceStatsDelta(tx, db, invoice, null);
        }
      });
      list.value = list.value.filter((inv) => inv.id !== id);
      invalidateCache();
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        notify(e.message.slice("VALIDATION:".length), "error");
        return { ok: false, blocked: true };
      }
      console.error(e);
      return { ok: false };
    }
  };

  const exportInvoicesToExcel = async (invoices: Invoice[] = []): Promise<string> => {
    try {
      if (!invoices.length) return "⚠️ لا توجد فواتير للتصدير.";
      // Lazy-load xlsx (~851KB) only when the user actually exports,
      // so it never blocks initial page load.
      const XLSX = await import("xlsx/dist/xlsx.full.min.js");

      const formatted = invoices.map((inv) => {
        const products = Array.isArray(inv.products) ? inv.products : [];
        const netTotal = products.reduce(
          (sum, p) => sum + (Number(p.product_price) || 0) * (Number(p.product_quantity) || 0),
          0
        );
        const totalCost = products.reduce(
          (sum, p) => sum + (Number(p.product_cost_price) || 0) * (Number(p.base_quantity ?? p.product_quantity) || 0),
          0
        );
        const discountValue = inv.discount_percentage
          ? (netTotal * (Number(inv.discount) || 0)) / 100
          : Number(inv.discount) || 0;
        const totalAfterDiscount = netTotal - discountValue + (Number(inv.delivery_price) || 0);
        const profit = merchandiseProfitOf(inv);
        const productsList = products
          .map((p, i) => {
            const name = formatInvoiceLineName(p.product_name || "غير محدد", p.unit_name, p.option);
            const qty = Number(p.product_quantity) || 0;
            const baseQty = Number(p.base_quantity ?? qty) || 0;
            const price = Number(p.product_price) || 0;
            const cost = Number(p.product_cost_price) || 0;
            return `(${i + 1}) ${name} - الكمية: ${qty} ${p.unit_name || ""} - السعر: ${price} - تكلفة الوحدة الأساسية: ${cost} - إجمالي التكلفة: ${baseQty * cost} - الإجمالي: ${qty * price}`;
          })
          .join("\n");

        return {
          "رقم الفاتورة": inv.id || "",
          "اسم العميل": inv.customer_name || "",
          "رقم الهاتف": inv.customer_phone || "",
          "منشئ الفاتورة": formateActiveUserKey((inv.created_by as string) ?? null)?.name || "",
          التاريخ: toDateSafe(inv.date)?.toLocaleString() ?? "",
          "حساب محروس": inv.amount_of_mahros || 0,
          "حساب العلف": inv.amount_of_animal_feeds || 0,
          القديم: inv.debt || 0,
          "سعر التوصيل": inv.delivery_price || 0,
          الخصم: `${inv.discount || 0}${inv.discount_percentage ? "%" : ""}`,
          "نوع الخصم": inv.discount_percentage ? "نسبة مئوية" : "مبلغ ثابت",
          "صافي الفاتورة": netTotal || 0,
          "إجمالي التكلفة": totalCost || 0,
          "إجمالي الفاتورة":
            totalAfterDiscount + Number(inv.debt || 0) + Number(inv.amount_of_mahros || 0) + Number(inv.amount_of_animal_feeds || 0),
          الربح: profit || 0,
          المنتجات: productsList,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(formatted);
      const workbook = XLSX.utils.book_new();
      const rowCount = formatted.length + 1;
      const sumColumns = ["صافي الفاتورة", "إجمالي الفاتورة", "إجمالي التكلفة", "الربح"];
      const headerKeys = Object.keys(formatted[0] ?? {});
      const headerMap: Record<string, string> = {};
      headerKeys.forEach((key, i) => {
        headerMap[key] = XLSX.utils.encode_col(i);
      });
      const totalRowIndex = rowCount + 1;
      worksheet[`A${totalRowIndex}`] = { t: "s", v: "الإجمالي الكلي (دوال Excel)" };
      for (const colName of sumColumns) {
        const colLetter = headerMap[colName];
        if (colLetter) worksheet[`${colLetter}${totalRowIndex}`] = { f: `SUM(${colLetter}2:${colLetter}${rowCount})` };
      }
      const range = XLSX.utils.decode_range(worksheet["!ref"] as string);
      range.e.r = totalRowIndex - 1;
      worksheet["!ref"] = XLSX.utils.encode_range(range);
      XLSX.utils.book_append_sheet(workbook, worksheet, "الفواتير");

      const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
      const blob = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `الفواتير_${new Date().toLocaleDateString("ar-EG")}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      return `✅ تم تصدير ${invoices.length} فاتورة بنجاح مع دوال الجمع التلقائية.`;
    } catch (err) {
      console.error("خطأ أثناء التصدير:", err);
      return "❌ حدث خطأ أثناء تصدير الفواتير.";
    }
  };

  // FLAG [S6]: destructive bulk delete — requires explicit double-confirm by caller
  // and should be moved to a server function with admin Custom Claim. Never call
  // from console/untrusted context.
  const deleteOldInvoices = async (confirmed = false): Promise<number> => {
    if (!confirmed) throw new Error("Refusing bulk delete without explicit confirmation (pass confirmed=true after re-auth).");
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const allInvoices = await readFrom<Invoice>("invoices");
    let deletedCount = 0;
    for (const inv of allInvoices) {
      const invDate = toDateSafe(inv.date);
      if (invDate && invDate < firstDayOfMonth && inv.id) {
        const res = await deleteInvoice(inv.id);
        if (res.ok) deletedCount++;
      }
    }
    return deletedCount;
  };

  return {
    list,
    invoiceToEdit,
    fetchInvoices,
    fetchInvoicePage,
    fetchInvoicesForExport,
    invalidateCache,
    addInvoice,
    updateInvoice,
    createInvoiceWithAccounting,
    updateInvoiceWithAccounting,
    deleteInvoice,
    deleteOldInvoices,
    exportInvoicesToExcel,
  };
});
