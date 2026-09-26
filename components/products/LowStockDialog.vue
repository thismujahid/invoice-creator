<template>
  <UiAppDialog v-model:open="open" title="المنتجات قليلة الكمية">
    <div class="space-y-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <UInput v-model="search" icon="i-lucide-search" placeholder="بحث باسم المنتج أو رقمه" class="w-full sm:max-w-xs" />
        <UButton color="success" variant="soft" icon="i-lucide-file-spreadsheet" :disabled="rows.length === 0" @click="exportOrder">
          تصدير طلب شراء Excel
        </UButton>
      </div>
      <UAlert v-if="!rows.length" color="success" variant="soft" icon="i-lucide-circle-check" title="لا توجد منتجات قليلة الكمية" />
      <div v-else class="max-h-[65vh] overflow-auto rounded-lg border border-gray-200">
        <table class="w-full min-w-[34rem] text-sm">
          <thead class="sticky top-0 bg-gray-50 text-gray-600">
            <tr>
              <th class="p-2 text-start font-semibold">رقم المنتج</th>
              <th class="p-2 text-start font-semibold">اسم المنتج</th>
              <th class="p-2 text-start font-semibold">الكمية الحالية</th>
              <th class="p-2 text-start font-semibold">مؤشر النقص</th>
              <th v-if="showCost" class="p-2 text-start font-semibold">تكلفة الوحدة</th>
              <th class="p-2 text-start font-semibold">الحالة</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in rows" :key="p.id" class="border-t border-gray-100">
              <td class="p-2 font-mono text-xs" dir="ltr">{{ p.id }}</td>
              <td class="p-2 font-medium">{{ p.name }}</td>
              <td class="p-2 font-semibold text-amber-700">{{ toNum(p.stock_quantity) }}</td>
              <td class="p-2">{{ lowStockThresholdOf(p) }}</td>
              <td v-if="showCost" class="p-2">{{ formatePrice(p.cost_price) }}</td>
              <td class="p-2"><UBadge color="warning" variant="soft">قليل الكمية</UBadge></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </UiAppDialog>
</template>

<script setup lang="ts">
import * as XLSX from "xlsx/dist/xlsx.full.min.js";
import type { Product } from "~/types";

const props = defineProps<{ products: Product[]; showCost: boolean }>();
const open = defineModel<boolean>("open", { required: true });
const { formatePrice } = useHelpers();
const { isLowStock, lowStockThresholdOf, toNum } = useFinance();
const search = ref("");
const rows = computed(() => {
  const q = search.value.trim().toLocaleLowerCase();
  return props.products
    .filter((p) => isLowStock(p))
    .filter((p) => !q || `${p.id ?? ""} ${p.name}`.toLocaleLowerCase().includes(q))
    .sort((a, b) => toNum(a.stock_quantity) - toNum(b.stock_quantity) || a.name.localeCompare(b.name));
});

function exportOrder(): void {
  const data = [
    ["رقم المنتج", "اسم المنتج", "الكمية المطلوبة", "تكلفة شراء الوحدة"],
    ...rows.value.map((p) => [p.id ?? "", p.name, "", toNum(p.cost_price)]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [{ wch: 24 }, { wch: 32 }, { wch: 20 }, { wch: 24 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "طلب شراء");
  XLSX.writeFile(workbook, `طلب_شراء_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
</script>
