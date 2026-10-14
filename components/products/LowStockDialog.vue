<template>
  <UiAppDialog v-model:open="open" :title="`تنبيهات المخزون (${orderRows.length})`">
    <div class="space-y-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <UInput v-model="search" icon="i-lucide-search" placeholder="بحث باسم الصنف أو رقمه" class="w-full sm:max-w-xs" size="sm" />
        <div class="flex flex-wrap items-center gap-2">
          <UButton color="warning" variant="soft" icon="i-lucide-bell-off" :disabled="!selectedRows.length || muting" @click="confirmMuteOpen = true">
            إيقاف التنبيه ({{ selectedRows.length }})
          </UButton>
          <UButton color="success" variant="soft" icon="i-lucide-file-spreadsheet" :disabled="!selectedRows.length" @click="exportOrder">
            إنشاء طلب شراء ({{ selectedRows.length }})
          </UButton>
        </div>
      </div>

      <div v-if="orderRows.length" class="flex items-center justify-between gap-2 text-xs text-gray-500">
        <span>التنبيهات المحددة: {{ selectedRows.length }} من {{ filteredRows.length }} · الأصناف المتأثرة: {{ selectedProductCount }}</span>
        <UButton size="xs" color="neutral" variant="link" class="p-0" @click="toggleSelectFiltered">
          {{ allFilteredSelected ? "إلغاء تحديد الكل" : "تحديد الكل" }}
        </UButton>
      </div>

      <p v-if="orderRows.length" class="text-xs text-gray-500">
        لكل كمية مفتوحة أو عبوة مغلقة مؤشر مستقل. الطلب المقترح يخص المكوّن المحدد فقط؛ اكتب الكمية المطلوبة في ملف Excel ثم استورده من شاشة المنتجات.
      </p>

      <UAlert v-if="!orderRows.length && productsWithoutInventory.length" color="warning" variant="soft" icon="i-lucide-database" title="تعذر تقييم مخزون بعض الأصناف" :description="`بيانات المخزون غير مكتملة لـ ${productsWithoutInventory.length} صنف. افتح الصنف وأكمل رصيده الفعلي قبل الاعتماد على تنبيهاته.`" />
      <UAlert v-if="!orderRows.length && configuredAlertCount > 0" color="success" variant="soft" icon="i-lucide-circle-check" title="كل الأرصدة عند مؤشرات التنبيه أو أعلى" description="تم تقييم مؤشرات الكميات المفتوحة والعبوات المغلقة التي لها رصيد مخزون صالح." />
      <UAlert v-if="!orderRows.length && configuredAlertCount === 0 && productsWithoutInventory.length === 0" color="neutral" variant="soft" icon="i-lucide-bell-off" title="لا توجد مؤشرات تنبيه مفعّلة" description="فعّل مؤشرًا للكمية المفتوحة أو لأي عبوة من تعديل الصنف لتلقي تنبيه عند انخفاضها." />
      <UAlert v-if="orderRows.length > 0 && !filteredRows.length" color="neutral" variant="soft" icon="i-lucide-search" title="لا توجد نتائج مطابقة للبحث" />

      <div v-if="filteredRows.length" class="max-h-[65vh] overflow-auto rounded-lg border border-gray-200">
        <table class="w-full min-w-[720px] text-sm">
          <thead class="sticky top-0 bg-gray-50 text-gray-600">
            <tr>
              <th class="w-10 p-2"><UCheckbox :model-value="allFilteredSelected" aria-label="تحديد الكل" @update:model-value="toggleSelectFiltered" /></th>
              <th class="p-2 text-start font-semibold">الصنف</th>
              <th class="p-2 text-start font-semibold">المكوّن</th>
              <th class="p-2 text-start font-semibold">الرصيد الفعلي</th>
              <th class="p-2 text-start font-semibold">مؤشر التنبيه</th>
              <th class="p-2 text-start font-semibold">المستهدف</th>
              <th class="p-2 text-start font-semibold">المقترح للطلب</th>
              <th v-if="showCost" class="p-2 text-start font-semibold">تكلفة الوحدة</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredRows" :key="row.key" class="cursor-pointer border-t border-gray-100 hover:bg-gray-50" :class="isSelected(row.key) ? 'bg-emerald-50/60' : ''" @click="toggleRow(row.key)">
              <td class="p-2" @click.stop><UCheckbox :model-value="isSelected(row.key)" :aria-label="`تحديد تنبيه ${row.name} ${row.unit.name}`" @update:model-value="() => toggleRow(row.key)" /></td>
              <td class="p-2 font-medium">{{ row.name }} <UBadge :color="row.badgeColor" variant="soft" class="ms-1">{{ row.statusLabel }}</UBadge></td>
              <td class="p-2">{{ row.componentLabel }}</td>
              <td class="p-2 font-semibold" :class="row.qtyClass">{{ row.current }} {{ row.unit.name }}</td>
              <td class="p-2">{{ row.reorderPoint }} {{ row.unit.name }}</td>
              <td class="p-2">{{ row.targetLevel }} {{ row.unit.name }}</td>
              <td class="p-2">{{ row.orderQty ? `${row.orderQty} ${row.unit.name}` : "—" }}</td>
              <td v-if="showCost" class="p-2">{{ row.costLabel }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <UAlert v-if="muteError" color="error" variant="soft" :title="muteError" />
    </div>

    <UiAppDialog v-model:open="confirmMuteOpen" title="إيقاف التنبيه" :z-index="70">
      <p class="py-2 text-sm text-gray-600">سيتم إيقاف {{ selectedRows.length }} تنبيهًا عبر {{ selectedProductCount }} صنف. يمكن إعادة تفعيل مؤشر كل مكوّن من تعديل الصنف.</p>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="warning" class="min-h-11 flex-1" icon="i-lucide-bell-off" :loading="muting" @click="muteSelected">تأكيد إيقاف التنبيه</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="muting" @click="confirmMuteOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
  </UiAppDialog>
</template>

<script setup lang="ts">
import type { Product, ProductUnit, InventoryAlerts } from "~/types";
import { round4, toNum, shortageUnitRowsOf, unitAverageCost } from "~/composables/finance";
import { normalizeInventory } from "../../functions/shared/inventoryCore.mjs";

const props = defineProps<{ products: Product[]; showCost: boolean }>();
const open = defineModel<boolean>("open", { required: true });
const { formatePrice } = useHelpers();
const productsStore = useProductsStore();
const { notify } = useAppToast();
const search = ref("");
const selectedKeys = ref<string[]>([]);
const muting = ref(false);
const muteError = ref("");
const confirmMuteOpen = ref(false);

const activeProducts = computed(() => props.products.filter((product) => product.is_active !== false));
const productsWithoutInventory = computed(() => activeProducts.value.filter((product) => {
  try {
    normalizeInventory(product.inventory);
    return false;
  } catch {
    return true;
  }
}));
const configuredAlertCount = computed(() => activeProducts.value.reduce((count, product) => {
  try {
    normalizeInventory(product.inventory);
  } catch {
    return count;
  }
  const loosePoint = Number(product.inventory_alerts?.loose?.reorder_point);
  const hasBaseUnit = product.units?.some((unit) => unit.id === product.base_unit_id && unit.is_base === true && Number(unit.factor) === 1);
  const looseCount = hasBaseUnit && Number.isFinite(loosePoint) && loosePoint > 0 ? 1 : 0;
  const packageCount = (product.units || []).filter((unit: ProductUnit) => {
    const point = Number(product.inventory_alerts?.packages?.[unit.id]?.reorder_point);
    return unit.stock_kind === "package" && Number.isFinite(point) && point > 0;
  }).length;
  return count + looseCount + packageCount;
}, 0));

interface OrderRow {
  key: string;
  product: Product;
  unit: ProductUnit;
  bucket: "loose" | "package";
  name: string;
  componentLabel: string;
  current: number;
  reorderPoint: number;
  targetLevel: number;
  orderQty: number;
  costLabel: string;
  statusLabel: string;
  qtyClass: string;
  badgeColor: "error" | "warning";
}

const orderRows = computed<OrderRow[]>(() => shortageUnitRowsOf(props.products).map(({ product, unit, bucket, key, current, reorder_point, target_level }) => {
  const negative = current < -1e-9;
  const out = !negative && current <= 0;
  const goal = target_level ?? reorder_point;
  const needed = Math.max(0, goal - current);
  const orderQty = bucket === "package" ? Math.ceil(needed - 1e-9) : round4(needed);
  const average = unitAverageCost(product, unit);
  return {
    key, product, unit, bucket, name: product.name,
    componentLabel: bucket === "package" ? `عبوات مغلقة · ${unit.name}` : `${product.inventory_mode === "independent" ? "عبوات مفردة" : "كمية مفتوحة"} · ${unit.name}`,
    current, reorderPoint: reorder_point, targetLevel: goal, orderQty,
    costLabel: average === null ? "—" : `${formatePrice(average)} ج`,
    statusLabel: negative ? "رصيد سالب" : out ? "نافد" : "أقل من المؤشر",
    qtyClass: negative || out ? "text-red-700" : "text-amber-700",
    badgeColor: negative || out ? "error" as const : "warning" as const,
  };
}).sort((left, right) => left.current - right.current || left.product.name.localeCompare(right.product.name) || left.unit.name.localeCompare(right.unit.name)));

const filteredRows = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return orderRows.value.filter((row) => !query || `${row.product.id || ""} ${row.name} ${row.unit.name}`.toLocaleLowerCase().includes(query));
});
const selectedRows = computed(() => {
  const selected = new Set(selectedKeys.value);
  return orderRows.value.filter((row) => selected.has(row.key));
});
const selectedProductCount = computed(() => new Set(selectedRows.value.map((row) => row.product.id).filter(Boolean)).size);
const allFilteredSelected = computed(() => filteredRows.value.length > 0 && filteredRows.value.every((row) => selectedKeys.value.includes(row.key)));

