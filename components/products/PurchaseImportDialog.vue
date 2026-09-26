<template>
  <UiAppDialog v-model:open="open" title="استيراد كميات ومنتجات">
    <div class="space-y-4">
      <template v-if="!result">
        <UAlert color="info" variant="soft" icon="i-lucide-info" title="ارفع ملف .xlsx بالأعمدة: رقم المنتج، اسم المنتج، الكمية المطلوبة، تكلفة شراء الوحدة. لا يتغير المخزون قبل التأكيد." />
        <UFormField label="ملف طلب الشراء" :error="fileError || undefined">
          <div class="relative overflow-hidden rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 p-4 transition hover:border-emerald-500 hover:bg-emerald-50">
            <input ref="fileInput" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" :disabled="busy" @change="onFile" />
            <div class="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-start">
              <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100">
                <UIcon name="i-lucide-file-spreadsheet" class="size-6" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block break-all font-semibold text-gray-900">{{ selectedFileName || 'لم يتم اختيار ملف بعد' }}</span>
                <span class="mt-1 block text-xs text-gray-500">ملف .xlsx، حتى 10 ميجابايت</span>
                <span v-if="selectedFileSize" class="mt-1 block text-xs text-gray-500">حجم الملف: {{ selectedFileSize }}</span>
              </span>
              <span class="pointer-events-none inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm">
                <UIcon name="i-lucide-upload" class="size-4" />
                {{ selectedFileName ? 'استبدال الملف' : 'اختيار ملف' }}
              </span>
            </div>
          </div>
        </UFormField>
        <UAlert v-if="parseError" color="error" variant="soft" :title="parseError" />
        <template v-if="rows.length">
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <UCard variant="outline"><div class="text-lg font-bold">{{ rows.length }}</div><div class="text-xs text-gray-500">صفوف الملف</div></UCard>
            <UCard variant="outline"><div class="text-lg font-bold">{{ matchedCount }}</div><div class="text-xs text-gray-500">منتجات موجودة</div></UCard>
            <UCard variant="outline"><div class="text-lg font-bold">{{ newCount }}</div><div class="text-xs text-gray-500">منتجات جديدة مختارة</div></UCard>
            <UCard variant="outline"><div class="text-lg font-bold" :class="errorCount ? 'text-red-600' : 'text-emerald-700'">{{ errorCount }}</div><div class="text-xs text-gray-500">صفوف تحتاج مراجعة</div></UCard>
          </div>
          <div class="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <span>عرض {{ pageStart }}–{{ pageEnd }} من {{ rows.length }} صفًا</span>
            <div class="flex gap-2">
              <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-right" :disabled="currentPage <= 1" aria-label="الصفحة السابقة" @click="currentPage--" />
              <span class="flex items-center px-1 text-xs text-gray-500">{{ currentPage }} / {{ pageCount }}</span>
              <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-left" :disabled="currentPage >= pageCount" aria-label="الصفحة التالية" @click="currentPage++" />
            </div>
          </div>
          <div class="max-h-[42vh] space-y-3 overflow-y-auto overscroll-contain pe-1">
            <UCard v-for="row in visibleRows" :key="row.rowNumber" variant="outline" class="space-y-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="font-bold">صف {{ row.rowNumber }} · {{ row.name || 'بدون اسم' }}</div>
                  <div class="mt-0.5 font-mono text-xs text-gray-500" dir="ltr">{{ row.productId || 'بدون رقم منتج' }}</div>
                </div>
                <UBadge :color="row.product ? 'success' : row.createNew ? 'info' : 'warning'" variant="soft">
                  {{ row.product ? 'منتج موجود' : row.createNew ? 'إنشاء منتج جديد' : 'يحتاج قرارًا' }}
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
                    :search-input="{ placeholder: 'بحث عن منتج…', icon: 'i-lucide-search' }"
                    class="w-full"
                    @update:model-value="(product) => pickProduct(row, product)"
                  />
                </UFormField>
                <UCheckbox v-model="row.createNew" label="إنشاء منتج جديد بهذا الاسم" />
                <p class="mt-1 text-xs text-amber-800">لم يُعثر على المعرّف؛ لن تتم مطابقة الاسم تلقائيًا. سيُنشأ منتج جديد بمعرّف Firestore جديد.</p>
                <UFormField v-if="row.createNew" label="اسم المنتج الجديد" required class="mt-2">
                  <UInput v-model="row.name" class="w-full" />
                </UFormField>
              </div>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <UFormField label="الكمية المضافة"><UInputNumber v-model="row.quantity" :min="0.01" :step="1" class="w-full" /></UFormField>
                <UFormField label="تكلفة شراء الوحدة"><UInputNumber v-model="row.unitCost" :min="0" class="w-full" /></UFormField>
              </div>
              <UFormField v-if="row.product && unitChoices(row).length > 1" label="وحدة الكمية والتكلفة"><USelectMenu :model-value="selectedUnit(row)" :items="unitChoices(row)" label-key="name" by="id" class="w-full" @update:model-value="(unit) => pickUnit(row, unit)" /></UFormField>
              <template v-if="row.product">
                <div class="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-xs sm:grid-cols-3">
                  <span>المخزون الحالي: <b>{{ toNum(currentProduct(row)?.stock_quantity) }}</b></span>
                  <span>التكلفة الحالية: <b>{{ formatePrice(currentProduct(row)?.cost_price) }}</b></span>
                  <span>تكلفة الدفعة: <b>{{ formatePrice(row.unitCost) }}</b></span>
                  <span>المتوسط المتوقع: <b>{{ formatePrice(preview(row).avg) }}</b></span>
                  <span>سعر البيع القديم: <b>{{ formatePrice(currentProduct(row)?.price) }}</b></span>
                  <span>نسبة الربح القديمة: <b>{{ preview(row).rate === null ? 'غير متاحة' : `${round2((preview(row).rate ?? 0) * 100)}%` }}</b></span>
                  <span>السعر المقترح: <b>{{ preview(row).price === null ? 'يتطلب سعرًا يدويًا' : formatePrice(preview(row).price) }}</b></span>
                  <span>فرق السعر: <b>{{ priceDifference(row) === null ? '—' : formatePrice(priceDifference(row)) }}</b></span>
                </div>
                <template v-if="preview(row).applies">
                  <UFormField label="قرار سعر البيع">
                    <URadioGroup v-model="row.priceChoice" :items="priceChoices" />
                  </UFormField>
                  <UFormField v-if="row.priceChoice === 'proposed'" label="السعر المقترح (قابل للتعديل)" hint="السعر القديم ظاهر أعلاه كمرجع.">
                    <UInputNumber v-model="row.approvedPrice" :min="0" :step="0.01" class="w-full" />
                  </UFormField>
                  <UFormField v-else label="سعر بيع مخصص"><UInputNumber v-model="row.customPrice" :min="0" class="w-full" /></UFormField>
                </template>
              </template>
              <template v-else-if="row.createNew">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <UFormField label="سعر البيع للمنتج الجديد" required><UInputNumber v-model="row.newPrice" :min="0.01" class="w-full" /></UFormField>
                  <UFormField label="مؤشر نقص المخزون" hint="الافتراضي 5"><UInputNumber v-model="row.threshold" :min="0" :step="0.5" class="w-full" /></UFormField>
                  <UFormField label="وحدة المخزون الأساسية" required><UInput v-model="row.baseUnitName" placeholder="مثال: قطعة أو جرام" class="w-full" /></UFormField>
                </div>
              </template>
              <UAlert v-if="row.duplicate" color="error" variant="soft" title="هذا الصف مكرر في الملف." />
              <ul v-if="rowErrors(row).length" class="list-inside list-disc text-xs text-red-700"><li v-for="error in rowErrors(row)" :key="error">{{ error }}</li></ul>
            </UCard>
          </div>
          <UAlert v-if="tooManyRows" color="warning" variant="soft" icon="i-lucide-info" :title="`الفاتورة الواحدة تقبل حتى ${maxItems} أصناف من هذه الشاشة. الملف يحتوي ${rows.length} صنفًا، لذلك لن يُحفظ أي جزء منه. الملف الكبير يحتاج طريقة إدخال خاصة قبل تسجيله.`" />
          <div class="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-2">
            <div class="space-y-1 text-sm">
              <div class="flex justify-between gap-2"><span>إجمالي الفاتورة</span><b>{{ formatePrice(total) }} ج</b></div>
              <div class="flex justify-between gap-2"><span>رصيد الخزنة</span><b>{{ formatePrice(cashBalance) }} ج</b></div>
              <div class="flex justify-between gap-2"><span>الباقي المستحق</span><b class="text-amber-700">{{ formatePrice(remaining) }} ج</b></div>
            </div>
            <UFormField label="المدفوع الآن" :error="paidError || undefined"><UInputNumber v-model="paidNow" :min="0" :max="Math.min(total, cashBalance)" class="w-full" /></UFormField>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <UFormField label="المورد"><USelectMenu v-model="supplier" :items="supplierStore.list" label-key="name" by="id" placeholder="اختر المورد" class="w-full" /></UFormField>
            <UFormField label="مرجع فاتورة المورد (اختياري)"><UInput v-model="supplierRef" dir="ltr" class="w-full" /></UFormField>
          </div>
          <UFormField label="ملاحظة (اختياري)"><UInput v-model="note" class="w-full" /></UFormField>
        </template>
      </template>
      <template v-else>
        <UAlert :color="result.remaining > 0 ? 'warning' : 'success'" variant="soft" :icon="result.remaining > 0 ? 'i-lucide-clock-3' : 'i-lucide-circle-check'" :title="result.duplicate ? 'هذه الفاتورة نُفذت مسبقًا ولم تُكرر.' : result.remaining > 0 ? 'تم الشراء وبقي مبلغ مستحق للمورد.' : 'تم الشراء مدفوعًا بالكامل.'" />
        <div class="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <div class="flex justify-between"><span>الإجمالي</span><b>{{ formatePrice(result.total) }} ج</b></div>
          <div class="flex justify-between"><span>المدفوع</span><b>{{ formatePrice(result.paid) }} ج</b></div>
          <div class="flex justify-between"><span>الباقي</span><b>{{ formatePrice(result.remaining) }} ج</b></div>
        </div>
        <div class="break-all text-xs text-gray-500">مرجع فاتورة الشراء: <span class="font-mono" dir="ltr">{{ result.id }}</span></div>
        <UButton color="warning" variant="soft" icon="i-lucide-arrow-up-right" @click="navigateTo({ path: '/supplier-invoices', query: { invoice: result.id } })">عرض فاتورة المورد</UButton>
      </template>
      <UAlert v-if="submitError" color="error" variant="soft" :title="submitError" />
    </div>
    <template #footer>
      <div class="flex w-full flex-col gap-2 sm:flex-row">
        <UButton v-if="!result" color="success" class="min-h-11 flex-1" icon="i-lucide-package-plus" :loading="busy" :disabled="!canSubmit" @click="submit">تأكيد الفاتورة</UButton>
        <UButton v-else color="success" class="min-h-11 flex-1" @click="close">تم</UButton>
        <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="busy" @click="close">{{ result ? 'إغلاق' : 'إلغاء' }}</UButton>
      </div>
    </template>
  </UiAppDialog>
