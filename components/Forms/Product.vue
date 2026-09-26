<template>
  <span @click="openDialog" class="inline-flex">
    <slot></slot>
  </span>
  <UiAppDialog v-model:open="open" :title="productForm?.id ? 'تعديل المنتج' : 'إضافة منتج جديد'">
    <div class="space-y-3">
      <UFormField label="اسم المنتج" required :error="errors.name">
        <UInput v-model="productForm.name" placeholder="اسم المنتج" size="lg" class="w-full" :disabled="saving" />
      </UFormField>
      <template v-if="!isEditMode">
        <UFormField label="سعر التكلفة" required :error="errors.cost_price">
          <UInputNumber :model-value="numOrUndef(productForm.cost_price)" placeholder="سعر التكلفة" :min="0" size="lg" class="w-full" :disabled="saving" @update:model-value="(v) => (productForm.cost_price = v ?? null)" />
        </UFormField>
      </template>
      <template v-else-if="!costLocked">
        <UFormField label="سعر التكلفة (متوسط متحرك، للعرض فقط)">
          <UInput :model-value="formatePrice(productForm.cost_price)" readonly size="lg" class="w-full" dir="ltr" />
          <template #hint>
            <span class="text-xs text-gray-500">تُدار بواسطة حركات المخزون (شراء/مرتجع) ولا تُعدَّل يدوياً.</span>
          </template>
        </UFormField>
      </template>
      <UAlert v-else color="warning" variant="soft" title="تم إخفاء حقل سعر التكلفة، إذا كنت تريد تعديل سعر التكلفة قم بعرض القيمة أولاً">
        <template #description><slot name="cost-input-place"></slot></template>
      </UAlert>
      <UFormField label="سعر البيع" required :error="errors.price">
        <UInputNumber :model-value="numOrUndef(productForm.price)" placeholder="سعر البيع" :min="0" size="lg" class="w-full" :disabled="saving" @update:model-value="(v) => (productForm.price = v ?? null)" />
      </UFormField>
      <UFormField label="العدد" :error="errors.count">
        <UInputNumber :model-value="numOrUndef(productForm.count)" placeholder="العدد" :min="0" size="lg" class="w-full" :disabled="saving" @update:model-value="(v) => (productForm.count = v ?? null)" />
      </UFormField>
      <UFormField label="مؤشر نقص المخزون" :error="errors.low_stock_threshold" hint="يظهر تنبيه عندما يقل المخزون عن هذا الرقم (الافتراضي 5)">
        <UInputNumber :model-value="productForm.low_stock_threshold ?? 5" placeholder="5" :min="0" :step="0.5" size="lg" class="w-full" :disabled="saving" @update:model-value="(v) => (productForm.low_stock_threshold = v ?? null)" />
      </UFormField>
      <UFormField label="وحدة المخزون الأساسية" required :error="errors.base_unit_name" :hint="baseUnitLocked ? 'لا يمكن تغيير الوحدة الأساسية بعد تسجيلها.' : 'المخزون يُحفظ دائمًا بهذه الوحدة.'">
        <UInput :model-value="productForm.base_unit_name ?? ''" placeholder="مثال: قطعة، جرام، كيس" class="w-full" :disabled="saving || baseUnitLocked" @update:model-value="(value) => (productForm.base_unit_name = value)" />
      </UFormField>
      <div class="space-y-2 rounded-xl border border-gray-200 p-3">
        <div class="flex items-center justify-between gap-2">
          <div><h3 class="text-sm font-bold">وحدات بيع إضافية</h3><p class="text-xs text-gray-500">معامل التحويل نسبةً لوحدة المخزون الأساسية.</p></div>
          <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" :disabled="saving" @click="addUnit">إضافة وحدة</UButton>
        </div>
        <div class="grid grid-cols-[1fr_0.8fr_0.8fr_auto] gap-2 px-1 text-xs text-gray-500"><span>الوحدة</span><span>تحتوي وحدات أساسية</span><span>سعر البيع</span><span /></div>
        <div v-for="(unit, index) in additionalUnits" :key="unit.id" class="grid grid-cols-[1fr_0.8fr_0.8fr_auto] items-center gap-2">
          <UInput v-model="unit.name" placeholder="اسم الوحدة" size="sm" :disabled="saving" />
          <UInputNumber v-model="unit.factor" :min="1" :step="1" size="sm" :disabled="saving" />
          <UInputNumber v-model="unit.selling_price" :min="0" size="sm" :disabled="saving" />
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" aria-label="حذف الوحدة" :disabled="saving" @click="removeUnit(index)" />
        </div>
      </div>
      <UAlert v-if="submitError" color="error" variant="soft" :title="submitError" />
    </div>
    <template #footer>
      <div class="flex w-full gap-2">
        <UButton :loading="saving" color="success" icon="i-lucide-save" class="min-h-11 flex-1" @click="saveProduct">حفظ</UButton>
        <UButton :disabled="saving" color="neutral" variant="soft" class="min-h-11 flex-1" @click="closeDialog">إلغاء</UButton>
      </div>
    </template>
  </UiAppDialog>
