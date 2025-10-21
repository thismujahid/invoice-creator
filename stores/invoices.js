import * as XLSX from "xlsx/dist/xlsx.full.min.js";

export const useInvoicesStore = defineStore("invoices", () => {
  const { readFrom, saveDataTo, updateItem, deleteItem } = useFirebase();
  const list = ref([]);
  const invoiceToEdit = ref();

  const fetchInvoices = async (filters = {}) => {
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
const exportInvoicesToExcel = async (invoices = []) => {
  const { calcTotal } = useHelpers();

  try {
    if (!invoices.length) {
      alert("⚠️ لا توجد فواتير للتصدير.");
      return;
    }

    const formatted = invoices.map((inv) => {
      const netTotal = Array.isArray(inv.products)
        ? inv.products.reduce(
            (sum, p) =>
              sum +
              (Number(p.product_price) || 0) * (Number(p.product_quantity) || 0),
            0
          )
        : 0;

      const totalCost = Array.isArray(inv.products)
        ? inv.products.reduce(
            (sum, p) =>
              sum +
              (Number(p.product_cost_price) || 0) * (Number(p.product_quantity) || 0),
            0
          )
        : 0;

      const discountValue = inv.discount_percentage
        ? (netTotal * (Number(inv.discount) || 0)) / 100
        : Number(inv.discount) || 0;

      const totalAfterDiscount =
        netTotal - discountValue + (Number(inv.delivery_price) || 0);

      const profit = netTotal - totalCost;

      const productsList = Array.isArray(inv.products)
        ? inv.products
            .map((p, i) => {
              const name = p.product_name || "غير محدد";
              const qty = Number(p.product_quantity) || 0;
              const price = Number(p.product_price) || 0;
              const cost = Number(p.product_cost_price) || 0;
              const total = qty * price;
              const totalCost = qty * cost;
              return `(${i + 1}) ${name} - الكمية: ${qty} - السعر: ${price} - التكلفة: ${cost} - إجمالي التكلفة: ${totalCost} - الإجمالي: ${total}`;
            })
            .join("\n")
        : "";

      return {
        "رقم الفاتورة": inv.id || "",
        "اسم العميل": inv.customer_name || "",
        "رقم الهاتف": inv.customer_phone || "",
        "منشئ الفاتورة": formateActiveUserKey(inv.created_by)?.name || "",
        التاريخ: inv.date
          ? new Date(inv.date.seconds * 1000).toLocaleString()
          : "",
        "صافي الفاتورة (المنتجات فقط)": netTotal,
        "قيمة الخصم": discountValue,
        "إجمالي الفاتورة (بعد الخصم + التوصيل)": totalAfterDiscount,
        "إجمالي التكلفة": totalCost,
        "الربح (من المنتجات فقط)": profit,
        الديون: inv.debt || "",
        "سعر التوصيل": inv.delivery_price || "",
        الخصم: `${inv.discount || 0}${inv.discount_percentage ? "%" : ""}`,
        "نوع الخصم": inv.discount_percentage ? "نسبة مئوية" : "مبلغ ثابت",
        المنتجات: productsList,
      };
    });

    // إنشاء الشيت
    const worksheet = XLSX.utils.json_to_sheet(formatted);
    const workbook = XLSX.utils.book_new();

    // حساب عدد الصفوف (علشان نحط الدوال بشكل صحيح)
    const rowCount = formatted.length + 1; // +1 بسبب العناوين

    // الأعمدة اللي هنحط فيها دوال الجمع
    const sumColumns = [
      "صافي الفاتورة (المنتجات فقط)",
      "إجمالي الفاتورة (بعد الخصم + التوصيل)",
      "إجمالي التكلفة",
      "الربح (من المنتجات فقط)",
    ];

    // نحصل على خريطة الأعمدة بالأحرف (A, B, C...)
    const headerKeys = Object.keys(formatted[0]);
    const headerMap = {};
    headerKeys.forEach((key, i) => {
      headerMap[key] = XLSX.utils.encode_col(i); // يحول رقم العمود إلى حرف
    });

    // نضيف صف جديد للدوال في نهاية الجدول
    const totalRowIndex = rowCount + 1;
    const totalLabelCell = `A${totalRowIndex}`;
    worksheet[totalLabelCell] = { t: "s", v: "الإجمالي الكلي (دوال Excel)" };

    sumColumns.forEach((colName) => {
      const colLetter = headerMap[colName];
      if (colLetter) {
        // نكتب دالة SUM مثل =SUM(F2:F20)
        const formula = `SUM(${colLetter}2:${colLetter}${rowCount})`;
        worksheet[`${colLetter}${totalRowIndex}`] = { f: formula };
      }
    });

    // نضبط نطاق الشيت
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    range.e.r = totalRowIndex - 1;
    worksheet["!ref"] = XLSX.utils.encode_range(range);

    // نضيف الشيت للملف
    XLSX.utils.book_append_sheet(workbook, worksheet, "الفواتير");

    // نكتب الملف
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
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



  const deleteOldInvoices = async () => {
    try {
      // التاريخ الحالي
      const now = new Date();

      // بداية الشهر الحالي (1 في اليوم، 00:00:00)
      const firstDayOfMonth = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1
      );

      console.log(
        "🗓️ سيتم حذف الفواتير الأقدم من:",
        firstDayOfMonth.toLocaleString()
      );

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
            await deleteInvoice(inv.id);

            deletedCount++;
          }
        }
      }

      alert(
        `✅ تم حذف ${deletedCount} فاتورة أقدم من ${firstDayOfMonth.toLocaleDateString()}`
      );
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
