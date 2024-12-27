<template>
  <div class="invoice-creator-view">
    <div class="app">
      <div class="form">
        <v-form>
          <v-row>
            <v-col cols="12" lg="3">
              <v-autocomplete
                item-title="name"
                variant="outlined"
                return-object
                v-model="invoiceData.customer"
                :items="customerList"
                label="اسم العميل"
                placeholder="اسم العميل"
                clearable
                @update:model-value="
                  invoiceData.phone = invoiceData.customer?.phone
                "
              >
              <template #prepend-inner>
                <v-btn v-tooltip="'إضافة عميل جديد'"  flat><v-icon icon="mdi-plus" /></v-btn>
              </template>
              </v-autocomplete>
            </v-col>
            <v-col cols="12" lg="3">
              <v-text-field
                variant="outlined"
                v-model="invoiceData.phone"
                label="رقم هاتف العميل"
                placeholder="رقم هاتف العميل"
                type="number"
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
          <v-row v-for="(form, index) in invoiceData.products">
            <v-col cols="12" lg="5">
              <v-autocomplete
                item-title="name"
                variant="outlined"
                return-object
                v-model="form.product"
                :items="productsList"
                @update:model-value="form.product_price = form.product?.price"
                label="اسم المنتج"
                placeholder="اسم المنتج"
              >
              <template #prepend-inner>
                <v-btn v-tooltip="'إضافة منتج جديد'"  flat><v-icon icon="mdi-plus" /></v-btn>
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
      <div id="invoice-data" class="invoice">
        <div>
          <div>
            <strong> الاسم/ </strong>
            {{ invoiceData.customer?.name }}
          </div>
          <div>
            <strong> الهاتف/ </strong>
            {{ invoiceData.phone }}
          </div>
          <div class="d-flex align-center justify-between">
            <div>
              <strong> التاريخ/ </strong>
              {{ formatDate(invoiceData.date) }}
            </div>
            <div>
              <strong> الوقت/ </strong>
              {{ formatTime12Hour(invoiceData.time) }}
            </div>
          </div>
          <v-data-table
            disable-sort
            :items-per-page="100000"
            :items="mappedProducts"
            hide-default-footer
          >
          </v-data-table>
          <div class="footer">
            <strong>الإجمالي</strong> {{ formatePrice(calcTotal()) }}
          </div>
        </div>
        <v-btn
          flat
          @click="startPrint"
          block
          :loading="printing"
          class="mt-4"
          color="success"
          prepend-icon="mdi-printer"
          >طباعة
        </v-btn>
      </div>
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
const customers = useCustomers();
const printing = ref(false);
const productsList = computed(() => {
  return [...products.list];
});
const customerList = computed(() => {
  return [...customers.list];
});

const invoiceData = ref({
  customer: null,
  phone: null,
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
const mappedProducts = computed(() => {
  return invoiceData.value.products.map((prod, index) => {
    return {
      م: index + 1,
      البيان: prod.product?.name || "",
      عدد: prod.product_quantity || "",
      تصحيح: "",
      "سعر الوحدة": formatePrice(prod.product_price),
      الإجمالي: formatePrice(calcTotalOfForm(prod)),
    };
  });
});
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
function calcTotal() {
  return (
    invoiceData.value.products
      .map((el) => Number(el.product_price) * Number(el.product_quantity))
      .reduce((prev, current) => prev + current, 0) || ""
  );
}
const calcTotalOfForm = (form) => {
  if (form.product_price && form.product_quantity) {
    return Number(form.product_price) * Number(form.product_quantity);
  } else return 0;
};
async function startPrint() {
  printing.value = true;
  setTimeout(async () => {
    await useDownloadPDF(
      "invoice-data",
      `فاتورة ${invoiceData.value.customer?.name || ""} - ${formatDate(
        invoiceData.value.date
      )} ${formatTime12Hour(invoiceData.value.time)}`
    );
    printing.value = false;
  }, 100);
}
</script>
<style>
.invoice-creator-view .app {
  padding: 30px;
  min-height: 90vh;
  gap: 1.875rem;
  display: flex;
}
.invoice-creator-view .app .invoice {
  border-radius: 5px;
  border: 1px solid gray;
  padding: 10px;
  width: 540px !important;
  position: sticky;
  top: 0;
}
.invoice-creator-view .app .invoice  * {
  font-weight: 400;
  color: rgba(0, 0, 0, 0.781);
}
#invoice-data .v-btn *{
  color: #fff !important;

}
.invoice-creator-view .invoice.printing {
  border: unset;
}
.invoice-creator-view .invoice.printing .v-btn {
  display: none;
}
.invoice-creator-view #invoice-data {
  width: 500px !important;
  max-width: 500px !important;
  width: 100% !important;
}
.invoice-creator-view .v-data-table {
  border-radius: unset !important;
  margin-top: 5px !important;
}
.invoice-creator-view .v-data-table thead tr th {
  border-top: thin solid rgba(0, 0, 0, 0.12) !important;
}
.invoice-creator-view .v-data-table thead tr th,
.invoice-creator-view .v-data-table tbody tr td {
  border-bottom: thin solid rgba(0, 0, 0, 0.12) !important;
}
.invoice-creator-view .v-data-table tbody tr:first-of-type td {
  border-top: unset !important;
}
.invoice-creator-view .v-data-table thead tr th:first-of-type,
.invoice-creator-view .v-data-table tbody tr td:first-of-type {
  border-right: thin solid rgba(0, 0, 0, 0.12) !important;
}
.invoice-creator-view .v-data-table thead tr th:last-of-type,
.invoice-creator-view .v-data-table tbody tr td:last-of-type {
  border-left: thin solid rgba(0, 0, 0, 0.12) !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(1),
.invoice-creator-view .v-data-table tbody tr td:nth-child(1) {
  border-left: thin solid rgba(0, 0, 0, 0.12) !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(2),
.invoice-creator-view .v-data-table tbody tr td:nth-child(2) {
  border-left: thin solid rgba(0, 0, 0, 0.12) !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(3),
.invoice-creator-view .v-data-table tbody tr td:nth-child(3) {
  border-left: thin solid rgba(0, 0, 0, 0.12) !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(4),
.invoice-creator-view .v-data-table tbody tr td:nth-child(4) {
  border-left: thin solid rgba(0, 0, 0, 0.12) !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(5),
.invoice-creator-view .v-data-table tbody tr td:nth-child(5) {
  border-left: thin solid rgba(0, 0, 0, 0.12) !important;
}
.invoice-creator-view .v-data-table__td {
  padding: 0 5px !important;
  height: 30px !important;
}
.invoice-creator-view .v-data-table__td div {
  padding: 0 !important;
}
.invoice-creator-view .invoice .footer {
  border-bottom: thin solid rgba(0, 0, 0, 0.12);
  border-right: thin solid rgba(0, 0, 0, 0.12);
  border-left: thin solid rgba(0, 0, 0, 0.12);
  padding: 5px 5px 5px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.invoice-creator-view .app .form {
  border-radius: 5px;
  border: 1px solid gray;
  padding: 30px;
  width: calc(100% - 530px);
}
</style>
