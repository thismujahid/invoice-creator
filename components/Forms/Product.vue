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
import type { Product } from "~/types";

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
const productForm = ref<Product>({ name: "", price: null, cost_price: null, count: null, low_stock_threshold: 5 });
const saving = ref(false);
const submitError = ref("");
const errors = ref<{ name?: string; price?: string; cost_price?: string; count?: string; low_stock_threshold?: string }>({});

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
    if (productForm.value?.id) {
      // Edit mode never writes cost_price (§7: system-managed).
      const { cost_price: _locked, ...editData } = productForm.value;
      void _locked;
      editData.low_stock_threshold = productForm.value.low_stock_threshold ?? 5;
      await productsStore.updateProduct(productForm.value.id, { ...editData });
    } else {
      const created = (await productsStore.addProduct({ ...productForm.value, low_stock_threshold: productForm.value.low_stock_threshold ?? 5 })) as { id?: string } | null;
      id = created?.id;
    }
    await props.refresher();
    emit("done", productsStore.list.find((prod) => prod.id === id));
    productForm.value = { name: "", price: null, cost_price: null, count: null, low_stock_threshold: 5 };
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
  productForm.value = props.edit ? { low_stock_threshold: 5, ...props.edit } : { name: "", price: null, cost_price: null, count: null, low_stock_threshold: 5 };
  },
  { immediate: true }
);
</script>
