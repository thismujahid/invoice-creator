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
          <div v-if="problemRows.length" class="space-y-2">
            <p class="text-xs font-bold text-amber-700">
              صفوف تحتاج مراجعة ({{ problemRows.length }}) — باقي الصفوف سليمة وستُحفظ تلقائيًا
            </p>
            <div class="max-h-[38vh] space-y-2 overflow-y-auto overscroll-contain pe-1">
              <UCard v-for="row in problemRows" :key="row.rowNumber" variant="outline" class="space-y-2 p-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-sm font-bold">صف {{ row.rowNumber }} · {{ row.name || 'بدون اسم' }}</div>
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
                <div class="grid grid-cols-2 gap-2">
                  <UFormField label="الكمية"><UInputNumber v-model="row.quantity" :min="0.01" :step="0.01" class="w-full" /></UFormField>
                  <UFormField label="تكلفة الوحدة"><UInputNumber v-model="row.unitCost" :min="0" :step="0.0001" class="w-full" /></UFormField>
                </div>
                <UFormField v-if="row.product && unitChoices(row).length > 1" label="وحدة الكمية والتكلفة"><USelectMenu :model-value="selectedUnit(row)" :items="unitChoices(row)" label-key="name" by="id" :search-input="false" class="w-full" @update:model-value="(unit) => pickUnit(row, unit)" /></UFormField>
              <template v-if="row.product && preview(row).applies">
                <div class="rounded-lg bg-gray-50 p-2 text-xs">السعر المقترح: <b>{{ preview(row).price === null ? 'يتطلب سعرًا يدويًا' : formatePrice(preview(row).price) }}</b></div>
                <UFormField label="قرار سعر البيع">
                  <URadioGroup v-model="row.priceChoice" :items="priceChoices" />
                </UFormField>
                <UFormField v-if="row.priceChoice === 'proposed'" label="السعر المقترح (قابل للتعديل)"><UInputNumber v-model="row.approvedPrice" :min="0" :step="0.01" class="w-full" /></UFormField>
                <UFormField v-else label="سعر بيع مخصص"><UInputNumber v-model="row.customPrice" :min="0" :step="0.01" class="w-full" /></UFormField>
              </template>
              <template v-else-if="row.createNew">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <UFormField label="سعر البيع للمنتج الجديد" required><UInputNumber v-model="row.newPrice" :min="0.01" :step="0.01" class="w-full" /></UFormField>
                  <UFormField label="مؤشر نقص المخزون" hint="الافتراضي 5"><UInputNumber v-model="row.threshold" :min="0" :step="0.01" class="w-full" /></UFormField>
                  <UFormField label="وحدة المخزون الأساسية" required><UInput v-model="row.baseUnitName" placeholder="مثال: قطعة أو جرام" class="w-full" /></UFormField>
                </div>
              </template>
              <ul v-if="rowErrors(row).length" class="list-inside list-disc text-xs text-red-700"><li v-for="error in rowErrors(row)" :key="error">{{ error }}</li></ul>
            </UCard>
            </div>
          </div>
          <UAlert v-else color="success" variant="soft" icon="i-lucide-circle-check" title="كل الصفوف سليمة وجاهزة — أكّد الفاتورة مباشرة." />
          <div class="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-2">
            <div class="space-y-1 text-sm">
              <div class="flex justify-between gap-2"><span>إجمالي الفاتورة</span><b>{{ formatePrice(total) }} ج</b></div>
              <div class="flex justify-between gap-2"><span>رصيد الخزنة</span><b>{{ formatePrice(cashBalance) }} ج</b></div>
              <div class="flex justify-between gap-2"><span>الباقي المستحق</span><b class="text-amber-700">{{ formatePrice(remaining) }} ج</b></div>
            </div>
            <UFormField label="المدفوع الآن" :error="paidError || undefined"><UInputNumber v-model="paidNow" :min="0" :max="Math.min(total, cashBalance)" :step="0.01" class="w-full" /></UFormField>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <UFormField label="المورد">
              <USelectMenu
                :model-value="(supplier ?? null) as Supplier | undefined"
                :items="supplierMenuItems"
                label-key="name"
                by="id"
                placeholder="اختر المورد"
                :search-input="{ placeholder: 'بحث عن مورد...', icon: 'i-lucide-search' }"
                class="w-full"
                @update:model-value="(s) => onPickSupplier(s)"
              />
              <FormsSupplier
                v-model="showSupplierModal"
                :refresher="reloadSuppliers"
                @done="onSupplierCreated"
              />
            </UFormField>
            <UFormField label="مرجع فاتورة المورد (اختياري)"><UInput v-model="supplierRef" dir="ltr" class="w-full" /></UFormField>
          </div>
          <UFormField label="ملاحظة (اختياري)"><UInput v-model="note" class="w-full" /></UFormField>
          <div v-if="busy" class="overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-4">
            <div class="flex items-center gap-3">
              <span class="relative flex size-11 shrink-0 items-center justify-center">
                <span class="absolute inset-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600"></span>
                <UIcon name="i-lucide-package-plus" class="size-5 text-emerald-700" />
              </span>
              <div class="min-w-0">
                <div class="font-bold text-gray-900">{{ stageTitle }}</div>
                <div v-if="stageSubtitle" class="text-xs text-gray-500">{{ stageSubtitle }}</div>
              </div>
            </div>
            <UProgress :value="stagePct" class="mt-3" />
            <ul class="mt-3 space-y-1.5 text-xs">
              <li
                v-for="(step, i) in stageSteps"
                :key="step"
                class="flex items-center gap-2"
                :class="i < stageIndex ? 'text-emerald-700' : i === stageIndex ? 'font-bold text-gray-900' : 'text-gray-400'"
              >
                <UIcon
                  :name="i < stageIndex ? 'i-lucide-circle-check' : i === stageIndex ? 'i-lucide-loader-circle' : 'i-lucide-circle'"
                  :class="['size-4 shrink-0', i === stageIndex && 'animate-spin']"
                />
                {{ step }}
              </li>
            </ul>
          </div>
        </template>
      </template>
      <template v-else>
        <UAlert :color="result.remaining > 0 ? 'warning' : 'success'" variant="soft" :icon="result.remaining > 0 ? 'i-lucide-clock-3' : 'i-lucide-circle-check'" :title="result.duplicate ? 'هذه الفاتورة نُفذت مسبقًا ولم تُكرر.' : result.remaining > 0 ? 'تم الشراء وبقي مبلغ مستحق للمورد.' : 'تم الشراء مدفوعًا بالكامل.'" />
        <div class="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <div class="flex justify-between"><span>الإجمالي</span><b>{{ formatePrice(result.total) }} ج</b></div>
          <div class="flex justify-between"><span>المدفوع</span><b>{{ formatePrice(result.paid) }} ج</b></div>
          <div class="flex justify-between"><span>الباقي</span><b>{{ formatePrice(result.remaining) }} ج</b></div>
        </div>
        <div class="break-all text-xs text-gray-500">فواتير الشراء ({{ result.ids.length }}):</div>
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="id in result.ids"
            :key="id"
            color="warning"
            variant="soft"
            size="sm"
            icon="i-lucide-arrow-up-right"
            @click="navigateTo({ path: '/supplier-invoices', query: { invoice: id } })"
          >عرض {{ id.slice(0, 6) }}</UButton>
        </div>
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
interface ImportResult { ids: string[]; total: number; paid: number; remaining: number; duplicate: boolean }

