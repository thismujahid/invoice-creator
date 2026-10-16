import { defineStore } from "pinia";
import { and, collection, getDocs, limit as fsLimit, orderBy, or, query, startAfter, Timestamp, where, type Query, type QueryDocumentSnapshot } from "firebase/firestore";
import type { Invoice } from "~/types";
import type { InvoiceReturn } from "~/types/finance";
import { toDateSafe } from "~/types";
import { merchandiseProfitOf, round2, toNum } from "~/composables/finance";
import { invoiceExportFigures, invoiceLinesSubtotal } from "~/utils/invoiceExport";
import { formatInvoiceLineName } from "~/composables/helpers";

const INVOICE_PAGE_SIZE = 25;

export const useInvoicesStore = defineStore("invoices", () => {
  const { readFrom, db } = useFirebase();
  const { notify } = useAppToast();
  const list = ref<Invoice[]>([]);
  const invoiceToEdit = ref<Invoice | undefined>(undefined);
  let pendingEdit: { fingerprint: string; requestId: string } | null = null;
  let pendingCreate: { fingerprint: string; requestId: string } | null = null;
  let pendingCancel: { id: string; requestId: string } | null = null;

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
      throw error;
    }
  }

  /** Legacy full-list API retained for explicit export/admin callers; normal browsing uses fetchInvoicePage. */
  const fetchInvoices = async (filters: Record<string, string | number | boolean | Date | null | undefined> = {}): Promise<boolean> => {
    list.value = await readFrom<Invoice>("invoices", filters);
    return true;
  };

  /** Atomic invoice creation (F9/F29): invoice + stock decrement +
   *  inventory logs + cashbox (paid only). Flags the doc applied. */
  async function createInvoiceWithAccounting(
    payload: Omit<Invoice, "id">,
  ): Promise<{ ok: true; id: string; cashSkipped: boolean } | { ok: false; error: string }> {
    try {
      const fingerprint = JSON.stringify(payload);
      if (pendingCreate?.fingerprint !== fingerprint) pendingCreate = { fingerprint, requestId: crypto.randomUUID() };
      const result = await callStaff<Omit<Invoice, "id"> & { requestId: string }, { id: string }>("createStaffSale", {
        ...payload,
        paid_amount: round2(toNum(payload.paid_amount) - toNum(payload.credit_used)),
        requestId: pendingCreate.requestId,
      });
      pendingCreate = null;
      useProductsStore().invalidateCache();
      invalidateCache();
      return { ok: true, id: result.id, cashSkipped: false };
    } catch (error) {
      console.error(error);
      return { ok: false, error: "تعذر حفظ الفاتورة. تحقق من العميل والمخزون والأسعار ثم حاول مرة أخرى." };
    }
  }

  /** Atomic invoice edit (F10/F29): reads the persisted original, applies
   *  stock quantity deltas + paid-amount delta with corrective logs. */
  async function updateInvoiceWithAccounting(
    id: string,
    payload: Omit<Invoice, "id">,
  ): Promise<{ ok: true; cashSkipped: boolean } | { ok: false; error: string }> {
    if (!payload.edit_revision) return { ok: false, error: "أعد فتح الفاتورة قبل تعديلها." };
    try {
      const fingerprint = JSON.stringify({ id, payload });
      if (pendingEdit?.fingerprint !== fingerprint) pendingEdit = { fingerprint, requestId: crypto.randomUUID() };
      await callStaff("updateStaffInvoice", { ...payload, id, requestId: pendingEdit.requestId });
      pendingEdit = null;
      useProductsStore().invalidateCache();
      invalidateCache();
      return { ok: true, cashSkipped: false };
    } catch (error) {
      console.error(error);
      return { ok: false, error: "تعذر تعديل الفاتورة. قد تكون الفاتورة أو المخزون تغيرا؛ أعد فتحها وحاول مرة أخرى." };
    }
  }

  const deleteInvoice = async (id: string): Promise<{ ok: boolean; blocked?: boolean }> => {
    try {
      if (pendingCancel?.id !== id) pendingCancel = { id, requestId: crypto.randomUUID() };
      await callStaff("deleteStaffInvoice", { id, requestId: pendingCancel.requestId });
      pendingCancel = null;
      const cancelledAt = new Date();
      list.value = list.value.map((invoice) => invoice.id === id
        ? { ...invoice, status: "cancelled", remaining: 0, cancelled_at: cancelledAt } as Invoice
        : invoice);
      invalidateCache();
      notify("تم إلغاء الفاتورة وعكس أثرها.", "success");
      return { ok: true };
    } catch (e) {
      console.error(e);
      notify("تعذر إلغاء الفاتورة. قد تحتوي على مرتجع أو تسوية دين أو تغير رصيد المخزون؛ راجعها ثم أعد المحاولة.", "error");
      return { ok: false, blocked: true };
    }
  };

  const exportInvoicesToExcel = async (invoices: Invoice[] = [], returns: InvoiceReturn[] = []): Promise<string> => {
    try {
      if (!invoices.length) return "⚠️ لا توجد فواتير للتصدير.";
      // Lazy-load xlsx (~851KB) only when the user actually exports,
      // so it never blocks initial page load.
      const XLSX = await import("xlsx/dist/xlsx.full.min.js");
      const returnsByInvoice = new Map<string, number>();
      for (const record of returns) returnsByInvoice.set(record.invoice_id, round2((returnsByInvoice.get(record.invoice_id) ?? 0) + Number(record.total_refund || 0)));

      const formatted = invoices.map((inv) => {
        const products = Array.isArray(inv.products) ? inv.products : [];
        const cancelled = inv.status === "cancelled";
        const returnTotal = cancelled ? 0 : returnsByInvoice.get(inv.id || "") ?? 0;
        // Canonical figures (same policy as save/preview/print: discount base
        // includes delivery/feeds/mahros/debt; cost prefers cost_groups).
        const figures = invoiceExportFigures(inv);
        const netTotal = cancelled ? 0 : invoiceLinesSubtotal(inv);
        const totalCost = cancelled ? 0 : figures.totalCost;
        const discountValue = cancelled ? 0 : figures.discountValue;
        const invoiceTotal = cancelled ? 0 : figures.invoiceTotal;
        const profit = cancelled ? 0 : figures.profit;
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
          "حالة الفاتورة": cancelled ? "ملغاة — للتدقيق" : "فعالة",
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
          "إجمالي الفاتورة": invoiceTotal,
          "حالة المرتجع": inv.return_status === "full" ? "كلي" : inv.return_status === "partial" ? "جزئي" : "لا يوجد",
          "إجمالي المرتجعات": returnTotal,
          "الصافي بعد المرتجعات": round2(invoiceTotal - returnTotal),
          الربح: profit || 0,
          المنتجات: productsList,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(formatted);
      const workbook = XLSX.utils.book_new();
      const rowCount = formatted.length + 1;
      const sumColumns = ["صافي الفاتورة", "إجمالي الفاتورة", "إجمالي المرتجعات", "الصافي بعد المرتجعات", "إجمالي التكلفة", "الربح"];
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
      if (returns.length) {
        const returnRows = returns.flatMap((record) => (record.items ?? []).map((item, index) => ({
          "رقم الفاتورة": record.invoice_id,
          "رقم المرتجع": record.id || "",
          التاريخ: toDateSafe(record.created_at)?.toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }) ?? "",
          المنتج: item.product_name,
          الكمية: item.quantity,
          الوحدة: item.unit_name || "وحدة",
          "قيمة الصنف": item.refund_amount,
          "إجمالي المرتجع": index === 0 ? record.total_refund : "",
          "تخفيض الدين": index === 0 ? record.debt_reduction ?? 0 : "",
          "المردود نقدًا": index === 0 ? record.cash_refund ?? 0 : "",
          "رصيد محفوظ للعميل": index === 0 ? round2(toNum(record.credit_issued) + toNum(record.credit_restored)) : "",
          ملاحظة: record.note || "",
        })));
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(returnRows), "المرتجعات");
      }

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

  return {
    list,
    invoiceToEdit,
    fetchInvoices,
    fetchInvoicePage,
    fetchInvoicesForExport,
    invalidateCache,
    createInvoiceWithAccounting,
    updateInvoiceWithAccounting,
    deleteInvoice,
    exportInvoicesToExcel,
  };
});
