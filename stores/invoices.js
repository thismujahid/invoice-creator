import * as XLSX from "xlsx";

export const useInvoicesStore = defineStore("invoices", () => {
  const { readFrom, saveDataTo, updateItem, deleteItem } = useFirebase();
  const list = ref([]);
  const invoiceToEdit = ref();

  const fetchInvoices = async (filters) => {
    list.value = await readFrom("invoices", filters);
    return true;
  };

  const addInvoice = async (invoice) => {
    return await saveDataTo("invoices", invoice);
  };

  const updateInvoice = async (id, updatedFields) => {
    return await updateItem("invoices", id, updatedFields);
  };

  const deleteInvoice = async (id) => {
    return await deleteItem("invoices", id);
  };

  // ✅ الدالة الجديدة لتصدير الفواتير بالعربي
  const exportInvoicesToExcel = async (invoices) => {
    try {
      if (!invoices.length) {
        alert("لا توجد فواتير للتصدير.");
        return;
      }

      // نحول كل فاتورة إلى كائن بالعناوين العربية
      const formatted = invoices.map((inv) => ({
        "رقم الفاتورة": inv.id || "",
        "اسم العميل": inv.customer_name || "",
        "رقم الهاتف": inv.customer_phone || "",
        "التاريخ": inv.date ? new Date(inv.date.seconds * 1000).toLocaleString() : "",
        "إجمالي العلف": inv.amount_of_animal_feeds || "",
        "إجمالي محروس": inv.amount_of_mahros || "",
        "الديون": inv.debt || "",
        "سعر التوصيل": inv.delivery_price || "",
        "الخصم": `${inv.discount || "0"}${inv.discount_percentage?'%':''}`,
        "الخصم لـ": inv.discount_for || "",
        "نسبة الخصم": inv.discount_percentage ? "نسبة مئوية" : "مبلغ ثابت",
        "الوقت": inv.time ? new Date(inv.time.seconds * 1000).toLocaleString() : "",
        "المنتجات": Array.isArray(inv.products)
          ? inv.products
              .map((p, i) => {
                const name = p.product_name || "غير محدد";
                const qty = p.product_quantity || "1";
                const price = p.product_price || "0";
                const total = p.product_price * p.product_quantity || "0";
                return `(${i + 1}) ${name} - الكمية: ${qty} - السعر: ${price} - الإجمالي: ${total}`;
              })
              .join("\n")
          : "",
      }));

      // تحويل إلى شيت Excel
      const worksheet = XLSX.utils.json_to_sheet(formatted);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "الفواتير");

      // كتابة الملف وتنزيله
      const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const blob = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "الفواتير.xlsx";
      link.click();
      URL.revokeObjectURL(url);

      return `✅ تم تصدير ${invoices.length} فاتورة بنجاح`
    } catch (err) {
      return  "❌ حدث خطأ أثناء تصدير الفواتير"
    }
  };
const deleteOldInvoices = async () => {
  try {
    // التاريخ الحالي
    const now = new Date();

    // بداية الشهر الحالي (1 في اليوم، 00:00:00)
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    console.log("🗓️ سيتم حذف الفواتير الأقدم من:", firstDayOfMonth.toLocaleString());

    // نقرأ كل الفواتير
    const allInvoices = await readFrom("invoices");

    let deletedCount = 0;

    // نمشي على كل فاتورة
    for (const inv of allInvoices) {
      // لو فيها تاريخ
      if (inv.date) {
        // Firestore Timestamp → JS Date
        const invDate = inv.date.seconds
          ? new Date(inv.date.seconds * 1000)
          : new Date(inv.date);

        // لو تاريخها قبل أول الشهر
        if (invDate < firstDayOfMonth) {
          console.log("🚀 ~ deleteOldInvoices ~ inv.id:", inv.id)
          await deleteInvoice(inv.id);
          
          deletedCount++;
        }
      }
    }

    alert(`✅ تم حذف ${deletedCount} فاتورة أقدم من ${firstDayOfMonth.toLocaleDateString()}`);
    console.log(`✅ Deleted ${deletedCount} old invoices.`);
  } catch (err) {
    console.error("❌ خطأ أثناء حذف الفواتير القديمة:", err);
    alert("حدث خطأ أثناء عملية الحذف.");
  }
};
  return {
    list,
    invoiceToEdit,
    fetchInvoices,
    addInvoice,
    updateInvoice,
    deleteInvoice,
    deleteOldInvoices,
    exportInvoicesToExcel, // ← أضفها هنا
  };
});