</template>

<script setup lang="ts">
import * as XLSX from "xlsx/dist/xlsx.full.min.js";
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
  duplicate: boolean;
  newPrice: number | null;
  threshold: number | null;
  priceChoice: "proposed" | "custom";
  approvedPrice: number | null;
  customPrice: number | null;
  baseUnitName: string;
  unitId?: string;
  unitName?: string;
  unitFactor: number;
}
interface ImportResult { id: string; total: number; paid: number; remaining: number; duplicate: boolean }

const props = defineProps<{ products: Product[]; cashBalance: number }>();
const emit = defineEmits<{ done: [] }>();
const open = defineModel<boolean>("open", { required: true });
const { round2, toNum, movingAverageCost, proposedSellingPrice, MAX_PURCHASE_ITEMS: maxItems } = useFinance();
const formatePrice = useHelpers().formatePrice;
const purchasing = usePurchasing();
const productsStore = useProductsStore();
const cashbox = useCashbox();
const supplierStore = useSuppliersStore();
const supplier = ref<Supplier | undefined>();
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
const currentPage = ref(1);
const pageSize = 20;
const productsById = computed(() => new Map(props.products.map((product) => [product.id, product])));
const priceChoices = [
  { label: "اعتماد السعر المقترح", value: "proposed" },
  { label: "تحديد سعر مخصص", value: "custom" },
];
const total = computed(() => round2(rows.value.reduce((sum, row) => sum + round2(toNum(row.quantity)) * round2(toNum(row.unitCost)), 0)));
const remaining = computed(() => round2(total.value - toNum(paidNow.value)));
const paidError = computed(() => paidNow.value < 0 || paidNow.value - total.value > 1e-9 || paidNow.value - props.cashBalance > 1e-9 ? "المدفوع يجب ألا يتجاوز الإجمالي أو رصيد الخزنة." : "");
const tooManyRows = computed(() => rows.value.length > maxItems);
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / pageSize)));
const pageStart = computed(() => rows.value.length ? (currentPage.value - 1) * pageSize + 1 : 0);
const pageEnd = computed(() => Math.min(currentPage.value * pageSize, rows.value.length));
const visibleRows = computed(() => rows.value.slice(pageStart.value - 1, pageEnd.value));
const duplicateProductIds = computed(() => {
  const counts = new Map<string, number>();
  for (const row of rows.value) {
    const id = row.product?.id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
});
const matchedCount = computed(() => rows.value.filter((row) => !!row.product).length);
const newCount = computed(() => rows.value.filter((row) => !row.product && row.createNew).length);
const errorCount = computed(() => rows.value.filter((row) => rowErrors(row).length > 0).length);
const canSubmit = computed(() => !!fileHash.value && !!supplier.value?.id && rows.value.length > 0 && !busy.value && !tooManyRows.value && !errorCount.value && !paidError.value);

function numericCell(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim().replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function makeRow(raw: unknown[], rowNumber: number): ImportRow {
  const productId = String(raw[0] ?? "").trim();
  const name = String(raw[1] ?? "").trim();
  const existing = productId ? productsById.value.get(productId) : undefined;
  return {
    rowNumber,
    productId,
    name: existing?.name ?? name,
    quantity: numericCell(raw[2]),
    unitCost: numericCell(raw[3]),
    product: existing,
    createNew: false,
    duplicate: false,
    newPrice: null,
    threshold: 5,
    priceChoice: "proposed",
    approvedPrice: null,
    customPrice: null,
    baseUnitName: "وحدة",
    unitId: existing?.base_unit_id || "legacy-base",
    unitName: existing?.base_unit_name || "وحدة",
    unitFactor: 1,
  };
}

function pickProduct(row: ImportRow, product: Product | null | undefined): void {
  if (!product?.id) return;
  row.product = product;
  row.productId = product.id;
  row.name = product.name;
  row.createNew = false;
  const base = product.units?.find((unit) => unit.is_base) ?? { id: product.base_unit_id || "legacy-base", name: product.base_unit_name || "وحدة", factor: 1, selling_price: product.price, is_base: true };
  row.unitId = base.id;
  row.unitName = base.name;
  row.unitFactor = base.factor;
  row.approvedPrice = preview(row).price;
}

function unitChoices(row: ImportRow): ProductUnit[] {
  const product = currentProduct(row);
  if (!product) return [];
  return product.units?.length ? product.units : [{ id: product.base_unit_id || "legacy-base", name: product.base_unit_name || "وحدة", factor: 1, selling_price: product.price, is_base: true }];
}
function selectedUnit(row: ImportRow): ProductUnit | undefined { return unitChoices(row).find((unit) => unit.id === row.unitId) ?? unitChoices(row)[0]; }
function pickUnit(row: ImportRow, unit?: ProductUnit): void { if (!unit) return; row.unitId = unit.id; row.unitName = unit.name; row.unitFactor = unit.factor; row.approvedPrice = preview(row).price; }

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
  selectedFileSize.value = file.size < 1024 * 1024
    ? `${Math.max(1, Math.round(file.size / 1024))} كيلوبايت`
    : `${(file.size / (1024 * 1024)).toFixed(1)} ميجابايت`;
  currentPage.value = 1;
  if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 10 * 1024 * 1024) {
    fileError.value = "اختر ملف .xlsx لا يتجاوز حجمه 10 ميجابايت.";
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    if (!sheet) throw new Error("الملف لا يحتوي على ورقة عمل.");
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
    const headers = ["رقم المنتج", "اسم المنتج", "الكمية المطلوبة", "تكلفة شراء الوحدة"];
    if (data.length < 2 || headers.some((header, index) => String(data[0]?.[index] ?? "").trim() !== header) || data[0]?.length !== 4) {
      throw new Error(`يجب أن يكون ترتيب الأعمدة: ${headers.join("، ")}.`);
    }
    const parsedRows = data.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== "")).map((row, index) => makeRow(row, index + 2));
    if (!parsedRows.length) throw new Error("لا توجد صفوف أصناف في الملف.");
    const seen = new Set<string>();
    for (const row of parsedRows) {
      const key = row.productId ? `id:${row.productId}` : `name:${row.name.toLocaleLowerCase()}`;
      if (seen.has(key)) row.duplicate = true;
      seen.add(key);
    }
    rows.value = parsedRows;
    for (const row of parsedRows) row.approvedPrice = preview(row).price;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    fileHash.value = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    await cashbox.fetchCashbox();
    paidNow.value = Math.min(total.value, cashbox.balance);
  } catch (error) {
    parseError.value = error instanceof Error ? error.message : "تعذر قراءة الملف.";
    rows.value = [];
  }
}

