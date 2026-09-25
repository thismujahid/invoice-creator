import * as XLSX from "xlsx/dist/xlsx.full.min.js";
import type { Invoice } from "~/types";
import { toDateSafe } from "~/types";

export const useInvoicesStore = defineStore("invoices", () => {
  const { readFrom, saveDataTo, updateItem, deleteItem } = useFirebase();
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

  const deleteInvoice = async (id: string): Promise<boolean> => {
    const ok = await deleteItem("invoices", id);
    if (ok) list.value = list.value.filter((inv) => inv.id !== id);
    return ok;
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
        const ok = await deleteInvoice(inv.id);
        if (ok) deletedCount++;
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
    deleteInvoice,
    deleteOldInvoices,
    exportInvoicesToExcel,
  };
});
