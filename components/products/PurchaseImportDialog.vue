<template>
  <UiAppDialog v-model:open="open" title="استيراد كميات ومنتجات" width="sm:max-w-4xl">
    <div class="space-y-4">
      <template v-if="!result">
        <UFormField label="ملف طلب الشراء" :error="fileError || undefined">
          <div
            class="relative overflow-hidden rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 p-4 transition hover:border-emerald-500 hover:bg-emerald-50"
          >
            <input
              ref="fileInput"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              class="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              :disabled="busy"
              @change="onFile"
            />
            <div
              class="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-start"
            >
              <span
                class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100"
              >
                <UIcon name="i-lucide-file-spreadsheet" class="size-6" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block break-all font-semibold text-gray-900">{{
                  selectedFileName || "لم يتم اختيار ملف بعد"
                }}</span>
                <span class="mt-1 block text-xs text-gray-500"
                  >ملف .xlsx، حتى 10 ميجابايت</span
                >
                <span
                  v-if="selectedFileSize"
                  class="mt-1 block text-xs text-gray-500"
                  >حجم الملف: {{ selectedFileSize }}</span
                >
              </span>
              <span
                class="pointer-events-none inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm"
              >
                <UIcon name="i-lucide-upload" class="size-4" />
                {{ selectedFileName ? "استبدال الملف" : "اختيار ملف" }}
              </span>
            </div>
          </div>
        </UFormField>
        <UAlert
          v-if="parseError"
          color="error"
          variant="soft"
          :title="parseError"
        />
        <template v-if="rows.length">
          <UAlert color="info" variant="soft" title="تُحدّث أسعار البيع تلقائيًا بنفس نسبة ربح كل وحدة. عند تكرار النوع في الملف، يُستخدم آخر سطر له كأساس لتكلفة التسعير." />
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <UCard variant="outline"
              ><div class="text-lg font-bold">{{ rows.length }}</div>
              <div class="text-xs text-gray-500">صفوف الملف</div></UCard
            >
            <UCard variant="outline"
              ><div class="text-lg font-bold">{{ matchedCount }}</div>
              <div class="text-xs text-gray-500">منتجات موجودة</div></UCard
            >
            <UCard variant="outline"
              ><div
                class="text-lg font-bold"
                :class="errorCount ? 'text-red-600' : 'text-emerald-700'"
              >
                {{ errorCount }}
              </div>
              <div class="text-xs text-gray-500">صفوف تحتاج مراجعة</div></UCard
            >
          </div>
          <div v-if="problemRows.length" class="space-y-2">
            <p class="text-xs font-bold text-amber-700">
              الصفوف التالية تحتاج تصحيحًا قبل تأكيد الفاتورة.
            </p>
            <div
              class="space-y-2"
            >
              <UCard
                v-for="row in problemRows"
                :key="row.rowNumber"
                variant="outline"
                class="space-y-2 p-3"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-sm font-bold">
                      صف {{ row.rowNumber }} · {{ row.name || "بدون اسم" }}
                    </div>
                    <div
                      class="mt-0.5 font-mono text-xs text-gray-500"
                      dir="ltr"
                    >
                      {{ row.productId || "بدون رقم منتج" }}
                    </div>
                  </div>
                  <UBadge
                    :color="
                      row.product ? 'success' : 'warning'
                    "
                    variant="soft"
                  >
                    {{
                      row.product ? "صنف مطابق" : "يحتاج مطابقة"
                    }}
                  </UBadge>
                </div>
                <div v-if="!row.product" class="rounded-lg bg-amber-50 p-3">
                  <UFormField label="اختيار منتج موجود يدويًا (اختياري)">
                    <USelectMenu
                      :model-value="undefined"
                      :items="products"
                      label-key="name"
                      by="id"
                      placeholder="ابحث بالاسم واختر المنتج المطابق"
                      :search-input="{
                        placeholder: 'بحث عن منتج…',
                        icon: 'i-lucide-search',
                      }"
                      class="w-full"
                      @update:model-value="
                        (product) => pickProduct(row, product)
                      "
                    />
                  </UFormField>
                  <p class="mt-1 text-xs text-amber-800">
                    لم يُعثر على معرّف الصنف. اختر صنفًا موجودًا يدويًا؛ لن يُفترض صنف أو معامل وحدة تلقائيًا.
                  </p>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <UFormField :label="`الكمية (${row.unitName || row.requestedUnitName || 'الوحدة'})`"
                    ><UInputNumber
                      v-model="row.quantity"
                      :min="0.0001"
                      :step="selectedUnit(row)?.allows_fractional ? 0.0001 : 1"
                      class="w-full"
                  /></UFormField>
                  <UFormField :label="`تكلفة ${row.unitName || row.requestedUnitName || 'الوحدة'}`"
                    ><UInputNumber
                      v-model="row.unitCost"
                      :min="0"
                      :step="0.0001"
                      class="w-full"
                  /></UFormField>
                </div>
                <UFormField
                  v-if="row.product && (unitChoices(row).length > 1 || !selectedUnit(row))"
                  label="وحدة الكمية والتكلفة"
                  ><USelectMenu
                    :model-value="selectedUnit(row)"
                    :items="unitChoices(row)"
                    label-key="name"
                    by="id"
                    :search-input="false"
                    class="w-full"
                    @update:model-value="(unit) => pickUnit(row, unit)"
                /></UFormField>
                <p v-if="row.product" class="text-xs text-gray-500">متوسط التكلفة المتوقع للصنف بعد دمج كل وحدات الشراء في الملف: {{ previewAverageLabel(row.product) }}</p>
                <ul
                  v-if="rowErrors(row).length"
                  class="list-inside list-disc text-xs text-red-700"
                >
                  <li v-for="error in rowErrors(row)" :key="error">
                    {{ error }}
                  </li>
                </ul>
              </UCard>
            </div>
          </div>
          <UAlert
            v-if="!errorCount"
            color="success"
            variant="soft"
            icon="i-lucide-circle-check"
            title="كل الصفوف سليمة وجاهزة — أكّد الفاتورة مباشرة."
          />
          <div
            class="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 text-xs"
          >
            <div
              v-for="row in rows"
              :key="row.rowNumber"
              class="flex flex-wrap justify-between gap-2 border-b border-gray-100 py-1 last:border-0"
            >
              <span
                >{{ row.name }} · {{ row.quantity ?? "—" }}
                {{ row.unitName || row.requestedUnitName }} ×
                {{ formatePrice(row.unitCost) }} ج</span>
              <span
                :class="
                  rowErrors(row).length ? 'text-red-600' : 'text-emerald-700'
                "
                >{{ rowErrors(row).length ? "يحتاج مراجعة" : "جاهز" }}</span
              >
            </div>
          </div>
          <div
            class="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-2"
          >
            <div class="space-y-1 text-sm">
              <div class="flex justify-between gap-2">
                <span>إجمالي الفاتورة</span><b>{{ formatePrice(total) }} ج</b>
              </div>
              <div class="flex justify-between gap-2">
                <span>رصيد الخزنة</span><b>{{ formatePrice(cashBalance) }} ج</b>
              </div>
              <div class="flex justify-between gap-2">
                <span>الباقي المستحق</span
                ><b class="text-amber-700">{{ formatePrice(remaining) }} ج</b>
              </div>
              <div
                v-if="paidNow > total"
                class="flex justify-between gap-2 text-blue-700"
              >
                <span>سلفة مستحقة لنا</span
                ><b>{{ formatePrice(paidNow - total) }} ج</b>
              </div>
            </div>
            <UFormField label="المدفوع الآن" :error="paidError || undefined"
              ><UInputNumber
                v-model="paidNow"
                :min="0"
                :max="cashBalance"
                :step="0.01"
                class="w-full"
            /></UFormField>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <UFormField label="المورد">
              <USelectMenu
                :model-value="(supplier ?? null) as Supplier | undefined"
                :items="supplierMenuItems"
                label-key="name"
                by="id"
                placeholder="اختر المورد"
                :search-input="{
                  placeholder: 'بحث عن مورد...',
                  icon: 'i-lucide-search',
                }"
                class="w-full"
                @update:model-value="(s) => onPickSupplier(s)"
              />
              <FormsSupplier
                v-model="showSupplierModal"
                :refresher="reloadSuppliers"
                @done="onSupplierCreated"
              />
            </UFormField>
            <UFormField label="مرجع فاتورة المورد (اختياري)"
              ><UInput v-model="supplierRef" dir="ltr" class="w-full"
            /></UFormField>
          </div>
          <UFormField label="ملاحظة (اختياري)"
            ><UInput v-model="note" class="w-full"
          /></UFormField>
          <div
            v-if="busy"
            class="overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-4"
          >
            <div class="flex items-center gap-3">
              <span
                class="relative flex size-11 shrink-0 items-center justify-center"
              >
                <span
                  class="absolute inset-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600"
                ></span>
                <UIcon
                  name="i-lucide-package-plus"
                  class="size-5 text-emerald-700"
                />
              </span>
              <div class="min-w-0">
                <div class="font-bold text-gray-900">{{ stageTitle }}</div>
                <div v-if="stageSubtitle" class="text-xs text-gray-500">
                  {{ stageSubtitle }}
                </div>
              </div>
            </div>
            <UProgress :value="stagePct" class="mt-3" />
            <ul class="mt-3 space-y-1.5 text-xs">
              <li
                v-for="(step, i) in stageSteps"
                :key="step"
                class="flex items-center gap-2"
                :class="
                  i < stageIndex
                    ? 'text-emerald-700'
                    : i === stageIndex
                      ? 'font-bold text-gray-900'
                      : 'text-gray-400'
                "
              >
                <UIcon
                  :name="
                    i < stageIndex
                      ? 'i-lucide-circle-check'
                      : i === stageIndex
                        ? 'i-lucide-loader-circle'
                        : 'i-lucide-circle'
                  "
                  :class="[
                    'size-4 shrink-0',
                    i === stageIndex && 'animate-spin',
                  ]"
                />
                {{ step }}
              </li>
            </ul>
          </div>
        </template>
      </template>
      <template v-else>
        <UAlert
          :color="result.remaining > 0 ? 'warning' : 'success'"
          variant="soft"
          :icon="
            result.remaining > 0 ? 'i-lucide-clock-3' : 'i-lucide-circle-check'
          "
          :title="
            result.duplicate
              ? 'هذه الفاتورة نُفذت مسبقًا ولم تُكرر.'
              : result.remaining > 0
                ? 'تم الشراء وبقي مبلغ مستحق للمورد.'
                : 'تم الشراء مدفوعًا بالكامل.'
          "
        />
        <div class="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <div class="flex justify-between">
            <span>الإجمالي</span><b>{{ formatePrice(result.total) }} ج</b>
          </div>
          <div class="flex justify-between">
            <span>المدفوع للفاتورة</span
            ><b>{{ formatePrice(result.paid) }} ج</b>
          </div>
          <div v-if="result.advance" class="flex justify-between">
            <span>الخارج من الخزنة</span
            ><b>{{ formatePrice(result.paid + result.advance) }} ج</b>
          </div>
          <div class="flex justify-between">
            <span>الباقي</span><b>{{ formatePrice(result.remaining) }} ج</b>
          </div>
          <div v-if="result.advance" class="flex justify-between text-blue-700">
            <span>سلفة مستحقة لنا</span
            ><b>{{ formatePrice(result.advance) }} ج</b>
          </div>
        </div>
        <div class="break-all text-xs text-gray-500">فاتورة الشراء:</div>
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="id in result.ids"
            :key="id"
            color="warning"
            variant="soft"
            size="sm"
            icon="i-lucide-arrow-up-right"
            @click="
              navigateTo({ path: '/supplier-invoices', query: { invoice: id } })
            "
            >عرض {{ id.slice(0, 6) }}</UButton
          >
        </div>
      </template>
      <UAlert
        v-if="submitError"
        color="error"
        variant="soft"
        :title="submitError"
      />
    </div>
    <template #footer>
      <div class="flex w-full flex-col gap-2 sm:flex-row">
        <UButton
          v-if="!result"
          color="success"
          class="min-h-11 flex-1"
          icon="i-lucide-package-plus"
          :loading="busy"
          :disabled="!canSubmit"
          @click="submit"
          >تأكيد الفاتورة</UButton
        >
        <UButton v-else color="success" class="min-h-11 flex-1" @click="close"
          >تم</UButton
        >
        <UButton
          color="neutral"
          variant="soft"
          class="min-h-11 flex-1"
          :disabled="busy"
          @click="close"
          >{{ result ? "إغلاق" : "إلغاء" }}</UButton
        >
      </div>
    </template>
  </UiAppDialog>
