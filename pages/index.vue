<template>
  <div class="invoice-creator-view">
    <div class="app">
      <div class="form">
        <v-form>
          <v-row>
            <v-col cols="12" lg="4">
              <v-autocomplete
                item-title="name"
                variant="outlined"
                return-object
                :items="customerList"
                label="اسم العميل"
                placeholder="اسم العميل"
                :loading="loadingCustomers"
                clearable
                @update:model-value="
                  (cus) => {
                    invoiceData.customer_phone = cus?.phone;
                    invoiceData.customer_name = cus?.name;
                  }
                "
              >
                <template #prepend-inner>
                  <FormsCustomer
                    :refresher="loadCustomers"
                    @done="
                      (cus) => {
                        invoiceData.customer_name = cus?.name;
                        invoiceData.customer_phone = cus?.phone;
                      }
                    "
                  >
                    <v-icon v-ripple class="cursor-pointer" icon="mdi-plus" />
                  </FormsCustomer>
                </template>
              </v-autocomplete>
            </v-col>
            <v-col cols="12" lg="4">
              <v-text-field
                variant="outlined"
                v-model="invoiceData.customer_phone"
                label="رقم هاتف العميل"
                placeholder="رقم هاتف العميل"
                type="number"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="4">
              <v-text-field
                variant="outlined"
                v-model="invoiceData.debt"
                label="قديم"
                placeholder="قديم"
                type="number"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="4">
              <v-text-field
                variant="outlined"
                v-model="invoiceData.delivery_price"
                label="التوصيل"
                placeholder="التوصيل"
                type="number"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="4">
              <v-menu :close-on-content-click="false">
                <template #activator="{ props }">
                  <v-text-field
                    v-bind="props"
                    readonly
                    :model-value="formatDate(invoiceData.date)"
                    variant="outlined"
                    label="التاريخ"
                  >
                    <template #append-inner>
                      <v-btn
                        size="30"
                        @click="invoiceData.date = new Date()"
                        flat
                      >
                        <v-icon icon="mdi-restore" />
                      </v-btn>
                    </template>
                  </v-text-field>
                </template>
                <v-date-picker
                  variant="outlined"
                  hide-header
                  lang="ar"
                  v-model="invoiceData.date"
                  label="التاريخ"
                ></v-date-picker>
              </v-menu>
            </v-col>
            <v-col cols="12" lg="4">
              <v-menu :close-on-content-click="false">
                <template #activator="{ props }">
                  <v-text-field
                    v-bind="props"
                    readonly
                    :model-value="formatTime12Hour(invoiceData.time)"
                    variant="outlined"
                    label="الوقت"
                  >
                    <template #append-inner>
                      <v-btn
                        size="30"
                        @click="invoiceData.time = new Date()"
                        flat
                      >
                        <v-icon icon="mdi-restore" />
                      </v-btn>
                    </template>
                  </v-text-field>
                </template>
                <v-time-picker
                  variant="outlined"
                  scrollable
                  ampm-in-title
                  lang="ar"
                  v-model="invoiceData.time"
                ></v-time-picker>
              </v-menu>
            </v-col>
          </v-row>
          <v-row v-for="(form, index) in invoiceData.products">
            <v-col cols="12" lg="3">
              <v-autocomplete
                item-title="name"
                variant="outlined"
                return-object
                :items="productsList"
                :loading="loadingProds"
                @update:model-value="
                  (prod) => {
                    form.product_price = prod?.price;
                    form.product_cost_price = prod?.cost_price;
                    form.product_name = prod?.name;
                  }
                "
                label="المنتج"
                clearable
                placeholder=" المنتج"
              >
                <template #prepend-inner>
                  <FormsProduct
                    :refresher="loadProds"
                    @done="
                      (prod) => {
                        form.product_name = prod?.name;
                        form.product_price = prod?.price;
                        form.product_cost_price = prod?.cost_price;
                      }
                    "
                  >
                    <v-icon v-ripple class="cursor-pointer" icon="mdi-plus" />
                  </FormsProduct>
                </template>
              </v-autocomplete>
            </v-col>
            <v-col cols="12" lg="2">
              <v-text-field
                variant="outlined"
                v-model="form.option"
                label="خيار معين"
                placeholder="خيار معين"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="2">
              <v-text-field
                variant="outlined"
                v-model="form.product_quantity"
                label="كمية المنتج"
                placeholder="كمية المنتج"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="2">
              <v-text-field
                variant="outlined"
                v-model="form.product_price"
                label="سعر المنتج"
                placeholder="سعر المنتج"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="2">
              <v-text-field
                readonly
                variant="outlined"
                :model-value="formatePrice(calcTotalOfForm(form))"
                label="الأجمالي"
                placeholder="الأجمالي"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="1">
              <v-btn
                @click="invoiceData.products.splice(index, 1)"
                flat
                color="error"
                variant="tonal"
                class="mt-2"
              >
                <v-icon icon="mdi-delete-outline" size="30" />
              </v-btn>
            </v-col>
          </v-row>
          <v-btn color="success" flat @click="addNewForm">إضافة منتج </v-btn>
        </v-form>
      </div>
      <Invoice @reset="resetInvoice" :invoice-data="invoiceData" />
    </div>
  </div>
</template>
<script setup>
definePageMeta({
  title: "إنشاء فاتورة",
});
const { formatDate, formatTime12Hour, formatePrice, useDownloadPDF } =
  useHelpers();
const products = useProductsStore();
const customers = useCustomersStore();
const loadingCustomers = ref(false);
const loadingProds = ref(false);
const productsList = computed(() => {
  return [...products.list];
});
const customerList = computed(() => {
  return [...customers.list];
});

const invoiceData = ref({
  customer_name: null,
  customer_phone: null,
  debt: null,
  delivery_price: null,
  products: [
    {
      product_name: "",
      product_price: 0,
      product_cost_price: 0,
      product_quantity: 1,
      total: 0,
      option: "",
    },
  ],
  date: new Date(),
  time: new Date(),
});
function resetInvoice() {
  invoiceData.value = {
    customer_name: null,
    customer_phone: null,
    debt: null,
    delivery_price: null,
    products: [
      {
        product_name: "",
        product_price: 0,
        product_quantity: 1,
        product_cost_price: 0,
        total: 0,
        option: "",
      },
    ],
    date: new Date(),
    time: new Date(),
  };
}
const calcTotalOfForm = (form) => {
  if (form.product_price && form.product_quantity) {
    return Number(form.product_price) * Number(form.product_quantity);
  } else return 0;
};
async function loadCustomers() {
  loadingCustomers.value = true;
  await customers.fetchCustomers();
  loadingCustomers.value = false;
}
async function loadProds() {
  loadingProds.value = true;
  await products.fetchProducts();
  loadingProds.value = false;
}
loadProds();
loadCustomers();
function addNewForm() {
  invoiceData.value.products.push({
    product_name: "",
    product_price: 0,
    product_quantity: 1,
    product_cost_price: 0,
    total: 0,
    option: "",
  });
}
</script>
