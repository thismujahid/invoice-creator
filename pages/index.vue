<template>
  <div class="invoice-creator-view">
    <div class="app">
      <div class="form">
        <div
          v-if="invoiceData.id"
          class="invoice-actions d-flex mb-4 justify-end ga-4"
        >
          <v-btn
            color="success"
            :loading="updating"
            prepend-icon="mdi-update"
            flat
            @click="updateInvoiceData"
          >
            تحديث الفاتورة
          </v-btn>
        </div>
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
                :model-value="
                  invoiceData.customer_phone
                    ? {
                        phone: invoiceData.customer_phone,
                        name: invoiceData.customer_name,
                      }
                    : undefined
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
                label="القديم"
                placeholder="القديم"
                type="number"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="4">
              <v-text-field
                variant="outlined"
                v-model="invoiceData.amount_of_mahros"
                label="محروس"
                placeholder="محروس"
                type="number"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="4">
              <v-text-field
                variant="outlined"
                v-model="invoiceData.amount_of_animal_feeds"
                label="العلف"
                placeholder="العلف"
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
              <v-text-field
                variant="outlined"
                v-model="invoiceData.discount"
                :label="`الخصم (${
                  invoiceData.discount_percentage ? 'نسبة مئوية' : 'مبلغ ثابت'
                })`"
                placeholder="الخصم"
                type="number"
              >
                <template #append-inner>
                  <v-btn
                    icon
                    flat
                    v-tooltip="'نوع الخصم (نسبة مئؤية % أم مبلغ ثابت)'"
                    color="primary"
                    @click="
                      invoiceData.discount_percentage =
                        !invoiceData.discount_percentage
                    "
                  >
                    <v-icon
                      icon="mdi-percent"
                      size="20"
                      v-if="invoiceData.discount_percentage"
                    />
                    <v-icon
                      icon="mdi-cash"
                      size="40"
                      v-if="!invoiceData.discount_percentage"
                    />
                  </v-btn>
                </template>
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="2">
              <v-text-field
                variant="outlined"
                v-model="invoiceData.discount_for"
                label="الخصم متعلق بـ"
                placeholder="الخصم متعلق بـ"
              >
              </v-text-field>
            </v-col>
            <v-col cols="12" lg="3">
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
            <v-col cols="12" lg="3">
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
          <div
            ref="containerRef"
            class="py-4 px-3"
            style="
              max-height: 50vh !important;
              overflow-y: auto;
              overflow-x: hidden;
            "
          >
            <v-row
              v-for="(form, index) in invoiceData.products"
              :key="'product-line-' + index"
            >
              <v-col cols="12" lg="3">
                <v-autocomplete
                  item-title="name"
                  variant="outlined"
                  return-object
                  :items="productsList"
                  :loading="loadingProds"
                  :model-value="
                    form.product_id
                      ? {
                          id: form.product_id,
                          name: form.product_name,
                          price: form.product_price,
                          cost_price: form.product_cost_price,
                        }
                      : undefined
                  "
                  @update:model-value="
                    (prod) => {
                      form.product_price = prod?.price;
                      form.product_id = prod?.id;
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
                          form.product_id = prod?.id;
                        }
                      "
                    >
                      <v-icon v-ripple class="cursor-pointer" icon="mdi-plus" />
                    </FormsProduct>
                  </template>
                </v-autocomplete>
              </v-col>
              <v-col cols="12" lg="3">
                <v-text-field
                  variant="outlined"
                  v-model="form.option"
                  label="خيار معين"
                  placeholder="خيار معين"
                >
                </v-text-field>
              </v-col>
              <v-col cols="12" lg="1">
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
                  <template #append-inner>
                    <div
                      v-if="form.product_cost_price"
                      style="text-wrap: nowrap"
                    >
                      التكلفة ({{ form.product_cost_price }})
                    </div>
                  </template>
                </v-text-field>
              </v-col>
              <v-col cols="12" lg="1">
                <v-text-field
                  readonly
                  variant="outlined"
                  :model-value="formatePrice(calcTotalOfForm(form))"
                  label="الإجمالي"
                  placeholder="الإجمالي"
                >
                </v-text-field>
              </v-col>
              <v-col cols="12" lg="1">
                <v-text-field
                  variant="outlined"
                  :model-value="index"
                  label="الترتيب"
                  placeholder="الترتيب"
                  @update:model-value="(v) => (form.order = v)"
                  @keydown.enter="
                    moveIndexToNewValue(index, form.order);
                    form.order = null;
                  "
                >
                </v-text-field>
              </v-col>
              <v-col cols="3" lg="1">
                <v-btn
                  @click="removeElementIndex(index)"
                  flat
                  color="error"
                  variant="tonal"
                >
                  <v-icon icon="mdi-delete-outline" size="30" />
                </v-btn>
              </v-col>
            </v-row>
          </div>

          <v-col cols="9" lg="12">
            <v-btn color="success" block flat @click="addNewForm"
              >إضافة منتج
            </v-btn>
          </v-col>
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
const { formatDate, formatTime12Hour, formatePrice } = useHelpers();
const products = useProductsStore();
const { onDocChange } = useFirebase();
const invoices = useInvoicesStore();
const customers = useCustomersStore();
const updating = ref(false);
const loadingCustomers = ref(false);
const loadingProds = ref(false);
const containerRef = ref();
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
  discount_percentage: false,
  discount: null,
  discount_for: null,
  amount_of_animal_feeds: null,
  amount_of_mahros: null,
  products: [
    {
      product_name: "",
      product_price: 0,
      product_cost_price: 0,
      product_quantity: 1,
      total: 0,
      option: "",
      product_id: "",
    },
  ],
  date: new Date(),
  time: new Date(),
});
function resetInvoice() {
  invoiceData.value = {
    customer_name: null,
    customer_phone: null,
    discount: null,
    discount_percentage: false,
    discount_for: null,
    debt: null,
    delivery_price: null,
    products: [
      {
        product_name: "",
        product_price: 0,
        product_quantity: 1,
        product_cost_price: 0,
        total: 0,
        product_id: "",
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
async function loadProds(updatePrices) {
  loadingProds.value = true;
  await products.fetchProducts();
  if (updatePrices) {
    updateProdsPrices();
  }
  loadingProds.value = false;
}
const scrollToBottom = () => {
  if (containerRef.value) {
    containerRef.value.scrollTop = containerRef.value.scrollHeight;
  }
};
loadProds();
loadCustomers();
watch(
  () => invoiceData.value.products,
  async () => {
    await nextTick();
    scrollToBottom();
  },
  { deep: true }
);
function moveIndexToNewValue(from, to) {
  if (typeof from !== "number") return;
  if (!to) return;
  if (invoiceData.value.products.length < Number(to)) {
    return;
  }
  const product = invoiceData.value.products.find(
    (_el, index) => index == from
  );
  if (product) {
    invoiceData.value.products.splice(from, 1);
    invoiceData.value.products.splice(to, 0, product);
  }
}
function addNewForm() {
  invoiceData.value.products.push({
    product_name: "",
    product_price: 0,
    product_quantity: 1,
    product_cost_price: 0,
    product_id: "",
    total: 0,
    option: "",
  });
}
const reBuild = ref(false);
function removeElementIndex(index) {
  reBuild.value = true;
  invoiceData.value.products = invoiceData.value.products.filter(
    (p, i) => i !== index
  );
  setTimeout(() => {
    reBuild.value = false;
  }, 200);
}
function updateProdsPrices() {
  for (let index = 0; index < invoiceData.value.products.length; index++) {
    const element = invoiceData.value.products[index];
    const currentProduct = productsList.value.find(
      (prod) => prod.id == element.product_id
    );
    if (currentProduct) {
      element.product_price = currentProduct.price;
      element.product_cost_price = currentProduct.cost_price;
      element.product_name = currentProduct.name;
    }
  }
}
async function updateInvoiceData() {
  // Update all products in the invoice to the price in the productsList and also update the date to now
  updating.value = true;
  await loadProds();
  invoiceData.value.date = new Date();
  invoiceData.value.time = new Date();
  updateProdsPrices();
  updating.value = false;
}
onMounted(async () => {
  if (invoices.invoiceToEdit) {
    invoiceData.value = {
      ...invoices.invoiceToEdit,
      date: invoices.invoiceToEdit.date
        ? new Date(invoices.invoiceToEdit.date.seconds * 1000)
        : new Date(),
      time: invoices.invoiceToEdit.date
        ? new Date(invoices.invoiceToEdit.date.seconds * 1000)
        : new Date(),
    };
    invoices.invoiceToEdit = undefined;
  }
  const unSubCustomers =await onDocChange("customers", (customers) => {
    loadCustomers();
  });
  const usSubProds = await onDocChange("products", (products) => {
    loadProds(true);
  });
  onUnmounted(() => {
    unSubCustomers();
    usSubProds();
  });
});
</script>