</template>

<script setup lang="ts">
import type { Product } from "~/types";
import type { ProductUnit } from "~/types";
import type { Supplier } from "~/types/finance";
import { useSuppliersStore } from "~/stores/suppliers";
import type { PriceDecision } from "~/composables/finance";

interface ImportRow {
  rowNumber: number;
  productId: string;
  name: string;
  quantity: number | null;
  unitCost: number | null;
  product?: Product;
  unitId?: string;
  unitName?: string;
  unitFactor: number;
  requestedUnitName: string;
  requestedUnitId: string;
  unitIssue: string;
}
interface ImportResult {
  ids: string[];
  total: number;
  paid: number;
  remaining: number;
  advance: number;
  duplicate: boolean;
}

const props = defineProps<{ products: Product[]; cashBalance: number }>();
const emit = defineEmits<{ done: [] }>();
const open = defineModel<boolean>("open", { required: true });
const {
  round2,
  round4,
  toNum,
  purchaseLineBaseQuantity,
  purchasableUnitsForProduct,
  purchasePreviewAverage,
  MAX_PURCHASE_ITEMS: maxItems,
} = useFinance();
const formatePrice = useHelpers().formatePrice;
const purchasing = usePurchasing();
const productsStore = useProductsStore();
const cashbox = useCashbox();
const supplierStore = useSuppliersStore();
const supplier = ref<Supplier | undefined>();
const CREATE_SUPPLIER_ID = "__create__";
const showSupplierModal = ref(false);
const supplierMenuItems = computed<Supplier[]>(() => [
  { id: CREATE_SUPPLIER_ID, name: "+ إضافة مورد جديد" } as Supplier,
  ...supplierStore.list,
]);
function onPickSupplier(s: Supplier | null | undefined): void {
  if (!s) {
    supplier.value = undefined;
    return;
  }
  if (s.id === CREATE_SUPPLIER_ID) {
    showSupplierModal.value = true;
    return;
  }
  supplier.value = suppliersReal(s);
}
function suppliersReal(s: Supplier): Supplier {
  return supplierStore.list.find((item) => item.id === s.id) ?? s;
}
async function reloadSuppliers(): Promise<void> {
  await supplierStore.fetchSuppliers(true);
}
function onSupplierCreated(s: Supplier | null | undefined): void {
  if (s?.id) supplier.value = suppliersReal(s);
}
const rows = ref<ImportRow[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileName = ref("");
const selectedFileSize = ref("");
const fileError = ref("");
const parseError = ref("");
const submitError = ref("");
const busy = ref(false);
const fileHash = ref("");
const paidNow = ref(0);
const supplierRef = ref("");
const note = ref("");
const result = ref<ImportResult | null>(null);
// Staged modern loader for the import run (steps + progress).
const stageSteps = ref<string[]>([]);
const stageIndex = ref(0);
const stagePct = ref(0);
const stageTitle = ref("");
const stageSubtitle = ref("");
const productsById = computed(
  () => new Map(props.products.map((product) => [product.id, product])),
);
const total = computed(() =>
  round2(
    rows.value.reduce(
      (sum, row) =>
        sum + round2(toNum(row.quantity) * round4(toNum(row.unitCost))),
      0,
    ),
  ),
);
const remaining = computed(() =>
  Math.max(0, round2(total.value - toNum(paidNow.value))),
);
const paidError = computed(() =>
  paidNow.value < 0 || paidNow.value - props.cashBalance > 1e-9
    ? "المدفوع يجب ألا يتجاوز رصيد الخزنة."
    : paidNow.value > total.value && !supplier.value?.id
      ? "اختر المورد لتسجيل الزيادة كسلفة."
      : "",
);
const problemRows = computed(() => rows.value.filter((row) => rowErrors(row).length > 0));
const canSubmit = computed(
  () =>
    !!fileHash.value &&
    !!supplier.value?.id &&
    rows.value.length > 0 &&
    !busy.value &&
    !errorCount.value &&
    !paidError.value,
);
function rowDuplicateKey(row: ImportRow): string {
  return row.product?.id
    ? `id:${row.product.id}|${row.unitId ?? ""}`
    : `new:${row.name.trim().toLocaleLowerCase()}`;
}
const matchedCount = computed(
  () => rows.value.filter((row) => !!row.product).length,
);
const errorCount = computed(
  () => rows.value.filter((row) => rowErrors(row).length > 0).length,
);

function numericCell(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    String(value).trim() === ""
  )
    return null;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).trim().replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Exported order rows write the name as `Product (Unit)`; split it back so
 *  the unit hint survives even when the unit column is left empty, and so
 *  new-product names never keep the parenthetical. */
