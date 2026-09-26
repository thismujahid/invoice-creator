import * as XLSX from "xlsx/dist/xlsx.full.min.js";
import { collection, doc, getDocs, limit as fsLimit, query, where } from "firebase/firestore";
import type { Invoice } from "~/types";
import { toDateSafe } from "~/types";
import { applyStockGroup, restoreGroupsForEdit, round2, stockDeltaForEdit, toNum } from "~/composables/finance";
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
    const lines = (payload.products ?? []).filter((l) => l.product_id && toNum(l.product_quantity) > 0);
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
        const stocks = new Map<string, { stock: number; name: string; cost: number }>();
        for (const pid of ids) {
          const snap = await tx.get(doc(db, "products", pid));
          if (!snap.exists()) throw new Error("VALIDATION:منتج غير موجود بالمخزون.");
          stocks.set(pid, {
            stock: toNum(snap.data().stock_quantity),
            name: String(snap.data().name || ""),
            cost: round2(toNum(snap.data().cost_price)),
          });
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
        // Line costs are snapshotted from the txn-read products above —
        // form costs may predate a newer purchase and must not leak in.
        const invRef = doc(collection(db, "invoices"));
        invoiceId = invRef.id;
        const now = serverTimestamp();
        const pricedLines = lines.map((l) => ({
          ...l,
          product_cost_price: stocks.get(l.product_id as string)!.cost,
        }));
        tx.set(invRef, {
          ...(payload as Record<string, unknown>),
          products: pricedLines,
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
            direction: "out",
            unit_cost: round2(toNum(l.product_cost_price)),
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
    const lines = (payload.products ?? []).filter((l) => l.product_id && toNum(l.product_quantity) > 0);
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
        const oldLinesByProduct = new Map<string, typeof oldLines>();
        for (const line of oldLines) {
          if (!line.product_id) continue;
          const productLines = oldLinesByProduct.get(line.product_id) ?? [];
          productLines.push(line);
          oldLinesByProduct.set(line.product_id, productLines);
        }
        const lineOccurrences = new Map<string, number>();
        const effectiveLines = lines.map((line) => {
          const pid = line.product_id as string;
          const occurrence = lineOccurrences.get(pid) ?? 0;
          lineOccurrences.set(pid, occurrence + 1);
          const historicalLine = oldLinesByProduct.get(pid)?.[occurrence];
          return historicalLine
            ? { ...line, product_cost_price: round2(toNum(historicalLine.product_cost_price)) }
            : line;
        });
        const effectivePayload = { ...payload, products: effectiveLines };
        const oldPaid = round2(toNum(orig.paid_amount));
        const newPaid = round2(toNum(payload.paid_amount));
        const paidDelta = round2(newPaid - oldPaid);
        // 2. Takes aggregated per product; restores grouped per
        // (product, historical cost) — never collapsed to one cost.
        const deltas = stockDeltaForEdit(oldLines, effectiveLines);
        const takes = deltas.filter((d) => d.delta < 0);
        const restores = restoreGroupsForEdit(oldLines, effectiveLines);
        const pids = [...new Set([...takes.map((d) => d.product_id), ...restores.map((g) => g.product_id)])];
        const stocks = new Map<string, { stock: number; cost: number }>();
        for (const pid of pids) {
          const pRef = doc(db, "products", pid);
          const pSnap = await tx.get(pRef);
          const pname = takes.find((d) => d.product_id === pid)?.product_name
            ?? restores.find((g) => g.product_id === pid)?.product_name
            ?? "";
          if (!pSnap.exists()) throw new Error(`VALIDATION:المنتج ${pname} غير موجود بالمخزون.`);
          stocks.set(pid, {
            stock: toNum(pSnap.data().stock_quantity),
            cost: toNum(pSnap.data().cost_price),
          });
        }
        for (const d of takes) {
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
          ...(effectivePayload as Record<string, unknown>),
          products: effectiveLines,
          inventory_applied: true,
          cashbox_applied: !(paidDelta !== 0 && !cashReady),
        });
        writeDebtSummary(tx, db, {
          invoice_id: id,
          customer_id: (effectivePayload.customer_id as string) || null,
          customer_name: effectivePayload.customer_name ?? null,
          customer_phone: (effectivePayload.customer_phone as string | number | null) ?? null,
          date: (effectivePayload.date as unknown) ?? null,
          ...summarizeInvoice(effectivePayload as Invoice),
        });
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
            direction: "in",
            unit_cost: g.unit_cost,
            invoice_id: id,
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
            direction: "out",
            unit_cost: round2(d.unit_cost),
            invoice_id: id,
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
