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
      <div v-else class="max-h-[65vh] space-y-3 overflow-auto">
        <div v-if="negativeRows.length" class="overflow-auto rounded-lg border border-red-200">
          <p class="bg-red-50 px-2 py-1 text-xs font-bold text-red-700">مخزون سالب — يحتاج مراجعة ({{ negativeRows.length }})</p>
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
              <tr v-for="p in negativeRows" :key="p.id" class="border-t border-gray-100">
                <td class="p-2 font-mono text-xs" dir="ltr">{{ p.id }}</td>
                <td class="p-2 font-medium">{{ p.name }}</td>
                <td class="p-2 font-semibold text-red-700">{{ stockLabelOf(p) }}</td>
                <td class="p-2">{{ thresholdDisplayOf(p) }}</td>
                <td v-if="showCost" class="p-2">{{ formatePrice(p.cost_price) }}</td>
                <td class="p-2"><UBadge color="error" variant="soft">سالب</UBadge></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="outRows.length" class="overflow-auto rounded-lg border border-gray-200">
          <p class="bg-gray-50 px-2 py-1 text-xs font-bold text-gray-700">نافدة ({{ outRows.length }})</p>
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
              <tr v-for="p in outRows" :key="p.id" class="border-t border-gray-100">
                <td class="p-2 font-mono text-xs" dir="ltr">{{ p.id }}</td>
                <td class="p-2 font-medium">{{ p.name }}</td>
                <td class="p-2 font-semibold text-gray-500">{{ stockLabelOf(p) }}</td>
                <td class="p-2">{{ thresholdDisplayOf(p) }}</td>
                <td v-if="showCost" class="p-2">{{ formatePrice(p.cost_price) }}</td>
                <td class="p-2"><UBadge color="error" variant="soft">نافد</UBadge></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="lowRows.length" class="overflow-auto rounded-lg border border-gray-200">
          <p class="bg-gray-50 px-2 py-1 text-xs font-bold text-gray-700">قليلة الكمية ({{ lowRows.length }})</p>
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
              <tr v-for="p in lowRows" :key="p.id" class="border-t border-gray-100">
                <td class="p-2 font-mono text-xs" dir="ltr">{{ p.id }}</td>
                <td class="p-2 font-medium">{{ p.name }}</td>
                <td class="p-2 font-semibold text-amber-700">{{ stockLabelOf(p) }}</td>
                <td class="p-2">{{ thresholdDisplayOf(p) }}</td>
                <td v-if="showCost" class="p-2">{{ formatePrice(p.cost_price) }}</td>
                <td class="p-2"><UBadge color="warning" variant="soft">قليل الكمية</UBadge></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </UiAppDialog>
</template>

<script setup lang="ts">
import type { Product } from "~/types";

const props = defineProps<{ products: Product[]; showCost: boolean }>();
const open = defineModel<boolean>("open", { required: true });
const { formatePrice } = useHelpers();
const { isLowStock, isNegativeStock, isOutOfStock, thresholdDisplayOf, toNum, unitStockDisplay, unitsForProduct } = useFinance();
const search = ref("");
function matchesSearch(p: Product): boolean {
  const q = search.value.trim().toLocaleLowerCase();
  return !q || `${p.id ?? ""} ${p.name}`.toLocaleLowerCase().includes(q);
}
function byShortage(a: Product, b: Product): number {
  return toNum(a.stock_quantity) - toNum(b.stock_quantity) || a.name.localeCompare(b.name);
}
function stockLabelOf(p: Product): string {
  const units = unitsForProduct(p);
  const base = units.find((u) => u.is_base) ?? units[0];
  if (!base) return String(toNum(p.stock_quantity));
  const value = unitStockDisplay(p, base);
  return `${Number.isInteger(value) ? value : Math.round(value * 100) / 100} ${base.name}`;
}
const negativeRows = computed(() => props.products.filter((p) => isNegativeStock(p) && matchesSearch(p)).sort(byShortage));
const outRows = computed(() => props.products.filter((p) => isOutOfStock(p) && !isNegativeStock(p) && matchesSearch(p)).sort(byShortage));
const lowRows = computed(() => props.products.filter((p) => isLowStock(p) && !isOutOfStock(p) && matchesSearch(p)).sort(byShortage));
const rows = computed(() => [...negativeRows.value, ...outRows.value, ...lowRows.value]);

async function exportOrder(): Promise<void> {
  const XLSX = await import("xlsx/dist/xlsx.full.min.js");
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