function splitDisplayName(rawName: string): {
  base: string;
  parenUnit: string;
} {
  const match = rawName.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { base: rawName.trim(), parenUnit: "" };
  return {
    base: (match[1] ?? "").trim() || rawName.trim(),
    parenUnit: (match[2] ?? "").trim(),
  };
}

interface ExtraColumns {
  unit: number;
  unitId: number;
}

function makeRow(
  raw: unknown[],
  rowNumber: number,
  extra: ExtraColumns = { unit: -1, unitId: -1 },
): ImportRow {
  const productId = String(raw[0] ?? "").trim();
  const { base: parsedName, parenUnit } = splitDisplayName(
    String(raw[1] ?? "").trim(),
  );
  const name = parsedName;
  const existing = productId ? productsById.value.get(productId) : undefined;
  const requestedUnitName =
    (extra.unit >= 0 ? String(raw[extra.unit] ?? "").trim() : "") || parenUnit;
  const requestedUnitId = extra.unitId >= 0 ? String(raw[extra.unitId] ?? "").trim() : "";
  const choices = existing ? purchasableUnitsForProduct(existing) : [];
  const matches = requestedUnitId
    ? choices.filter((unit) => unit.id === requestedUnitId)
    : requestedUnitName
    ? choices.filter((unit) => unit.name.trim() === requestedUnitName)
    : [];
  const selected = matches.length === 1 ? matches[0] : undefined;
  const factor = selected && Number(selected.factor) > 0 ? Number(selected.factor) : 0;
  return {
    rowNumber,
    productId,
    name: existing?.name ?? name,
    quantity: numericCell(raw[2]),
    unitCost: numericCell(raw[3]),
    product: existing,
    unitId: selected?.id,
    unitName:
      selected?.name ??
      requestedUnitName,
    unitFactor: factor,
    requestedUnitName,
    requestedUnitId,
    unitIssue:
      existing && !choices.length ? "لا توجد وحدات شراء متاحة لهذا الصنف." : existing && (!requestedUnitId && !requestedUnitName)
        ? "معرّف الوحدة أو اسم وحدة معروف مطلوب؛ لن يُفترض المعامل 1."
        : existing && matches.length !== 1
          ? "معرّف الوحدة أو اسمها غير معروف لهذا الصنف؛ اختر وحدة شراء صحيحة."
        : "",
  };
}