function currentProduct(row: ImportRow): Product | undefined {
  return row.product?.id ? productsById.value.get(row.product.id) ?? row.product : undefined;
}
function preview(row: ImportRow) {
  const product = currentProduct(row);
  if (!product) return { avg: null, rate: null, price: null, applies: false };
  const factor = Number(row.unitFactor || 1);
  const avg = round2(movingAverageCost(toNum(product.stock_quantity), product.cost_price, round2((row.quantity ?? 0) * factor), round2((row.unitCost ?? 0) / factor)));
  const result = proposedSellingPrice(product.cost_price, product.price, avg);
  return { avg, rate: result.rate, price: result.proposed, applies: avg - toNum(product.price) > 1e-9 };
}
function priceDifference(row: ImportRow): number | null {
  const result = preview(row);
  return result.price === null ? null : round2(result.price - toNum(currentProduct(row)?.price));
}
function rowErrors(row: ImportRow): string[] {
  const errors: string[] = [];
  if (row.duplicate || (row.product?.id && duplicateProductIds.value.has(row.product.id))) errors.push("صف مكرر لنفس المنتج.");
  if (!(row.quantity !== null && Number.isFinite(row.quantity) && row.quantity > 0)) errors.push("أدخل كمية موجبة وصالحة.");
  if (!(row.unitCost !== null && Number.isFinite(row.unitCost) && row.unitCost >= 0)) errors.push("أدخل تكلفة وحدة غير سالبة وصالحة.");
  if (!row.product && !row.createNew) errors.push("اختر إنشاء منتج جديد بعد مراجعة الاسم.");
  if (!row.name.trim()) errors.push("اسم المنتج مطلوب.");
  if (!row.product && row.createNew) {
    if (!(row.newPrice !== null && Number.isFinite(row.newPrice) && row.newPrice > 0)) errors.push("سعر البيع للمنتج الجديد مطلوب.");
    if (row.threshold === null || !Number.isFinite(row.threshold) || row.threshold < 0) errors.push("مؤشر النقص يجب ألا يكون سالبًا.");
    if (!row.baseUnitName.trim()) errors.push("اسم وحدة المخزون الأساسية مطلوب.");
  }
  const price = preview(row);
  if (row.product && price.applies) {
    if (row.priceChoice === "proposed" && price.price === null) errors.push("تعذر اشتقاق نسبة الربح؛ اختر سعرًا مخصصًا.");
    if (row.priceChoice === "proposed" && !(row.approvedPrice !== null && Number.isFinite(row.approvedPrice) && row.approvedPrice >= 0)) errors.push("السعر المقترح غير صالح.");
    if (row.priceChoice === "custom" && !(row.customPrice !== null && Number.isFinite(row.customPrice) && row.customPrice >= 0)) errors.push("أدخل سعر بيع مخصصًا.");
  }
  return errors;
}

