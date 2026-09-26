import * as XLSX from "xlsx/dist/xlsx.full.min.js";
import { collection, doc, getDocs, limit as fsLimit, query, where } from "firebase/firestore";
import type { Invoice } from "~/types";
import { toDateSafe } from "~/types";
import { round2, movingAverageCost, stockDeltaForEdit, toNum } from "~/composables/finance";
import { summarizeInvoice, writeDebtSummary } from "~/composables/debtSummaries";

const STOCK_EPS = 1e-9;

export const useInvoicesStore = defineStore("invoices", () => {
  const { readFrom, saveDataTo, updateItem, deleteItem, db, serverTimestamp, getDoc } = useFirebase();
  const authStore = useAuth();
  const { notify } = useAppToast();
  const list = ref<Invoice[]>([]);
  const invoiceToEdit = ref<Invoice | undefined>(undefined);

  const fetchInvoices = async (filters: Record<string, string | number | boolean | Date | null | undefined> = {}): Promise<boolean> => {
    list.value = await readFrom<Invoice>("invoices", filters);
    return true;
  };

  const addInvoice = async (invoice: Omit<Invoice, "id">) => {
    return await saveDataTo("invoices", invoice as Record<string, unknown>);
  };

  const updateInvoice = async (id: string, updatedFields: Partial<Invoice>) => {
    return await updateItem("invoices", id, updatedFields as Record<string, unknown>);
  };

  /** Atomic invoice creation (F9/F29): invoice + stock decrement +
   *  inventory logs + cashbox (paid only). Flags the doc applied. */
  async function createInvoiceWithAccounting(
    payload: Omit<Invoice, "id">,
  ): Promise<{ ok: true; id: string; cashSkipped: boolean } | { ok: false; error: string }> {
    const lines = (payload.products ?? []).filter((l) => l.product_id);
    if (!lines.length) return { ok: false, error: "لا يمكن حفظ فاتورة فارغة." };
    const paid = round2(toNum(payload.paid_amount));
    try {
      let invoiceId = "";
      let cashSkipped = false;
      await runTx(async (tx) => {
        // 1. Read stock + validate aggregated need per product.
        const ids = [...new Set(lines.map((l) => l.product_id as string))];
        const stocks = new Map<string, { stock: number; name: string }>();
        for (const pid of ids) {
          const snap = await tx.get(doc(db, "products", pid));
          if (!snap.exists()) throw new Error("VALIDATION:منتج غير موجود بالمخزون.");
          stocks.set(pid, { stock: toNum(snap.data().stock_quantity), name: String(snap.data().name || "") });
        }
        const needByProduct = new Map<string, number>();
        for (const l of lines) {
          const pid = l.product_id as string;
          needByProduct.set(pid, round2((needByProduct.get(pid) ?? 0) + toNum(l.product_quantity)));
        }
        for (const [pid, need] of needByProduct) {
          const st = stocks.get(pid)!;
          if (need - st.stock > STOCK_EPS) {
            throw new Error(`VALIDATION:الكمية المطلوبة (${need}) تتجاوز المخزون المتاح (${st.stock}) لمنتج ${st.name}.`);
          }
          st.stock = round2(st.stock - need);
        }
        // 2. Cashbox state (missing doc = not onboarded → skip cash, flag it).
        const cashRef = doc(db, "cashbox", "current");
        const cashSnap = await tx.get(cashRef);
        const cashReady = cashSnap.exists();
        const cashBal = cashReady ? round2(Number(cashSnap.data()?.balance || 0)) : 0;
        cashSkipped = paid > 0 && !cashReady;
        // 3. Invoice doc (id known upfront for log references).
        const invRef = doc(collection(db, "invoices"));
        invoiceId = invRef.id;
        const now = serverTimestamp();
        tx.set(invRef, {
          ...(payload as Record<string, unknown>),
          products: lines,
          inventory_applied: true,
          cashbox_applied: !(paid > 0 && !cashReady),
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
        // 4. Stock (final balances from step 1) + per-line inventory logs.
        for (const l of lines) {
          const pid = l.product_id as string;
          const st = stocks.get(pid)!;
          tx.update(doc(db, "products", pid), { stock_quantity: st.stock });
          tx.set(doc(collection(db, "inventory_transactions")), {
            type: "sale",
            product_id: pid,
            product_name: l.product_name || st.name,
            quantity: round2(toNum(l.product_quantity)),
            direction: "out",
            unit_cost: round2(toNum(l.product_cost_price)),
            invoice_id: invoiceId,
            note: null,
            created_by: (authStore.currentUserKey as string) || null,
            created_at: now,
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
            note: null,
            created_by: (authStore.currentUserKey as string) || null,
            created_at: now,
          });
        }
      });
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
    const lines = (payload.products ?? []).filter((l) => l.product_id);
    if (!lines.length) return { ok: false, error: "لا يمكن حفظ فاتورة فارغة." };
    try {
      let cashSkipped = false;
      await runTx(async (tx) => {
        // 1. Persisted original — never diff against stale UI state.
        const invRef = doc(db, "invoices", id);
        const invSnap = await tx.get(invRef);
        if (!invSnap.exists()) throw new Error("VALIDATION:الفاتورة غير موجودة.");
        const orig = invSnap.data() as Record<string, unknown>;
        const oldLines = (Array.isArray(orig.products) ? orig.products : []) as Invoice["products"];
        const oldPaid = round2(toNum(orig.paid_amount));
        const newPaid = round2(toNum(payload.paid_amount));
        const paidDelta = round2(newPaid - oldPaid);
        // 2. Stock deltas (positive = back to stock).
        const deltas = stockDeltaForEdit(oldLines, lines);
        const stocks = new Map<string, { stock: number; cost: number }>();
        for (const d of deltas) {
          const pRef = doc(db, "products", d.product_id);
          const pSnap = await tx.get(pRef);
          if (!pSnap.exists()) throw new Error(`VALIDATION:المنتج ${d.product_name} غير موجود بالمخزون.`);
          stocks.set(d.product_id, {
            stock: toNum(pSnap.data().stock_quantity),
            cost: toNum(pSnap.data().cost_price),
          });
        }
        for (const d of deltas) {
          if (-d.delta - (stocks.get(d.product_id)?.stock ?? 0) > STOCK_EPS) {
            throw new Error(`VALIDATION:الكمية المطلوبة تتجاوز المخزون المتاح لمنتج ${d.product_name}.`);
          }
        }
        // 3. Cashbox state.
        const cashRef = doc(db, "cashbox", "current");
        const cashSnap = await tx.get(cashRef);
        const cashReady = cashSnap.exists();
        const cashBal = cashReady ? round2(Number(cashSnap.data()?.balance || 0)) : 0;
        cashSkipped = paidDelta !== 0 && !cashReady;
        const now = serverTimestamp();
        const by = (authStore.currentUserKey as string) || null;
        // 4. Invoice doc.
        tx.update(invRef, {
          ...(payload as Record<string, unknown>),
          products: lines,
          inventory_applied: true,
          cashbox_applied: !(paidDelta !== 0 && !cashReady),
        });
        writeDebtSummary(tx, db, {
          invoice_id: id,
          customer_id: (payload.customer_id as string) || null,
          customer_name: payload.customer_name ?? null,
          customer_phone: (payload.customer_phone as string | number | null) ?? null,
          date: (payload.date as unknown) ?? null,
          ...summarizeInvoice(payload as Invoice),
        });
        // 5. Stock + logs. Restored units re-enter at their historical cost
        // via the moving average; taken units leave cost untouched.
        for (const d of deltas) {
          const st = stocks.get(d.product_id)!;
          const patch: Record<string, unknown> = {
            stock_quantity: round2(st.stock + d.delta),
          };
          if (d.delta > 0) {
            patch.cost_price = round2(
              movingAverageCost(st.stock, st.cost, d.delta, d.unit_cost),
            );
          }
          tx.update(doc(db, "products", d.product_id), patch);
          tx.set(doc(collection(db, "inventory_transactions")), {
            type: "sale",
            product_id: d.product_id,
            product_name: d.product_name,
            quantity: Math.abs(d.delta),
            direction: d.delta > 0 ? "in" : "out",
            unit_cost: round2(d.unit_cost),
            invoice_id: id,
            note: "تعديل فاتورة",
            created_by: by,
            created_at: now,
          });
        }
        // 6. Cash delta (corrective dir + matching log).
        if (paidDelta !== 0 && cashReady) {
          const dir = paidDelta > 0 ? "in" : "out";
          tx.set(cashRef, { balance: round2(cashBal + paidDelta), updated_at: now }, { merge: true });
          tx.set(doc(collection(db, "cash_transactions")), {
            type: paidDelta > 0 ? "invoice_sale" : "invoice_refund",
            direction: dir,
            amount: Math.abs(paidDelta),
            invoice_id: id,
            note: "فرق تعديل فاتورة",
            created_by: by,
            created_at: now,
          });
        }
      });
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
    const ok = await deleteItem("invoices", id);
    if (ok) list.value = list.value.filter((inv) => inv.id !== id);
    return { ok };
  };

  const exportInvoicesToExcel = async (invoices: Invoice[] = []): Promise<string> => {
    try {
      if (!invoices.length) return "⚠️ لا توجد فواتير للتصدير.";

      const formatted = invoices.map((inv) => {
        const products = Array.isArray(inv.products) ? inv.products : [];
        const netTotal = products.reduce(
          (sum, p) => sum + (Number(p.product_price) || 0) * (Number(p.product_quantity) || 0),
          0
        );
        const totalCost = products.reduce(
          (sum, p) => sum + (Number(p.product_cost_price) || 0) * (Number(p.product_quantity) || 0),
          0
        );
        const discountValue = inv.discount_percentage
          ? (netTotal * (Number(inv.discount) || 0)) / 100
          : Number(inv.discount) || 0;
        const totalAfterDiscount = netTotal - discountValue + (Number(inv.delivery_price) || 0);
        const profit = netTotal - totalCost;
        const productsList = products
          .map((p, i) => {
            const name = p.product_name || "غير محدد";
            const qty = Number(p.product_quantity) || 0;
            const price = Number(p.product_price) || 0;
            const cost = Number(p.product_cost_price) || 0;
            return `(${i + 1}) ${name} - الكمية: ${qty} - السعر: ${price} - التكلفة: ${cost} - إجمالي التكلفة: ${qty * cost} - الإجمالي: ${qty * price}`;
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
    addInvoice,
    updateInvoice,
    createInvoiceWithAccounting,
    updateInvoiceWithAccounting,
    deleteInvoice,
    deleteOldInvoices,
    exportInvoicesToExcel,
  };
});