function pickProduct(
  row: ImportRow,
  product: Product | null | undefined,
): void {
  if (!product?.id) return;
  row.product = product;
  row.productId = product.id;
  row.name = product.name;
  const matches = row.requestedUnitName
    ? purchasableUnitsForProduct(product).filter(
        (unit) => unit.name.trim() === row.requestedUnitName,
      )
    : [];
  const selected = (row.requestedUnitId ? purchasableUnitsForProduct(product).find((unit) => unit.id === row.requestedUnitId) : undefined) ?? (matches.length === 1 ? matches[0] : undefined);
  row.unitId = selected?.id;
  row.requestedUnitId = selected?.id ?? "";
  row.unitName = selected?.name ?? row.requestedUnitName;
  row.unitFactor = selected ? Number(selected.factor) : 0;
  row.unitIssue = selected ? "" : "اختر وحدة شراء متاحة لهذا الصنف.";
}

function unitChoices(row: ImportRow): ProductUnit[] {
  const product = currentProduct(row);
  if (!product) return [];
  return purchasableUnitsForProduct(product);
}
function selectedUnit(row: ImportRow): ProductUnit | undefined {
  return unitChoices(row).find((unit) => unit.id === row.unitId);
}
function pickUnit(row: ImportRow, unit?: ProductUnit): void {
  if (!unit) return;
  row.unitId = unit.id;
  row.requestedUnitId = unit.id;
  row.unitName = unit.name;
  row.unitFactor = Number(unit.factor);
  row.unitIssue = "";
}

