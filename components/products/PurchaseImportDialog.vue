<template>
  <UiAppDialog v-model:open="open" title="استيراد كميات ومنتجات">
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
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <UCard variant="outline"
              ><div class="text-lg font-bold">{{ rows.length }}</div>
              <div class="text-xs text-gray-500">صفوف الملف</div></UCard
            >
            <UCard variant="outline"
              ><div class="text-lg font-bold">{{ matchedCount }}</div>
              <div class="text-xs text-gray-500">منتجات موجودة</div></UCard
            >
            <UCard variant="outline"
              ><div class="text-lg font-bold">{{ newCount }}</div>
              <div class="text-xs text-gray-500">
                منتجات جديدة مختارة
              </div></UCard
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
              صفوف تحتاج مراجعة ({{ problemRows.length }}) — لن تُحفظ أي بيانات
              قبل حل جميع الأخطاء والتأكيد
            </p>
            <div
              class="max-h-[38vh] space-y-2 overflow-y-auto overscroll-contain pe-1"
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
                      row.product
                        ? 'success'
                        : row.createNew
                          ? 'info'
                          : 'warning'
                    "
                    variant="soft"
                  >
                    {{
                      row.product
                        ? "منتج موجود"
                        : row.createNew
                          ? "إنشاء منتج جديد"
                          : "يحتاج قرارًا"
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
                  <UCheckbox
                    v-model="row.createNew"
                    label="إنشاء منتج جديد بهذا الاسم"
                  />
                  <p class="mt-1 text-xs text-amber-800">
                    لم يُعثر على المعرّف؛ لن تتم مطابقة الاسم تلقائيًا. سيُنشأ
                    منتج جديد بمعرّف Firestore جديد.
                  </p>
                  <UFormField
                    v-if="row.createNew"
                    label="اسم المنتج الجديد"
                    required
                    class="mt-2"
                  >
                    <UInput v-model="row.name" class="w-full" />
                  </UFormField>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <UFormField :label="`الكمية (${row.unitName || 'وحدة'})`"
                    ><UInputNumber
                      v-model="row.quantity"
                      :min="1"
                      :step="1"
                      class="w-full"
                  /></UFormField>
                  <UFormField :label="`تكلفة ${row.unitName || 'الوحدة'}`"
                    ><UInputNumber
                      v-model="row.unitCost"
                      :min="0"
                      :step="0.0001"
                      class="w-full"
                  /></UFormField>
                </div>
                <UFormField
                  v-if="row.product && unitChoices(row).length > 1"
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
                <template v-if="row.createNew">
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <UFormField label="سعر البيع للمنتج الجديد" required
                      ><UInputNumber
                        v-model="row.newPrice"
                        :min="0.01"
                        :step="0.01"
                        class="w-full"
                    /></UFormField>
                    <UFormField
                      label="مؤشر النقص (للوحدة الأساسية)"
                      hint="الافتراضي 5"
                      ><UInputNumber
                        v-model="row.threshold"
                        :min="0"
                        :step="1"
                        class="w-full"
                    /></UFormField>
                    <UFormField label="وحدة المخزون الأساسية" required
                      ><UInput
                        v-model="row.baseUnitName"
                        placeholder="مثال: قطعة أو جرام"
                        class="w-full"
                    /></UFormField>
                  </div>
                </template>
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
            v-else
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
                {{ row.unitName || row.baseUnitName }} ×
                {{ formatePrice(row.unitCost) }} ج<template
                  v-if="
                    row.avgOverride !== null && row.avgOverride !== undefined
                  "
                >
                  · متوسط {{ formatePrice(row.avgOverride) }}</template
                ><template
                  v-if="
                    row.priceOverride !== null &&
                    row.priceOverride !== undefined
                  "
                >
                  · بيع {{ formatePrice(row.priceOverride) }}</template
                ></span
              >
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
  createNew: boolean;
  newPrice: number | null;
  threshold: number | null;
  /** Optional per-row numbers from the new export columns (unit terms):
   *  null = not provided → computed defaults apply. */
  avgOverride: number | null;
  priceOverride: number | null;
  baseUnitName: string;
  unitId?: string;
  unitName?: string;
  unitFactor: number;
  requestedUnitName: string;
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
  proposedSellingPrice,
  purchasableUnitsForProduct,
  purchaseLineBaseQuantity,
  purchaseLineBaseCost,
  purchasePreviewAverage,
  manualPriceBaseOf,
  siblingRowConflict,
  convertUnitPrice,
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
const problemRows = computed(() =>
  rows.value.filter((row) => rowErrors(row).length > 0),
);
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
    ? `id:${row.product.id}|${row.unitId ?? ""}|${Number(row.unitFactor || 1)}`
    : `new:${row.name.trim().toLocaleLowerCase()}`;
}
const matchedCount = computed(
  () => rows.value.filter((row) => !!row.product).length,
);
const newCount = computed(
  () => rows.value.filter((row) => !row.product && row.createNew).length,
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
  avg: number;
  price: number;
}

function makeRow(
  raw: unknown[],
  rowNumber: number,
  extra: ExtraColumns = { unit: 4, avg: -1, price: -1 },
): ImportRow {
  const productId = String(raw[0] ?? "").trim();
  const { base: parsedName, parenUnit } = splitDisplayName(
    String(raw[1] ?? "").trim(),
  );
  const name = parsedName;
  const existing = productId ? productsById.value.get(productId) : undefined;
  const requestedUnitName =
    (extra.unit >= 0 ? String(raw[extra.unit] ?? "").trim() : "") || parenUnit;
  const choices = existing ? purchasableUnitsForProduct(existing) : [];
  const base = choices.find((unit) => unit.is_base) ?? choices[0];
  const matches = requestedUnitName
    ? choices.filter((unit) => unit.name.trim() === requestedUnitName)
    : [];
  const selected = requestedUnitName ? matches[0] : base;
  return {
    rowNumber,
    productId,
    name: existing?.name ?? name,
    quantity: numericCell(raw[2]),
    unitCost: numericCell(raw[3]),
    product: existing,
    createNew: false,
    newPrice: null,
    threshold: 5,
    avgOverride: extra.avg >= 0 ? numericCell(raw[extra.avg]) : null,
    priceOverride: extra.price >= 0 ? numericCell(raw[extra.price]) : null,
    baseUnitName: !existing && requestedUnitName ? requestedUnitName : "وحدة",
    unitId: selected?.id ?? existing?.base_unit_id ?? "legacy-base",
    unitName:
      selected?.name ??
      (requestedUnitName || existing?.base_unit_name || "وحدة"),
    unitFactor: selected?.factor ?? 1,
    requestedUnitName,
    unitIssue:
      existing && requestedUnitName && matches.length !== 1
        ? "نوع الوحدة غير موجود أو مكرر لهذا المنتج؛ اختر وحدة شراء صحيحة."
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
  row.createNew = false;
  const base = purchasableUnitsForProduct(product).find(
    (unit) => unit.is_base,
  ) ??
    purchasableUnitsForProduct(product)[0] ?? {
      id: product.base_unit_id || "legacy-base",
      name: product.base_unit_name || "وحدة",
      factor: 1,
      selling_price: product.price,
      is_base: true,
    };
  const matches = row.requestedUnitName
    ? purchasableUnitsForProduct(product).filter(
        (unit) => unit.name.trim() === row.requestedUnitName,
      )
    : [];
  const selected = matches.length === 1 ? matches[0]! : base;
  row.unitId = selected.id;
  row.unitName = selected.name;
  row.unitFactor = selected.factor;
  row.unitIssue =
    row.requestedUnitName && matches.length !== 1
      ? "نوع الوحدة غير موجود أو مكرر لهذا المنتج؛ اختر وحدة شراء صحيحة."
      : "";
}

function unitChoices(row: ImportRow): ProductUnit[] {
  const product = currentProduct(row);
  if (!product) return [];
  return purchasableUnitsForProduct(product);
}
function selectedUnit(row: ImportRow): ProductUnit | undefined {
  return (
    unitChoices(row).find((unit) => unit.id === row.unitId) ??
    unitChoices(row)[0]
  );
}
function pickUnit(row: ImportRow, unit?: ProductUnit): void {
  if (!unit) return;
  row.unitCost =
    row.unitCost === null
      ? null
      : convertUnitPrice(row.unitCost, row.unitFactor, unit.factor);
  row.avgOverride =
    row.avgOverride === null
      ? null
      : convertUnitPrice(row.avgOverride, row.unitFactor, unit.factor);
  row.priceOverride =
    row.priceOverride === null
      ? null
      : convertUnitPrice(row.priceOverride, row.unitFactor, unit.factor);
  row.unitId = unit.id;
  row.unitName = unit.name;
  row.unitFactor = unit.factor;
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
    // Optional columns (legacy unit column + the two new computed columns)
    // may follow in any order; the new export writes avg then price.
    const extra: ExtraColumns = { unit: -1, avg: -1, price: -1 };
    (data[0] ?? []).forEach((cell, index) => {
      if (index < 4) return;
      const title = String(cell ?? "").trim();
      if (title === "نوع الوحدة" && extra.unit < 0) extra.unit = index;
      else if (title === "متوسط سعر التكلفة الجديد" && extra.avg < 0)
        extra.avg = index;
      else if (title === "سعر البيع الجديد" && extra.price < 0)
        extra.price = index;
    });
    if (
      extra.unit < 0 &&
      extra.avg < 0 &&
      extra.price < 0 &&
      (data[0] ?? []).length > 4
    )
      extra.unit = 4;
    const parsedRows = data
      .slice(1)
      .filter(
        (row) =>
          row.some((cell) => String(cell ?? "").trim() !== "") &&
          String(row[1] ?? "").trim() !== "الإجمالي",
      )
      .map((row, index) => makeRow(row, index + 2, extra));
    if (!parsedRows.length) throw new Error("لا توجد صفوف أصناف في الملف.");
    if (parsedRows.length > maxItems)
      throw new Error(
        `الحد الأقصى للملف ${maxItems} أصناف حتى تُحفظ فاتورة المورد كاملة مرة واحدة.`,
      );
    rows.value = parsedRows;
    // Unmatched rows default to new-product creation (the user unchecks +
    // picks manually when it was just a mismatch); their missing fields
    // surface in the compact review section.
    for (const row of parsedRows) {
      if (!row.product) row.createNew = true;
    }
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
/** Sibling-row check delegated to the pure, unit-tested siblingRowConflict. */
function rowGroupConflict(row: ImportRow): string | null {
  if (!row.product?.id) return null;
  const product = currentProduct(row);
  if (!product) return null;
  const siblings = rows.value.filter(
    (other) => other.product?.id === row.product!.id,
  );
  return siblingRowConflict(product, row, siblings);
}
function rowErrors(row: ImportRow): string[] {
  const errors: string[] = [];
  if (row.unitIssue) errors.push(row.unitIssue);
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
  else if (!Number.isInteger(row.quantity))
    errors.push("الكمية يجب أن تكون رقمًا صحيحًا.");
  if (
    !(
      row.unitCost !== null &&
      Number.isFinite(row.unitCost) &&
      row.unitCost >= 0
    )
  )
    errors.push("أدخل تكلفة وحدة غير سالبة وصالحة.");
  if (
    row.avgOverride !== null &&
    row.avgOverride !== undefined &&
    (!Number.isFinite(row.avgOverride) || row.avgOverride < 0)
  )
    errors.push("متوسط التكلفة الجديد غير صالح.");
  if (
    row.priceOverride !== null &&
    row.priceOverride !== undefined &&
    (!Number.isFinite(row.priceOverride) || row.priceOverride < 0)
  )
    errors.push("سعر البيع الجديد غير صالح.");
  const conflict = rowGroupConflict(row);
  if (conflict) errors.push(conflict);
  if (!row.product && !row.createNew)
    errors.push("اختر إنشاء منتج جديد بعد مراجعة الاسم.");
  if (!row.name.trim()) errors.push("اسم المنتج مطلوب.");
  if (!row.product && row.createNew) {
    if (
      !(
        row.newPrice !== null &&
        Number.isFinite(row.newPrice) &&
        row.newPrice > 0
      )
    )
      errors.push("سعر البيع للمنتج الجديد مطلوب.");
    if (
      row.threshold === null ||
      !Number.isFinite(row.threshold) ||
      row.threshold < 0
    )
      errors.push("مؤشر النقص يجب ألا يكون سالبًا.");
    if (!row.baseUnitName.trim())
      errors.push("اسم وحدة المخزون الأساسية مطلوب.");
  }
  return errors;
}
/** One pricing decision per existing product (shared by all its rows so the
 *  transaction's uniformity rule holds): file numbers win when they genuinely
 *  differ from recorded (stale cached values are recomputed instead),
 *  otherwise the same weighted/midpoint + margin defaults as quick-buy. */
function productPricingOf(
  product: Product,
  productRows: ImportRow[],
): PriceDecision {
  const stock = toNum(product.stock_quantity);
  const oldBase = toNum(product.cost_price);
  const basePrice = toNum(product.price);
  let totalBase = 0;
  let totalCostValue = 0;
  let firstAvg: number | null = null;
  let firstPrice: number | null = null;
  for (const row of productRows) {
    const factor = row.unitFactor || 1;
    const baseQty = purchaseLineBaseQuantity(row.quantity ?? 0, factor);
    const baseCost = purchaseLineBaseCost(row.unitCost ?? 0, factor);
    totalBase = round2(totalBase + baseQty);
    totalCostValue += baseQty * baseCost;
    // Per-row file averages are single-row estimates, never decisions: with
    // several rows for one product the approved average always aggregates
    // from all rows' quantities/costs (fallback below), so disagreeing
    // per-row values can never block the import. Single-row manual averages
    // are still honored.
    if (productRows.length < 2 && firstAvg === null && row.avgOverride != null) {
      const oldUnitAvg = round4(oldBase * factor);
      if (Math.abs(toNum(row.avgOverride) - oldUnitAvg) > 0.005)
        firstAvg = round4(toNum(row.avgOverride) / factor);
    }
    if (firstPrice === null && row.priceOverride != null) {
      // Export-fresh multi-row prices (each unit on the shared average by its
      // own margin) carry no decision — the base row (or file order without
      // one) decides, other units follow their margins in the transaction.
      const manual = manualPriceBaseOf(product, row, productRows.length);
      if (manual !== null) firstPrice = manual;
    }
  }
  const combined = totalBase > 0 ? totalCostValue / totalBase : 0;
  const differs = Math.abs(combined - oldBase) > 1e-9;
  const avgBase =
    firstAvg !== null
      ? firstAvg
      : stock > 0
        ? round4(purchasePreviewAverage(stock, oldBase, totalBase, combined))
        : oldBase > 0 && differs
          ? round4((oldBase + combined) / 2)
          : round4(combined);
  const override = {
    approvedAverage: avgBase,
    averageBasis: { stock: round2(stock), cost: round4(oldBase) },
  };
  const proposal = proposedSellingPrice(oldBase, basePrice, avgBase);
  if (firstPrice !== null)
    return {
      mode: "custom",
      price: firstPrice,
      approvedProposed: proposal.proposed,
      ...override,
    };
  if (proposal.proposed !== null && avgBase - basePrice > 1e-9)
    return {
      mode: "custom",
      price: proposal.proposed,
      approvedProposed: proposal.proposed,
      ...override,
    };
  if (avgBase - basePrice > 1e-9)
    return {
      mode: "custom",
      price: avgBase,
      approvedProposed: proposal.proposed,
      ...override,
    };
  return { mode: "keep", ...override };
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
    // One shared pricing decision per existing product (uniformity rule).
    const pricingByProduct = new Map<string, PriceDecision>();
    for (const row of rows.value) {
      const product = row.product?.id ? currentProduct(row) : undefined;
      if (!product?.id) continue;
      if (!pricingByProduct.has(product.id)) {
        pricingByProduct.set(
          product.id,
          productPricingOf(
            product,
            rows.value.filter((other) => other.product?.id === product.id),
          ),
        );
      }
    }
    const items = rows.value.map((row) => {
      const pricing: PriceDecision = row.product?.id
        ? (pricingByProduct.get(row.product.id) ?? { mode: "keep" })
        : { mode: "keep" };
      return {
        product_id: row.product?.id ?? null,
        name: row.name,
        quantity: row.quantity ?? 0,
        unit_cost: row.unitCost ?? 0,
        pricing,
        price: row.product ? undefined : row.newPrice,
        threshold: row.product ? undefined : row.threshold,
        unit_id: row.unitId,
        unit_name: row.unitName,
        unit_factor: row.unitFactor,
        base_unit_name: row.product ? undefined : row.baseUnitName,
        base_unit_id: row.product ? undefined : "base",
        units: row.product
          ? undefined
          : [
              {
                id: "base",
                name: row.baseUnitName,
                factor: 1,
                selling_price: row.newPrice,
                is_base: true,
                low_stock_threshold: row.threshold ?? 5,
              },
            ],
      };
    });
    if (items.length > maxItems) {
      submitError.value = `الحد الأقصى للفاتورة ${maxItems} أصناف. قلّل الصفوف ثم أعد رفع الملف.`;
      return;
    }
    const newTotal = rows.value.filter((row) => !row.product).length;
    const existingTotal = rows.value.length - newTotal;
    stageSteps.value = [
      "فحص المنتجات",
      `إضافة الكميات للمنتجات الموجودة (${existingTotal})`,
      ...(newTotal > 0 ? [`إنشاء المنتجات الجديدة (${newTotal})`] : []),
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
    const execution = await purchasing.executePurchase({
      idempotencyKey: `import-${fileHash.value}`,
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