const props = defineProps<{ products: Product[]; cashBalance: number }>();
const emit = defineEmits<{ done: [] }>();
const open = defineModel<boolean>("open", { required: true });
const { round2, round4, toNum, movingAverageCost, proposedSellingPrice, purchasableUnitsForProduct, MAX_PURCHASE_ITEMS: maxItems } = useFinance();
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
const productsById = computed(() => new Map(props.products.map((product) => [product.id, product])));
const priceChoices = [
  { label: "اعتماد السعر المقترح", value: "proposed" },
  { label: "تحديد سعر مخصص", value: "custom" },
];
const total = computed(() => round2(rows.value.reduce((sum, row) => sum + round2(toNum(row.quantity) * toNum(row.unitCost)), 0)));
const remaining = computed(() => round2(total.value - toNum(paidNow.value)));
const paidError = computed(() => paidNow.value < 0 || paidNow.value - total.value > 1e-9 || paidNow.value - props.cashBalance > 1e-9 ? "المدفوع يجب ألا يتجاوز الإجمالي أو رصيد الخزنة." : "");
const problemRows = computed(() => rows.value.filter((row) => rowErrors(row).length > 0));
const canSubmit = computed(() => !!fileHash.value && !!supplier.value?.id && rows.value.length > 0 && !busy.value && !errorCount.value && !paidError.value);
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
  const base = purchasableUnitsForProduct(product).find((unit) => unit.is_base) ?? purchasableUnitsForProduct(product)[0] ?? { id: product.base_unit_id || "legacy-base", name: product.base_unit_name || "وحدة", factor: 1, selling_price: product.price, is_base: true };
  row.unitId = base.id;
  row.unitName = base.name;
  row.unitFactor = base.factor;
  row.approvedPrice = preview(row).price;
}