async function onFile(event: Event): Promise<void> {
  rows.value = [];
  result.value = null;
  fileHash.value = "";
  parseError.value = "";
  fileError.value = "";
  submitError.value = "";
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  selectedFileName.value = file.name;
  selectedFileSize.value =
    file.size < 1024 * 1024
      ? `${Math.max(1, Math.round(file.size / 1024))} كيلوبايت`
      : `${(file.size / (1024 * 1024)).toFixed(1)} ميجابايت`;
  if (
    !file.name.toLowerCase().endsWith(".xlsx") ||
    file.size > 10 * 1024 * 1024
  ) {
    fileError.value = "اختر ملف .xlsx لا يتجاوز حجمه 10 ميجابايت.";
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const XLSX = await import("xlsx/dist/xlsx.full.min.js");
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    if (!sheet) throw new Error("الملف لا يحتوي على ورقة عمل.");
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    });
    const baseHeaders = [
      "رقم المنتج",
      "اسم المنتج",
      "الكمية المطلوبة",
      "تكلفة شراء الوحدة",
    ];
    if (
      data.length < 2 ||
      baseHeaders.some(
        (header, index) => String(data[0]?.[index] ?? "").trim() !== header,
      )
    ) {
      throw new Error(`يجب أن تبدأ الأعمدة بـ: ${baseHeaders.join("، ")}.`);
    }
    const extra: ExtraColumns = { unit: -1, unitId: -1 };
    (data[0] ?? []).forEach((cell, index) => {
      if (index < 4) return;
      const title = String(cell ?? "").trim();
      if (title === "نوع الوحدة" && extra.unit < 0) extra.unit = index;
      if (title === "معرّف وحدة الشراء" && extra.unitId < 0) extra.unitId = index;
    });
    const parsedRows = data
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter(({ row }) => {
        const productId = String(row[0] ?? "").trim();
        const name = String(row[1] ?? "").trim();
        return (productId !== "" || name !== "") && (productId !== "" || name !== "الإجمالي");
      })
      .map(({ row, rowNumber }) => makeRow(row, rowNumber, extra));
    if (!parsedRows.length) throw new Error("لا توجد صفوف أصناف في الملف.");
    if (parsedRows.length > maxItems)
      throw new Error(
        `الحد الأقصى للملف ${maxItems} أصناف حتى تُحفظ فاتورة المورد كاملة مرة واحدة.`,
      );
    rows.value = parsedRows;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    fileHash.value = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    await cashbox.fetchCashbox();
    paidNow.value = Math.min(total.value, cashbox.balance);
  } catch (error) {
    parseError.value =
      error instanceof Error ? error.message : "تعذر قراءة الملف.";
    rows.value = [];
  }
}

