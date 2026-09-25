<template>
  <span @click="openDialog" class="inline-flex">
    <slot></slot>
  </span>
  <UiAppDialog
    v-model:open="open"
    :title="customerForm?.id ? 'تعديل العميل' : 'إضافة عميل جديد'"
  >
    <div class="space-y-3">
      <UFormField label="اسم العميل" required :error="errors.name">
        <UInput
          v-model="customerForm.name"
          placeholder="اسم العميل"
          size="lg"
          class="w-full"
          :disabled="saving"
        />
      </UFormField>
      <UFormField label="رقم هاتف العميل" required :error="errors.phone">
        <UInput
          :model-value="String(customerForm.phone ?? '')"
          placeholder="رقم هاتف العميل"
          inputmode="tel"
          dir="ltr"
          size="lg"
          class="w-full"
          :disabled="saving"
          @update:model-value="(v) => (customerForm.phone = v)"
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
          @click="saveCustomer"
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
import type { Customer } from "~/types";

// P4: Vuetify dialog/form → UiAppDialog + UFormField validation.
// v-model:open is now honored (was ignored before).
const props = defineProps<{
  edit?: Customer | null;
  refresher: () => Promise<unknown> | unknown;
  modelValue?: boolean;
}>();
const emit = defineEmits(["done", "update:modelValue"]);
const customersStore = useCustomersStore();
const { notify } = useAppToast();
const customerForm = ref<Customer>({ name: "", phone: null });
const saving = ref(false);
const submitError = ref("");
const errors = ref<{ name?: string; phone?: string }>({});

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
  const e: { name?: string; phone?: string } = {};
  const nameRes = requiredRule(customerForm.value.name?.trim());
  if (nameRes !== true) e.name = nameRes;
  const phoneRes = requiredRule(String(customerForm.value.phone ?? "").trim());
  if (phoneRes !== true) e.phone = phoneRes;
  errors.value = e;
  return Object.keys(e).length === 0;
}

async function saveCustomer() {
  if (!validate()) return;
  saving.value = true;
  submitError.value = "";
  try {
    let id = customerForm.value.id;
    if (customerForm.value.id) {
      await customersStore.updateCustomer(customerForm.value.id, {
        ...customerForm.value,
      });
    } else {
      const res = (await customersStore.addCustomer({
        ...customerForm.value,
      })) as { id?: string } | null;
      id = res?.id;
    }
    await props.refresher();
    emit(
      "done",
      customersStore.list.find((c) => c.id === id),
    );
    customerForm.value = { name: "", phone: null };
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
    if (props.edit) customerForm.value = { ...props.edit };
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
