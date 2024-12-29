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
                v-model="invoiceData.customer"
                :items="customerList"
                label="اسم العميل"
                placeholder="اسم العميل"
                :loading="loadingCustomers"
                clearable
                @update:model-value="
                  invoiceData.phone = invoiceData.customer?.phone
                "
              >
                <template #prepend-inner>
                  <FormsCustomer
                    :refresher="loadCustomers"
                    @done="
                      (cus) => {
                        invoiceData.customer = cus;
                        invoiceData.phone = cus?.phone;
                      }
                    "
                  >
                    <v-btn v-tooltip="'إضافة عميل جديد'" flat
                      ><v-icon icon="mdi-plus"
                    /></v-btn>
                  </FormsCustomer>
                </template>
              </v-autocomplete>
            </v-col>
            <v-col cols="12" lg="4">
              <v-text-field
                variant="outlined"
                v-model="invoiceData.phone"
                label="رقم هاتف العميل"
                placeholder="رقم هاتف العميل"
                type="number"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="4">
              <v-text-field
                variant="outlined"
                v-model="invoiceData.old_money"
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
            <v-col cols="12" lg="5">
              <v-autocomplete
                item-title="name"
                variant="outlined"
                return-object
                v-model="form.product"
                :items="productsList"
                :loading="loadingProds"
                @update:model-value="form.product_price = form.product?.price"
                label="اسم المنتج"
                clearable
                placeholder="اسم المنتج"
              >
                <template #prepend-inner>
                  <FormsProduct
                    :refresher="loadProds"
                    @done="
                      (prod) => {
                        form.product = prod;
                        form.product_price = prod?.price;
                      }
                    "
                  >
                    <v-btn v-tooltip="'إضافة منتج جديد'" flat
                      ><v-icon icon="mdi-plus"
                    /></v-btn>
                  </FormsProduct>
                </template>
              </v-autocomplete>
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
      <Invoice :invoice-data="invoiceData" />
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
  customer: null,
  phone: null,
  old_money: null,
  delivery_price: null,
  products: [
    {
      product: "",
      product_price: 0,
      product_quantity: 0,
      total: 0,
      customer_name: "",
      date: "",
      time: "",
      phone: "",
    },
  ],
  date: new Date(),
  time: new Date(),
});

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
    product: "",
    product_price: 0,
    product_quantity: 0,
    total: 0,
    customer_name: "",
    date: "",
    time: "",
    phone: "",
  });
}
</script>
