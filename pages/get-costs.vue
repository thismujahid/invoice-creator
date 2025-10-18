<script setup>
import * as XLSX from "xlsx";
import { useProductsStore } from "@/stores/products";
import { ref } from "vue";

const productsStore = useProductsStore();
const loading = ref(false);
const outputFile = ref(null);

const handleFileUpload = async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  loading.value = true;
  await productsStore.fetchProducts(); // جلب بيانات المنتجات من Firebase

  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet);

  const updatedRows = rows.map((row) => {
    try {
      const productsText = row["المنتجات"];
      if (!productsText) return row;

      const productLines = productsText
        .split("\n")
        .filter((p) => p.trim() !== "");
      let totalCost = 0;
      let notes = [];

      productLines.forEach((line, index) => {
        const match = line.match(
          /(.+?) - الكمية:\s*(\d+)\s*-\s*السعر:\s*([\d.]+)/
        );
        if (match) {
          const [_, name, qtyStr, priceStr] = match;
          const qty = parseFloat(qtyStr);
          const salePrice = parseFloat(priceStr);

          // إزالة أي أرقام بين أقواس مثل (12)
          const cleanName = name.replace(/\(\d+\)/, "").trim();

          // البحث عن المنتج في store
          const product = productsStore.list.find(
            (p) => p.name?.trim() === cleanName
          );

          let costPrice;
          if (product && product.cost_price) {
            costPrice = parseFloat(product.cost_price);
          } else {
            costPrice = salePrice; // fallback
            notes.push(`${cleanName}: تكلفة غير موجودة (تم استخدام سعر البيع)`);
          }

          const totalProductCost = qty * costPrice;
          totalCost += totalProductCost;

          productLines[index] = `${
            index + 1
          } | الاسم: ${cleanName} | الكمية: ${qty} | السعر: ${salePrice} | التكلفة: ${costPrice} | إجمالي التكلفة: ${totalProductCost} | الإجمالي: ${
            qty * salePrice
          }`;
        }
      });
      row["المنتجات"] = productLines.join("\n");
      const totalInvoice = parseFloat(row["إجمالي الفاتورة"] || 0);
      const profit = totalInvoice - totalCost;

      return {
        ...row,
        "تكلفة الفاتورة": totalCost.toFixed(2),
        الربح: profit.toFixed(2),
        ملاحظات: notes.join(" | ") || "",
      };
    } catch (err) {
      console.error(err);
      return { ...row, ملاحظات: "خطأ أثناء الحساب" };
    }
  });

  const newSheet = XLSX.utils.json_to_sheet(updatedRows);
  const newWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWorkbook, newSheet, "نتائج");
  const wbout = XLSX.write(newWorkbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  outputFile.value = URL.createObjectURL(blob);
  loading.value = false;
};
</script>

<template>
  <div class="p-4">
    <h2 class="text-lg font-semibold mb-2">إضافة تكلفة الفواتير</h2>
    <input type="file" accept=".xlsx" @change="handleFileUpload" />
    <div v-if="loading" class="mt-3 text-blue-500">جارٍ معالجة الملف...</div>
    <div v-if="outputFile && !loading" class="mt-4">
      <a
        :href="outputFile"
        download="فواتير_محدثة.xlsx"
        class="text-green-600 underline"
      >
        تحميل الملف المحدث
      </a>
    </div>
  </div>
</template>
