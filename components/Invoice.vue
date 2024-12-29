<template>
  <div id="invoice-data" class="invoice">
    <div>
      <div class="d-flex align-center justify-between">
        <div>
          <div>
            <strong> الاسم/ </strong>
            {{ invoiceData.customer?.name }}
          </div>
          <div>
            <strong> الهاتف/ </strong>
            {{ invoiceData.phone }}
          </div>
        </div>
          <img src="/logo.png" alt="app logo" width="130px">
      </div>
      <div >
          <strong> الوقت/ </strong>
          {{ formatDate(invoiceData.date) }} {{ formatTime12Hour(invoiceData.time) }}
      </div>
      <v-data-table
        disable-sort
        :items-per-page="100000"
        :items="mappedProducts"
        hide-default-footer
      >
      </v-data-table>
      <div class="footer">
        <div v-if="invoiceData.delivery_price">
          <strong>التوصيل</strong> {{ formatePrice(invoiceData.delivery_price) }}
        </div>
        <div v-if="invoiceData.old_money">
          <strong>القديم</strong> {{ formatePrice(invoiceData.old_money) }}
        </div>
        <div>
          <strong>الإجمالي</strong> {{ formatePrice(calcTotal()) }}
        </div>
      </div>
    </div>
    <div class="d-flex ga-3 justify-between">
      <v-btn
        flat
        @click="startPrint"
        :loading="printing"
        class="mt-4"
        style="width: 48%;"
        color="success"
        prepend-icon="mdi-printer"
        >طباعة </v-btn
      ><v-btn
        flat
        @click="saveInvoice"
        :loading="saving"
        class="mt-4"
        style="width: 48%;"
        color="primary"
        prepend-icon="mdi-content-save"
        >حفظ
      </v-btn>
    </div>
  </div>
</template>

<script setup>
const props = defineProps(["invoiceData"]);
const { formatDate, formatTime12Hour, formatePrice, useDownloadPDF } =
  useHelpers();
const printing = ref(false);
const saving = ref(false);
const mappedProducts = computed(() => {
  return props.invoiceData?.products.map((prod, index) => {
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
const calcTotalOfForm = (form) => {
  if (form.product_price && form.product_quantity) {
    return Number(form.product_price) * Number(form.product_quantity);
  } else return 0;
};
function calcTotal() {
  return Number(
    props.invoiceData?.products
      .map((el) => Number(el.product_price) * Number(el.product_quantity))
      .reduce((prev, current) => prev + current, 0) || 0
  ) + Number(props.invoiceData.old_money||0)+Number(props.invoiceData.delivery_price||0)
}
async function startPrint() {
  printing.value = true;
  setTimeout(async () => {
    await useDownloadPDF(
      "invoice-data",
      `فاتورة ${props.invoiceData?.customer?.name || ""} - ${formatDate(
        props.invoiceData?.date
      )} ${formatTime12Hour(props.invoiceData?.time)}`
    );
    printing.value = false;
  }, 100);
}
function saveInvoice(){
    saving.value = true;
    setTimeout(() => {
    saving.value = false;
    }, 1000);
}
</script>