async function submit(): Promise<void> {
  submitError.value = "";
  if (!canSubmit.value) return;
  busy.value = true;
  try {
    const items = rows.value.map((row) => {
      const p = preview(row);
      const pricing: PriceDecision = row.product && p.applies
        ? row.priceChoice === "custom"
          ? { mode: "custom", price: row.customPrice ?? 0, approvedProposed: p.price }
          : { mode: "proposed", approvedProposed: p.price ?? 0, price: row.approvedPrice ?? p.price ?? 0 }
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
        units: row.product ? undefined : [{ id: "base", name: row.baseUnitName, factor: 1, selling_price: row.newPrice, is_base: true }],
      };
    });
    const execution = await purchasing.executePurchase({
      idempotencyKey: `import-${fileHash.value}`,
      supplier_id: supplier.value?.id ?? null,
      supplier_name: supplier.value?.name ?? null,
      supplier_ref: supplierRef.value.trim() || null,
      source: "excel_import",
      items,
      paidNow: paidNow.value,
      note: note.value.trim() || `استيراد ${rows.value.length} صنفًا من Excel`,
    });
    if (!execution.ok) {
      submitError.value = execution.error ?? "تعذر تنفيذ الاستيراد.";
      if (execution.stale) {
        await productsStore.fetchProducts();
        submitError.value = `${submitError.value} تم تحديث بيانات المنتجات؛ راجع المعاينة ثم أكد مرة أخرى.`;
      }
      return;
    }
    const purchaseResult: ImportResult = {
      id: execution.id ?? "",
      total: execution.total ?? total.value,
      paid: execution.paid ?? paidNow.value,
      remaining: execution.remaining ?? remaining.value,
      duplicate: !!execution.duplicate,
    };
    result.value = purchaseResult;
    emit("done");
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "تعذر تنفيذ الاستيراد.";
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

watch(
  () => rows.value.map((row) => ({ rowNumber: row.rowNumber, quantity: row.quantity, unitCost: row.unitCost, productId: row.product?.id })),
  (current, previous) => {
    const previousByRow = new Map(previous.map((row) => [row.rowNumber, row]));
    for (const row of rows.value) {
      const old = previousByRow.get(row.rowNumber);
      if (!old || old.quantity === row.quantity && old.unitCost === row.unitCost && old.productId === row.product?.id) continue;
      row.approvedPrice = preview(row).price;
    }
  },
  { deep: true },
);

watch(
  () => props.products.map((product) => `${product.id}:${product.stock_quantity}:${product.cost_price}:${product.price}`),
  () => {
    for (const row of rows.value) {
      if (row.product && row.priceChoice === "proposed") row.approvedPrice = preview(row).price;
    }
  },
);
</script>