function unitChoices(row: ImportRow): ProductUnit[] {
  const product = currentProduct(row);
  if (!product) return [];
  return purchasableUnitsForProduct(product);
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
  if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 10 * 1024 * 1024) {
    fileError.value = "اختر ملف .xlsx لا يتجاوز حجمه 10 ميجابايت.";
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const XLSX = await import("xlsx/dist/xlsx.full.min.js");
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
    // Unmatched rows default to new-product creation (the user unchecks +
    // picks manually when it was just a mismatch); their missing fields
    // surface in the compact review section.
    for (const row of parsedRows) {
      if (!row.product) row.createNew = true;
      row.approvedPrice = preview(row).price;
    }
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
  const avg = round4(movingAverageCost(toNum(product.stock_quantity), product.cost_price, round2((row.quantity ?? 0) * factor), round4((row.unitCost ?? 0) / factor)));
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
  stageSteps.value = [];
  stageIndex.value = 0;
  stagePct.value = 0;
  stageTitle.value = "";
  stageSubtitle.value = "";
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
    // No row cap: split into atomic invoices (maxItems each) so files of any
    // size import in sequential batches with staged progress.
    const chunks: typeof items[] = [];
    for (let i = 0; i < items.length; i += maxItems) chunks.push(items.slice(i, i + maxItems));
    const newTotal = rows.value.filter((row) => !row.product).length;
    const existingTotal = rows.value.length - newTotal;
    stageSteps.value = [
      "فحص المنتجات",
      `إضافة الكميات للمنتجات الموجودة (${existingTotal})`,
      ...(newTotal > 0 ? [`إنشاء المنتجات الجديدة (${newTotal})`] : []),
      ...chunks.map((_, i) => `حفظ الدفعة ${i + 1} من ${chunks.length}`),
      "تحديث الأرصدة",
    ];
    stageIndex.value = 0;
    stageTitle.value = "جاري فحص المنتجات…";
    stageSubtitle.value = `${rows.value.length} صنفًا`;
    await nextTick();
    let paidLeft = round2(toNum(paidNow.value));
    const ids: string[] = [];
    let sumTotal = 0;
    let sumPaid = 0;
    let allDuplicate = chunks.length > 0;
    const chunkBase = newTotal > 0 ? 3 : 2;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const chunkTotal = round2(chunk.reduce((s, it) => s + round2(toNum(it.quantity) * round4(toNum(it.unit_cost))), 0));
      const chunkPaid = Math.min(paidLeft, chunkTotal);
      paidLeft = round2(paidLeft - chunkPaid);
      stageIndex.value = chunkBase + i;
      stageTitle.value = `جاري حفظ الدفعة ${i + 1} من ${chunks.length}…`;
      stageSubtitle.value = `${chunk.length} صنفًا · ${formatePrice(chunkTotal)} ج`;
      stagePct.value = Math.round((i / chunks.length) * 100);
      const execution = await purchasing.executePurchase({
        idempotencyKey: `import-${fileHash.value}-part-${i + 1}-of-${chunks.length}`,
        supplier_id: supplier.value?.id ?? null,
        supplier_name: supplier.value?.name ?? null,
        supplier_ref: supplierRef.value.trim() || null,
        source: "excel_import",
        items: chunk,
        paidNow: chunkPaid,
        note: note.value.trim() || `استيراد ${rows.value.length} صنفًا من Excel (دفعة ${i + 1}/${chunks.length})`,
      });
      if (!execution.ok) {
        submitError.value = `${execution.error ?? "تعذر تنفيذ الاستيراد."}${i > 0 ? ` (تم حفظ ${i} من ${chunks.length} دفعات)` : ""}`;
        if (execution.stale) {
          await productsStore.fetchProducts();
          submitError.value = `${submitError.value} تم تحديث بيانات المنتجات؛ راجع الأصناف ثم أكد مرة أخرى.`;
        }
        return;
      }
      if (execution.id) ids.push(execution.id);
      sumTotal = round2(sumTotal + (execution.total ?? chunkTotal));
      sumPaid = round2(sumPaid + (execution.paid ?? chunkPaid));
      if (!execution.duplicate) allDuplicate = false;
      stagePct.value = Math.round(((i + 1) / chunks.length) * 100);
    }
    stageIndex.value = stageSteps.value.length - 1;
    stageTitle.value = "جاري تحديث الأرصدة…";
    stageSubtitle.value = "";
    await cashbox.fetchCashbox();
    const purchaseResult: ImportResult = {
      ids,
      total: sumTotal,
      paid: sumPaid,
      remaining: round2(sumTotal - sumPaid),
      duplicate: allDuplicate,
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
