<template>
  <UiAppDialog
    v-model:open="open"
    :title="`الوحدات قليلة الكمية (${orderRows.length})`"
  >
    <div class="space-y-3">
      <div
        class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="بحث باسم المنتج أو رقمه"
          class="w-full sm:max-w-xs"
          size="sm"
        />
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            color="warning"
            variant="soft"
            icon="i-lucide-bell-off"
            :disabled="selectedRows.length === 0 || muting"
            @click="confirmMuteOpen = true"
          >
            إيقاف التنبيه ({{ selectedRows.length }})
          </UButton>
          <UButton
            color="success"
            variant="soft"
            icon="i-lucide-file-spreadsheet"
            :disabled="selectedRows.length === 0"
            @click="exportOrder"
          >
            إنشاء طلب شراء ({{ selectedRows.length }})
          </UButton>
        </div>
      </div>
      <div
        v-if="orderRows.length"
        class="flex items-center justify-between gap-2 text-xs text-gray-500"
      >
        <span
          >المحدد: {{ selectedRows.length }} من {{ filteredRows.length }}</span
        >
        <UButton
          size="xs"
          color="neutral"
          variant="link"
          class="p-0"
          @click="toggleSelectFiltered"
        >
          {{ allFilteredSelected ? "إلغاء تحديد الكل" : "تحديد الكل" }}</UButton
        >
      </div>
      <p v-if="orderRows.length" class="text-xs text-gray-400">
        تظهر وحدات الشراء التي رصيدها أقل من مؤشر نقصها فقط.
      </p>
      <UAlert
        v-if="!orderRows.length"
        color="success"
        variant="soft"
        icon="i-lucide-circle-check"
        title="لا توجد منتجات قليلة الكمية"
      />
      <UAlert
        v-else-if="!filteredRows.length"
        color="neutral"
        variant="soft"
        icon="i-lucide-search"
        title="لا توجد نتائج مطابقة للبحث"
      />
      <div
        v-else
        class="max-h-[65vh] overflow-auto rounded-lg border border-gray-200"
      >
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-gray-50 text-gray-600">
            <tr>
              <th class="w-10 p-2">
                <UCheckbox
                  :model-value="allFilteredSelected"
                  aria-label="تحديد الكل"
                  @update:model-value="toggleSelectFiltered"
                />
              </th>
              <th class="p-2 text-start font-semibold">اسم المنتج</th>
              <th class="p-2 text-start font-semibold">الكمية الحالية</th>
              <th class="p-2 text-start font-semibold">مؤشر النقص</th>
              <th v-if="showCost" class="p-2 text-start font-semibold">
                تكلفة الوحدة
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredRows"
              :key="row.key"
              class="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
              :class="isSelected(row.key) ? 'bg-emerald-50/60' : ''"
              @click="toggleRow(row.key)"
            >
              <td class="p-2" @click.stop>
                <UCheckbox
                  :model-value="isSelected(row.key)"
                  :aria-label="`تحديد ${row.name}`"
                  @update:model-value="() => toggleRow(row.key)"
                />
              </td>
              <td class="p-2 font-medium">
                {{ row.name }}
                <UBadge :color="row.badgeColor" variant="soft" class="ms-1">{{
                  row.statusLabel
                }}</UBadge>
              </td>
              <td class="p-2 font-semibold" :class="row.qtyClass">
                {{ row.qtyLabel }}
              </td>
              <td class="p-2">{{ row.thresholdLabel }}</td>
              <td v-if="showCost" class="p-2">{{ row.costLabel }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <UAlert
        v-if="muteError"
        color="error"
        variant="soft"
        :title="muteError"
      />
    </div>
    <UiAppDialog
      v-model:open="confirmMuteOpen"
      title="إيقاف التنبيه"
      :z-index="70"
    >
      <p class="py-2 text-sm text-gray-600">
        سيتم إلغاء مؤشر النقص عن {{ selectedRows.length }} وحدة مفعّلة في
        {{ muteProductCount }} منتج — لن تظهر هذه الوحدات في قائمة النواقص بعد
        الآن. يمكن إعادة تفعيل المؤشر لاحقًا من تعديل المنتج. متابعة؟
      </p>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="warning"
            class="min-h-11 flex-1"
            icon="i-lucide-bell-off"
            :loading="muting"
            @click="muteSelected"
            >تأكيد إيقاف التنبيه</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="min-h-11 flex-1"
            :disabled="muting"
            @click="confirmMuteOpen = false"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
  </UiAppDialog>
</template>

<script setup lang="ts">
import type { Product, ProductUnit } from "~/types";

const props = defineProps<{ products: Product[]; showCost: boolean }>();
const open = defineModel<boolean>("open", { required: true });
const { formatePrice } = useHelpers();
const {
  isLowStock,
  isUnitLowStock,
  toNum,
  round4,
  purchasableUnitsForProduct,
  unitsForProduct,
  unitPurchasePrice,
  unitAverageCost,
  unitStockDisplay,
  unitLowThresholdOf,
  shortageUnitRowsOf,
  unitThresholdDisplayOf,
  lowStockThresholdOf,
} = useFinance();
const productsStore = useProductsStore();
const { notify } = useAppToast();
const search = ref("");
const selectedKeys = ref<string[]>([]);
const muting = ref(false);
const muteError = ref("");
const confirmMuteOpen = ref(false);

interface OrderRow {
  key: string;
  product: Product;
  unit: ProductUnit;
  name: string;
  qtyLabel: string;
  qtyClass: string;
  thresholdLabel: string;
  costLabel: string;
  statusLabel: string;
  badgeColor: "error" | "warning" | "success" | "info" | "neutral";
}

function matchesSearch(p: Product, unitName = ""): boolean {
  const q = search.value.trim().toLocaleLowerCase();
  return (
    !q || `${p.id ?? ""} ${p.name} ${unitName}`.toLocaleLowerCase().includes(q)
  );
}
function byShortage(a: Product, b: Product): number {
  return (
    toNum(a.stock_quantity) - toNum(b.stock_quantity) ||
    a.name.localeCompare(b.name)
  );
}

/** Shared shortage rows (product × unit) — the same source the button count
 *  and the Excel export use, so all three always agree. */
const baseRows = computed(() => shortageUnitRowsOf(props.products));

function legacyThresholdLabel(p: Product, unit: ProductUnit): string {
  const factor =
    Number(unit.factor) > 0 && Number.isFinite(Number(unit.factor))
      ? Number(unit.factor)
      : 1;
  return `${String(round4(lowStockThresholdOf(p) / factor))} ${unit.name || "وحدة"}`;
}

const orderRows = computed<OrderRow[]>(() =>
  baseRows.value
    .map(({ product: p, unit }) => {
        const hasUnitThreshold = unitLowThresholdOf(unit) !== null;
        const quantity = unitStockDisplay(p, unit);
        const negative = quantity < 0;
        const out = quantity === 0;
        const low =
          !negative && !out
            ? hasUnitThreshold
              ? isUnitLowStock(p, unit)
              : isLowStock(p)
            : false;
        const statusLabel = negative
          ? "سالب"
          : out
            ? "نافد"
            : low
              ? "قليل الكمية"
              : "متوفر";
        const badgeColor =
          negative || out ? "error" : low ? "warning" : "neutral";
        const qtyClass = negative
          ? "text-red-700"
          : out
            ? "text-gray-500"
            : low
              ? "text-amber-700"
              : "text-gray-500";
        const avg = unitAverageCost(p, unit);
        return {
          key: `${p.id ?? p.name}__${unit.id}`,
          product: p,
          unit,
          name: `${p.name} (${unit?.name ?? p.base_unit_name ?? "وحدة"})`,
          qtyLabel: `${round4(unitStockDisplay(p, unit))} ${unit.name || "وحدة"}`,
          qtyClass,
          thresholdLabel: hasUnitThreshold
            ? unitThresholdDisplayOf(unit)
            : legacyThresholdLabel(p, unit),
          costLabel: avg === null ? "—" : formatePrice(avg),
          statusLabel,
          badgeColor,
        } as OrderRow;
      })
    .sort(
      (a, b) =>
        byShortage(a.product, b.product) || a.unit.factor - b.unit.factor,
    ),
);

const filteredRows = computed(() =>
  orderRows.value.filter((row) => matchesSearch(row.product, row.unit.name)),
);

watch(
  () => orderRows.value.map((r) => r.key).join("|"),
  () => {
    const keys = new Set(orderRows.value.map((r) => r.key));
    selectedKeys.value = selectedKeys.value.filter((k) => keys.has(k));
  },
  { immediate: true },
);

function isSelected(key: string): boolean {
  return selectedKeys.value.includes(key);
}
function toggleRow(key: string): void {
  const index = selectedKeys.value.indexOf(key);
  if (index > -1) selectedKeys.value.splice(index, 1);
  else selectedKeys.value.push(key);
}
const allFilteredSelected = computed(
  () =>
    filteredRows.value.length > 0 &&
    filteredRows.value.every((r) => selectedKeys.value.includes(r.key)),
);
function toggleSelectFiltered(): void {
  if (allFilteredSelected.value) {
    const filtered = new Set(filteredRows.value.map((r) => r.key));
    selectedKeys.value = selectedKeys.value.filter((k) => !filtered.has(k));
  } else {
    for (const r of filteredRows.value) {
      if (!selectedKeys.value.includes(r.key)) selectedKeys.value.push(r.key);
    }
  }
}
const selectedRows = computed(() => {
  const selected = new Set(selectedKeys.value);
  return orderRows.value.filter((r) => selected.has(r.key));
});
const muteProductCount = computed(
  () =>
    new Set(selectedRows.value.map((r) => r.product.id ?? r.product.name)).size,
);

async function exportOrder(): Promise<void> {
  const picked = selectedRows.value;
  if (!picked.length) return;
  const XLSX = await import("xlsx/dist/xlsx.full.min.js");
  const rows: unknown[][] = [[
    "رقم المنتج", "اسم المنتج", "الكمية المطلوبة", "تكلفة شراء الوحدة", "الإجمالي",
  ]];
  for (const [index, { product, unit }] of picked.entries()) {
    const rowNumber = index + 2;
    rows.push([
      product.id ?? "",
      `${product.name} (${unit.name})`,
      "",
      unitPurchasePrice(product, unit) ?? unit.average_cost ?? 0,
      { t: "n", f: `IF(OR(C${rowNumber}="",D${rowNumber}=""),"",ROUND(C${rowNumber}*D${rowNumber},2))` },
    ]);
  }
  rows.push(["", "الإجمالي", "", "", { t: "n", v: 0, f: `SUM(E2:E${picked.length + 1})` }]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 24 }, { wch: 32 }, { wch: 20 }, { wch: 24 }, { wch: 20 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "طلب شراء");
  XLSX.writeFile(
    workbook,
    `طلب_شراء_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

/** Clear the shortage threshold of every selected unit (null = no alert for
 *  that unit). The legacy product-level fallback is silenced to 0 alongside
 *  so a product whose last threshold was cleared does not resurface through
 *  the legacy default. Muted rows disappear from this list on the next sync. */
async function muteSelected(): Promise<void> {
  const picked = selectedRows.value;
  if (!picked.length) return;
  muteError.value = "";
  muting.value = true;
  try {
    const byProduct = new Map<
      string,
      { product: Product; unitIds: Set<string> }
    >();
    for (const row of picked) {
      const pid = row.product.id;
      if (!pid) continue;
      const entry = byProduct.get(pid) ?? {
        product: row.product,
        unitIds: new Set<string>(),
      };
      entry.unitIds.add(row.unit.id);
      byProduct.set(pid, entry);
    }
    let ok = 0;
    let failed = 0;
    for (const { product, unitIds } of byProduct.values()) {
      const pid = product.id;
      if (!pid) {
        failed += 1;
        continue;
      }
      const stored =
        Array.isArray(product.units) && product.units.length
          ? product.units
          : null;
      const nextUnits: ProductUnit[] = stored
        ? stored.map((u) =>
            unitIds.has(u.id) ? { ...u, low_stock_threshold: null } : { ...u },
          )
        : [
            {
              id: product.base_unit_id || "base",
              name: product.base_unit_name || "وحدة",
              factor: 1,
              selling_price: product.price ?? null,
              purchase_price: product.cost_price ?? null,
              is_base: true,
              can_purchase: true,
              can_sell: true,
              low_stock_threshold: null,
            },
          ];
      const res = await productsStore.updateProduct(pid, {
        units: nextUnits,
        low_stock_threshold: 0,
      });
      if (res !== null) ok += 1;
      else failed += 1;
    }
    if (ok > 0) {
      notify(
        failed > 0
          ? `تم إيقاف التنبيه عن ${ok} منتج، وفشل ${failed}.`
          : "تم إيقاف التنبيه عن الوحدات المحددة.",
        failed > 0 ? "error" : "success",
      );
    } else {
      muteError.value = "تعذر إيقاف التنبيه. حاول مرة أخرى.";
    }
    if (failed === 0) confirmMuteOpen.value = false;
    else muteError.value = "تعذر إيقاف التنبيه عن بعض المنتجات.";
  } catch (e) {
    muteError.value = e instanceof Error ? e.message : "تعذر إيقاف التنبيه.";
  } finally {
    muting.value = false;
  }
}
</script>
