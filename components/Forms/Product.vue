<template>
  <v-dialog
    @update:model-value="(v) => (v ? false : emit('close'))"
    persistent
    max-width="350px"
    v-model="productFormState"
  >
    <template #activator="{ props }">
      <span v-bind="props">
        <slot></slot>
      </span>
    </template>
    <template #default="{ isActive }">
      <div class="bg-white px-4 py-4 rounded">
        <h2 class="mb-4">
          {{ productForm?.id ? "تعديل المنتج" : "إضافة منتج جديد" }}
        </h2>
        <v-form @submit.prevent="saveProduct($event, isActive)">
          <v-text-field
            v-model="productForm.name"
            variant="outlined"
            color="primary"
            :disabled="saving"
            hide-details="auto"
            :rules="[requiredRule]"
            label="اسم المنتج"
          ></v-text-field>
          <v-text-field
            v-model="productForm.cost_price"
            :rules="[requiredRule]"
            variant="outlined"
            color="primary"
            label="سعر التكلفة"
            :disabled="saving"
            v-if="!hideCost"
            type="number"
            hide-details="auto"
          ></v-text-field>
          <v-alert
            v-if="hideCost"
            class="mb-3"
            color="warning"
            variant="tonal"
            density="compact"
          >
            <small>
              تم إخفاء حقل سعر التكلفة، إذا كنت تريد تعديل سعر التكلفة قم بعرض
              القيمة أولاً <br /><slot name="cost-input-place"></slot>
            </small>
          </v-alert>
          <v-text-field
            v-model="productForm.price"
            type="number"
            variant="outlined"
            color="primary"
            :rules="[requiredRule]"
            :disabled="saving"
            hide-details="auto"
            label="سعر البيع"
          ></v-text-field>
          <v-text-field
            v-model="productForm.count"
            variant="outlined"
            color="primary"
            type="number"
            label="العدد"
            :disabled="saving"
            hide-details="auto"
          ></v-text-field>
          <div class="d-flex ga-3">
            <v-btn :loading="saving" flat type="submit" color="success"
              ><v-icon icon="mdi-content-save" />حفظ</v-btn
            >
            <v-btn
              @click="isActive.value = false"
              flat
              :disabled="saving"
              hide-details="auto"
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
const props = defineProps(["edit", "refresher", "hideCost"]);
const emit = defineEmits(["done", "close"]);
const productFormState = ref(false);
const productsStore = useProductsStore();
const auth = useAuth();
const productForm = ref({
  name: "",
  price: null,
  cost_price: null,
  count: null,
});
const saving = ref(false);
async function saveProduct(validator, isActive) {
  validator.then(async (res) => {
    const isAdded = productsStore.list.find(
      (prod) => prod.name === productForm.value.name
    );
    if (isAdded && !productForm.value?.id) {
      auth.snackBarText = "تمت إضافة منتج بنفس الإسم من قبل";
      authStore.snackBarColor = "error";
      return;
    }
    if (!res?.valid) return;
    saving.value = true;
    let id = productForm.value?.id;
    if (productForm.value?.id) {
      await productsStore.updateProduct(productForm.value.id, {
        ...productForm.value,
      });
    } else {
      const res = await productsStore.addProduct({
        ...productForm.value,
      });
      id = res?.id;
    }
    await props.refresher();
    emit(
      "done",
      productsStore.list.find((prod) => prod.id == id)
    );
    saving.value = false;
    productForm.value = {
      name: "",
      price: 0,
      cost_price: 0,
      count: 0,
    };
    isActive.value = false;
  });
}
watch(
  () => props.edit,
  () => {
    if (props.edit) {
      productForm.value = {
        ...props.edit,
      };
    } else {
      productForm.value = {
        name: "",
        price: null,
        cost_price: null,
        count: null,
      };
    }
  }
);
if (props.edit) {
  productForm.value = {
    ...props.edit,
  };
} else {
  productForm.value = {
    name: "",
    price: null,
    cost_price: null,
    count: null,
  };
}
</script>