</template>

<script setup lang="ts">
import type { Product, ProductUnit } from "~/types";

// P4: Vuetify dialog/form → UiAppDialog + inline validation.
// FLAG [B10-FIXED earlier]: duplicate-name guard kept, store ref unified.
const props = defineProps<{
  edit?: Product | null;
  refresher: () => Promise<unknown> | unknown;
  hideCost?: boolean;
  modelValue?: boolean;
}>();
const emit = defineEmits(["done", "close", "update:modelValue"]);
const productsStore = useProductsStore();
const auth = useAuth();
const { notify } = useAppToast();
const { formatePrice } = useHelpers();
const productForm = ref<Product>({ name: "", price: null, cost_price: null, count: null, low_stock_threshold: 5, base_unit_name: "وحدة", base_unit_id: "base" });
const additionalUnits = ref<ProductUnit[]>([]);
const baseUnitLocked = computed(() => !!(props.edit?.base_unit_id && props.edit?.base_unit_name));
const saving = ref(false);
const submitError = ref("");
const errors = ref<{ name?: string; price?: string; cost_price?: string; count?: string; low_stock_threshold?: string; base_unit_name?: string }>({});

const internalOpen = ref(false);
const open = computed({
  get: () => props.modelValue ?? internalOpen.value,
  set: (v: boolean) => {
    internalOpen.value = v;
    emit("update:modelValue", v);
    if (!v) emit("close");
  },
});
// Cost is freely visible when creating; password gate applies to edits only.
const isEditMode = computed(() => !!productForm.value?.id);
const costLocked = computed(() => !!props.hideCost && isEditMode.value);

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function openDialog(): void {
  submitError.value = "";
  errors.value = {};
  open.value = true;
}
function closeDialog(): void {
  open.value = false;
}