watch(() => orderRows.value.map((row) => row.key).join("|"), () => {
  const keys = new Set(orderRows.value.map((row) => row.key));
  selectedKeys.value = selectedKeys.value.filter((key) => keys.has(key));
}, { immediate: true });

function isSelected(key: string): boolean { return selectedKeys.value.includes(key); }
function toggleRow(key: string): void {
  const index = selectedKeys.value.indexOf(key);
  if (index >= 0) selectedKeys.value.splice(index, 1);
  else selectedKeys.value.push(key);
}
function toggleSelectFiltered(): void {
  if (allFilteredSelected.value) {
    const filtered = new Set(filteredRows.value.map((row) => row.key));
    selectedKeys.value = selectedKeys.value.filter((key) => !filtered.has(key));
    return;
  }
  for (const row of filteredRows.value) if (!selectedKeys.value.includes(row.key)) selectedKeys.value.push(row.key);
}

async function exportOrder(): Promise<void> {
  const picked = selectedRows.value;
  if (!picked.length) return;
  const XLSX = await import("xlsx/dist/xlsx.full.min.js");
  const headers = ["رقم المنتج", "اسم المنتج", "الكمية المطلوبة", "تكلفة شراء الوحدة", "معرّف وحدة الشراء", "نوع الوحدة", "كل وحدة فيها كام", "المخزون الحالي (أساس)", "مكوّن التنبيه", "رصيد المكوّن الحالي", "مؤشر إعادة الطلب", "المستوى المستهدف", "الكمية المقترحة", "إجمالي السطر", "متوسط التكلفة المتوقع (أساس)"];
  const rows: unknown[][] = [headers];
  const lastRow = picked.length + 1;
  for (const [index, row] of picked.entries()) {
    const rowNumber = index + 2;
    const factor = Number(row.unit.factor);
    const stock = round4(toNum(row.product.stock_quantity));
    const oldAverage = round4(toNum(row.product.cost_price));
    const unitCost = row.unit.purchase_price ?? unitAverageCost(row.product, row.unit) ?? 0;
    const matchingBaseQuantity = `SUMPRODUCT(($A$2:$A$${lastRow}=A${rowNumber})*$C$2:$C$${lastRow}*$G$2:$G$${lastRow})`;
    const matchingValue = `SUMPRODUCT(($A$2:$A$${lastRow}=A${rowNumber})*$C$2:$C$${lastRow}*$D$2:$D$${lastRow})`;
    rows.push([
      row.product.id ?? "", row.product.name, "", unitCost, row.unit.id, row.unit.name, factor,
      stock, row.componentLabel, `${row.current} ${row.unit.name}`, row.reorderPoint, row.targetLevel,
      row.orderQty,
      { t: "n", f: `IF(OR(C${rowNumber}="",D${rowNumber}=""),"",ROUND(C${rowNumber}*D${rowNumber},2))` },
      { t: "n", f: `IF(OR(A${rowNumber}="",${matchingBaseQuantity}=0),"",ROUND(IF(H${rowNumber}<=0,${matchingValue}/${matchingBaseQuantity},(H${rowNumber}*${oldAverage}+${matchingValue})/(H${rowNumber}+${matchingBaseQuantity})),4))` },
    ]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [24, 32, 18, 22, 38, 20, 14, 22, 24, 20, 18, 18, 18, 18, 30].map((wch) => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "طلب شراء");
  XLSX.writeFile(workbook, `طلب_شراء_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function muteSelected(): Promise<void> {
  if (!selectedRows.value.length) return;
  muteError.value = "";
  muting.value = true;
  try {
    const grouped = new Map<string, OrderRow[]>();
    let failed = 0;
    for (const row of selectedRows.value) {
      if (!row.product.id) { failed += 1; continue; }
      grouped.set(row.product.id, [...(grouped.get(row.product.id) || []), row]);
    }
    let succeeded = 0;
    for (const [productId, rows] of grouped) {
      const current = rows[0]?.product.inventory_alerts || {};
      const alerts: InventoryAlerts = {
        loose: { reorder_point: Number(current.loose?.reorder_point ?? 0), target_level: current.loose?.target_level ?? null },
        packages: {},
      };
      for (const [unitId, rule] of Object.entries(current.packages || {})) {
        alerts.packages![unitId] = { reorder_point: Number(rule.reorder_point ?? 0), target_level: rule.target_level ?? null };
      }
      for (const row of rows) {
        if (row.bucket === "package") alerts.packages![row.unit.id] = { reorder_point: 0, target_level: alerts.packages?.[row.unit.id]?.target_level ?? null };
        else alerts.loose = { reorder_point: 0, target_level: alerts.loose?.target_level ?? null };
      }
      const result = await productsStore.updateProduct(productId, { inventory_alerts: alerts });
      if (result) succeeded += rows.length;
      else failed += rows.length;
    }
    if (succeeded) notify(failed ? `تم إيقاف ${succeeded} تنبيهًا، وتعذر إيقاف ${failed}.` : "تم إيقاف التنبيهات المحددة.", failed ? "error" : "success");
    if (!failed) confirmMuteOpen.value = false;
    else muteError.value = "تعذر إيقاف بعض التنبيهات. أعد المحاولة بعد تحديث القائمة.";
  } catch (error) {
    muteError.value = error instanceof Error ? error.message : "تعذر إيقاف التنبيهات.";
  } finally {
    muting.value = false;
  }
}
</script>
