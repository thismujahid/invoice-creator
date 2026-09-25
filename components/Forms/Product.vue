<template>
  <span @click="openDialog" class="inline-flex">
    <slot></slot>
  </span>
  <UiAppDialog v-model:open="open" :title="productForm?.id ? 'تعديل المنتج' : 'إضافة منتج جديد'">
    <div class="space-y-3">
      <UFormField label="اسم المنتج" required :error="errors.name">
        <UInput v-model="productForm.name" placeholder="اسم المنتج" size="lg" class="w-full" :disabled="saving" />
      </UFormField>
      <template v-if="!hideCost">
        <UFormField label="سعر التكلفة" required :error="errors.cost_price">
          <UInputNumber :model-value="numOrUndef(productForm.cost_price)" placeholder="سعر التكلفة" :min="0" size="lg" class="w-full" :disabled="saving" @update:model-value="(v) => (productForm.cost_price = v ?? null)" />
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
const productForm = ref<Product>({ name: "", price: null, cost_price: null, count: null });
const saving = ref(false);
const submitError = ref("");
const errors = ref<{ name?: string; price?: string; cost_price?: string; count?: string }>({});

const internalOpen = ref(false);
const open = computed({
  get: () => props.modelValue ?? internalOpen.value,
  set: (v: boolean) => {
    internalOpen.value = v;
    emit("update:modelValue", v);
    if (!v) emit("close");
  },
});

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
  if (!props.hideCost) {
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
  const countNeg = positiveNumberRule(productForm.value.count);
  if (countNeg !== true) e.count = countNeg;
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
      await productsStore.updateProduct(productForm.value.id, { ...productForm.value });
    } else {
      const created = (await productsStore.addProduct({ ...productForm.value })) as { id?: string } | null;
      id = created?.id;
    }
    await props.refresher();
    emit("done", productsStore.list.find((prod) => prod.id === id));
    productForm.value = { name: "", price: null, cost_price: null, count: null };
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
    productForm.value = props.edit ? { ...props.edit } : { name: "", price: null, cost_price: null, count: null };
  },
  { immediate: true }
);
</script>
