<template>
  <span class="inline-flex" @click="openDialog">
    <slot />
  </span>
  <UiAppDialog
    v-model:open="open"
    :title="supplierForm?.id ? 'تعديل المورد' : 'إضافة مورد جديد'"
  >
    <div class="space-y-3">
      <UFormField label="اسم المورد" required :error="errors.name">
        <UInput
          v-model="supplierForm.name"
          placeholder="اسم المورد"
          size="lg"
          class="w-full"
          :disabled="saving"
        />
      </UFormField>
      <UFormField label="رقم هاتف المورد">
        <UInput
          :model-value="String(supplierForm.phone ?? '')"
          placeholder="رقم هاتف المورد"
          inputmode="tel"
          dir="ltr"
          size="lg"
          class="w-full"
          :disabled="saving"
          @update:model-value="(v) => (supplierForm.phone = v)"
        />
      </UFormField>
      <UFormField label="العنوان">
        <UInput
          :model-value="supplierForm.address ?? ''"
          placeholder="العنوان"
          size="lg"
          class="w-full"
          :disabled="saving"
          @update:model-value="(v) => (supplierForm.address = String(v ?? ''))"
        />
      </UFormField>
      <UFormField label="ملاحظات">
        <UInput
          :model-value="supplierForm.notes ?? ''"
          placeholder="ملاحظات"
          size="lg"
          class="w-full"
          :disabled="saving"
          @update:model-value="(v) => (supplierForm.notes = String(v ?? ''))"
        />
      </UFormField>
      <UAlert
        v-if="submitError"
        color="error"
        variant="soft"
        :title="submitError"
      />
    </div>
    <template #footer>
      <div class="flex w-full gap-2">
        <UButton
          :loading="saving"
          color="success"
          icon="i-lucide-save"
          class="min-h-11 flex-1"
          @click="saveSupplier"
          >حفظ</UButton
        >
        <UButton
          :disabled="saving"
          color="neutral"
          variant="soft"
          class="min-h-11 flex-1"
          @click="closeDialog"
          >إلغاء</UButton
        >
      </div>
    </template>
  </UiAppDialog>
</template>

<script setup lang="ts">
import type { Supplier } from "~/types/finance";
import { useSuppliersStore } from "~/stores/suppliers";

const props = defineProps<{
  edit?: Supplier | null;
  refresher: () => Promise<unknown> | unknown;
  modelValue?: boolean;
}>();
const emit = defineEmits(["done", "update:modelValue"]);
const suppliersStore = useSuppliersStore();
const { notify } = useAppToast();
const supplierForm = ref<Supplier>({ name: "", phone: null, address: null, notes: null });
const saving = ref(false);
const submitError = ref("");
const errors = ref<{ name?: string }>({});

const open = computed({
  get: () => props.modelValue ?? internalOpen.value,
  set: (v: boolean) => {
    internalOpen.value = v;
    emit("update:modelValue", v);
  },
});
const internalOpen = ref(false);

function openDialog(): void {
  submitError.value = "";
  errors.value = {};
  open.value = true;
}
function closeDialog(): void {
  open.value = false;
}

function validate(): boolean {
  const e: { name?: string } = {};
  const nameRes = requiredRule(String(supplierForm.value.name ?? "").trim());
  if (nameRes !== true) e.name = nameRes;
  errors.value = e;
  return Object.keys(e).length === 0;
}

async function saveSupplier() {
  if (!validate()) return;
  saving.value = true;
  submitError.value = "";
  try {
    const payload = {
      name: String(supplierForm.value.name ?? "").trim(),
      phone: String(supplierForm.value.phone ?? "").trim() || null,
      address: String(supplierForm.value.address ?? "").trim() || null,
      notes: String(supplierForm.value.notes ?? "").trim() || null,
    };
    let id = supplierForm.value.id;
    if (supplierForm.value.id) {
      await suppliersStore.updateSupplier(supplierForm.value.id, payload);
    } else {
      const res = (await suppliersStore.addSupplier(payload)) as { id?: string } | null;
      id = res?.id;
    }
    await props.refresher();
    emit(
      "done",
      suppliersStore.list.find((s) => s.id === id),
    );
    supplierForm.value = { name: "", phone: null, address: null, notes: null };
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
    if (props.edit) supplierForm.value = { ...props.edit };
  },
  { immediate: true },
);
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      submitError.value = "";
      errors.value = {};
    }
  },
);
</script>