function currentProduct(row: ImportRow): Product | undefined {
  return row.product?.id
    ? (productsById.value.get(row.product.id) ?? row.product)
    : undefined;
}
function rowErrors(row: ImportRow): string[] {
  const errors: string[] = [];
  if (row.unitIssue) errors.push(row.unitIssue);
  if (!row.product) errors.push("اختر صنفًا مخزنيًا موجودًا قبل تأكيد الشراء.");
  if (row.product && (!selectedUnit(row) || !row.unitId || !(row.unitFactor > 0))) errors.push("اختر وحدة شراء متاحة ومعرّفها معروف.");
  if (
    rows.value.some(
      (other) =>
        other !== row && rowDuplicateKey(other) === rowDuplicateKey(row),
    )
  )
    errors.push("صف مكرر لنفس المنتج ونفس الوحدة.");
  if (
    !(
      row.quantity !== null &&
      Number.isFinite(row.quantity) &&
      row.quantity > 0
    )
  )
    errors.push("أدخل كمية موجبة وصالحة.");
  else if (selectedUnit(row)?.allows_fractional !== true && !Number.isInteger(row.quantity))
    errors.push("الكمية يجب أن تكون رقمًا صحيحًا.");
  else if (Math.abs(row.quantity - round4(row.quantity)) > 1e-9)
    errors.push("الكمية تقبل أربع منازل عشرية كحد أقصى.");
  else if (selectedUnit(row)) {
    try { purchaseLineBaseQuantity(row.quantity, selectedUnit(row)!.factor); }
    catch { errors.push("الكمية بعد التحويل يجب أن تكون موجبة وقابلة للتمثيل حتى أربع منازل عشرية."); }
  }
  if (
    !(
      row.unitCost !== null &&
      Number.isFinite(row.unitCost) &&
      row.unitCost >= 0
    )
  )
    errors.push("أدخل تكلفة وحدة غير سالبة وصالحة.");
  return errors;
}

