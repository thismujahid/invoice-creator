<template>
  <v-dialog max-width="350px" v-model="customerFormState">
    <template #activator="{ props }">
      <span v-bind="props">
        <slot></slot>
      </span>
    </template>
    <template #default="{ isActive }">
      <div class="bg-white px-4 py-4 rounded">
        <h2 class="mb-4">
          {{ customerForm?.id ? "تعديل العميل  " : "إضافة عميل جديد" }}
        </h2>
        <v-form @submit.prevent="saveCustomer($event, isActive)">
          <v-text-field
            v-model="customerForm.name"
            :disabled="saving"
            variant="outlined"
            :rules="[requiredRule]"
            color="primary"
            label="اسم العميل"
          ></v-text-field>
          <v-text-field
            v-model="customerForm.phone"
            variant="outlined"
            type="number"
            :rules="[requiredRule]"
            :disabled="saving"
            color="primary"
            label="رقم هاتف العميل"
          ></v-text-field>
          <div class="d-flex ga-3">
            <v-btn :loading="saving" flat type="submit" color="success"
              ><v-icon icon="mdi-content-save" />حفظ</v-btn
            >
            <v-btn
              @click="isActive.value = false"
              flat
              :disabled="saving"
              color="black"
              variant="outlined"
              >إلغاء</v-btn
            >
          </div>
        </v-form>
      </div>
    </template>
  </v-dialog>
</template>

<script setup>
const props = defineProps(["edit", "refresher"]);
const emit = defineEmits(["done"]);
const customerFormState = ref(false);
const customersStore = useCustomersStore();
const customerForm = ref({
  name: "",
  price: 0,
  cost_price: 0,
  count: 0,
});
const saving = ref(false);
async function saveCustomer(validator, isActive) {
  const { valid } = await validator;
  if (!valid) return;
  saving.value = true;
  let id = customerForm.value.id;
  if (customerForm.value.id) {
    await customersStore.updateCustomer(customerForm.value.id, {
      ...customerForm.value,
    });
  } else {
    const res = await customersStore.addCustomer({ ...customerForm.value });
    id = res?.id;
  }
  await props.refresher();
  emit(
    "done",
    customersStore.list.find((c) => c.id == id)
  );
  customerForm.value = {
    name: "",
    phone: null,
  };
  saving.value = false;
  isActive.value = false;
}
watch(
  () => props.edit,
  () => {
    if (props.edit) {
      customerForm.value = {
        ...props.edit,
      };
    }
  }
);
if (props.edit) {
  customerForm.value = {
    ...props.edit,
  };
}
</script>