function newUnitId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `unit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function addUnit(): void { additionalUnits.value.push({ id: newUnitId(), name: "", factor: 1, selling_price: null }); }
function removeUnit(index: number): void { additionalUnits.value.splice(index, 1); }

function validate(): boolean {
  const e: typeof errors.value = {};
  const nameRes = requiredRule(productForm.value.name?.trim());
  if (nameRes !== true) e.name = nameRes;
  // Cost is editable on create only; edits never touch it (§7).
  if (!isEditMode.value) {
    const costRes = requiredRule(productForm.value.cost_price);
    if (costRes !== true) e.cost_price = costRes;
    else {
      const neg = positiveNumberRule(productForm.value.cost_price);
      if (neg !== true) e.cost_price = neg;
    }
  }
  const priceRes = requiredRule(productForm.value.price);
  if (priceRes !== true) e.price = priceRes;
  else {
    const neg = positiveNumberRule(productForm.value.price);
    if (neg !== true) e.price = neg;
  }
  // Cost may never exceed selling price (create mode, when editable).
  if (!isEditMode.value && !e.cost_price && !e.price) {
    const cost = Number(productForm.value.cost_price);
    const price = Number(productForm.value.price);
    if (cost - price > 1e-9) {
      e.cost_price = "سعر التكلفة لا يمكن أن يكون أعلى من سعر البيع.";
    }
  }
  const countNeg = positiveNumberRule(productForm.value.count);
  if (countNeg !== true) e.count = countNeg;
  const thr: unknown = productForm.value.low_stock_threshold;
  if (thr !== null && thr !== undefined && thr !== "") {
    const thrNum = Number(thr);
    if (!Number.isFinite(thrNum) || thrNum < 0) {
      e.low_stock_threshold = "مؤشر النقص يجب أن يكون صفرًا أو رقمًا موجبًا.";
    }
  }
  if (!productForm.value.base_unit_name?.trim()) e.base_unit_name = "اسم وحدة المخزون الأساسية مطلوب.";
  const unitIds = new Set<string>();
  for (const [index, unit] of additionalUnits.value.entries()) {
    if (!unit.name.trim() || !(Number(unit.factor) > 1) || !Number.isFinite(Number(unit.factor)) || unitIds.has(unit.id)) {
      e.base_unit_name = `راجع بيانات وحدة البيع رقم ${index + 1}.`;
      break;
    }
    unitIds.add(unit.id);
  }
  errors.value = e;
  return Object.keys(e).length === 0;
}

async function saveProduct() {
  const duplicate = productsStore.list.find((prod) => prod.name?.trim() === productForm.value.name?.trim());
  if (duplicate && !productForm.value?.id) {
    notify("تمت إضافة منتج بنفس الإسم من قبل", "error");
    return;
  }
  if (!validate()) return;
  saving.value = true;
  submitError.value = "";
  try {
    let id = productForm.value?.id;
    const baseId = productForm.value.base_unit_id || "base";
    const units: ProductUnit[] = [
      { id: baseId, name: productForm.value.base_unit_name?.trim() || "وحدة", factor: 1, selling_price: productForm.value.price, is_base: true },
      ...additionalUnits.value.map((unit) => ({ ...unit, name: unit.name.trim(), factor: Number(unit.factor), selling_price: unit.selling_price === null ? null : Number(unit.selling_price), is_base: false })),
    ];
    if (productForm.value?.id) {
      // Edit mode never writes cost_price (§7: system-managed).
      const { cost_price: _locked, ...editData } = productForm.value;
      void _locked;
      editData.low_stock_threshold = productForm.value.low_stock_threshold ?? 5;
      await productsStore.updateProduct(productForm.value.id, { ...editData, base_unit_id: baseId, units });
    } else {
      const created = (await productsStore.addProduct({ ...productForm.value, units, low_stock_threshold: productForm.value.low_stock_threshold ?? 5 })) as { id?: string } | null;
      id = created?.id;
    }
    await props.refresher();
    emit("done", productsStore.list.find((prod) => prod.id === id));
    productForm.value = { name: "", price: null, cost_price: null, count: null, low_stock_threshold: 5, base_unit_name: "وحدة", base_unit_id: "base" };
    additionalUnits.value = [];
    closeDialog();
  } catch (err) {
    submitError.value = String(err);
    notify(String(err), "error");
  } finally {
    saving.value = false;
  }
}
watch(
  () => props.edit,
  () => {
  productForm.value = props.edit ? { low_stock_threshold: 5, base_unit_name: "وحدة", ...props.edit } : { name: "", price: null, cost_price: null, count: null, low_stock_threshold: 5, base_unit_name: "وحدة", base_unit_id: "base" };
  additionalUnits.value = props.edit?.units?.filter((unit) => !unit.is_base && unit.id !== props.edit?.base_unit_id).map((unit) => ({ ...unit })) ?? [];
  },
  { immediate: true }
);
</script>