function previewAverageLabel(product: Product): string {
  const lines = rows.value.filter((row) => row.product?.id === product.id);
  let addedQuantity = 0;
  let addedValue = 0;
  for (const row of lines) {
    const unit = selectedUnit(row);
    if (!unit || !(Number(unit.factor) > 0) || !(Number(row.quantity) > 0) || !Number.isFinite(Number(row.unitCost))) return "أكمل الكمية والتكلفة";
    try { addedQuantity = round4(addedQuantity + purchaseLineBaseQuantity(Number(row.quantity), unit.factor)); }
    catch { return "الكمية بعد التحويل غير صالحة"; }
    addedValue += round2(Number(row.quantity) * Number(row.unitCost));
  }
  if (!(addedQuantity > 0)) return "—";
  const currentQuantity = toNum(product.stock_quantity);
  const average = purchasePreviewAverage(currentQuantity, product.cost_price, addedQuantity, addedValue / addedQuantity);
  return `${round4(average)} ${product.base_unit_name || "للوحدة الأساسية"}`;
}
async function submit(): Promise<void> {
  submitError.value = "";
  if (!canSubmit.value) return;
  busy.value = true;
  stageSteps.value = [];
  stageIndex.value = 0;
  stagePct.value = 0;
  stageTitle.value = "";
  stageSubtitle.value = "";
  try {
    const items = rows.value.map((row) => {
      const product = row.product!;
      const pricing: PriceDecision = { mode: "auto", averageBasis: { stock: round4(toNum(product.stock_quantity)), cost: round4(toNum(product.cost_price)) } };
      const f = Number(row.unitFactor);
      return {
        product_id: product.id,
        name: row.name,
        quantity: row.quantity ?? 0,
        unit_cost: row.unitCost ?? 0,
        pricing,
        unit_id: row.unitId,
        unit_name: row.unitName,
        unit_factor: f,
      };
    });
    if (items.length > maxItems) {
      submitError.value = `الحد الأقصى للفاتورة ${maxItems} أصناف. قلّل الصفوف ثم أعد رفع الملف.`;
      return;
    }
    stageSteps.value = [
      "فحص المنتجات",
      `إضافة الكميات للأصناف الموجودة (${rows.value.length})`,
      "حفظ فاتورة المورد",
      "تحديث الأرصدة",
    ];
    stageIndex.value = 0;
    stageTitle.value = "جاري فحص المنتجات…";
    stageSubtitle.value = `${rows.value.length} صنفًا`;
    await nextTick();
    stageIndex.value = stageSteps.value.length - 2;
    stageTitle.value = "جاري حفظ فاتورة المورد…";
    stageSubtitle.value = `${items.length} صنفًا · ${formatePrice(total.value)} ج`;
    const intent = JSON.stringify({ file: fileHash.value, items, supplier: supplier.value?.id, paid: paidNow.value, reference: supplierRef.value.trim(), note: note.value.trim() });
    const intentDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(intent));
    const operationKey = [...new Uint8Array(intentDigest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    const execution = await purchasing.executePurchase({
      idempotencyKey: `import-${operationKey}`,
      supplier_id: supplier.value?.id ?? null,
      supplier_name: supplier.value?.name ?? null,
      supplier_ref: supplierRef.value.trim() || null,
      source: "excel_import",
      items,
      paidNow: round2(toNum(paidNow.value)),
      note: note.value.trim() || `استيراد ${rows.value.length} صنفًا من Excel`,
    });
    if (!execution.ok) {
      submitError.value = execution.error ?? "تعذر تنفيذ الاستيراد.";
      if (execution.stale) {
        await productsStore.fetchProducts();
        submitError.value = `${submitError.value} تم تحديث بيانات المنتجات؛ راجع الأصناف ثم أكد مرة أخرى.`;
      }
      return;
    }
    stageIndex.value = stageSteps.value.length - 1;
    stageTitle.value = "جاري تحديث الأرصدة…";
    stageSubtitle.value = "";
    await cashbox.fetchCashbox();
    const purchaseResult: ImportResult = {
      ids: execution.id ? [execution.id] : [],
      total: execution.total ?? total.value,
      paid: execution.paid ?? round2(toNum(paidNow.value)),
      remaining:
        execution.remaining ?? round2(total.value - toNum(paidNow.value)),
      advance: execution.advance ?? 0,
      duplicate: !!execution.duplicate,
    };
    result.value = purchaseResult;
    emit("done");
  } catch (error) {
    submitError.value =
      error instanceof Error ? error.message : "تعذر تنفيذ الاستيراد.";
  } finally {
    busy.value = false;
  }
}

function close(): void {
  if (busy.value) return;
  open.value = false;
  if (result.value) {
    rows.value = [];
    result.value = null;
    fileHash.value = "";
  }
}

watch(open, (value) => {
  if (value) {
    result.value = null;
    submitError.value = "";
    void cashbox.fetchCashbox();
    void supplierStore.fetchSuppliers();
  }
});
</script>
