<template>
  <div id="invoice-data" class="invoice">
    <div>
      <div :class="viewMode?'px-2':''" class="d-flex align-center justify-between">
        <div>
          <div>
            <strong> الاسم/ </strong>
            {{ invoiceData.customer_name }}
          </div>
          <div>
            <strong> الهاتف/ </strong>
            {{ invoiceData.customer_phone }}
          </div>
        </div>
        <img src="/logo.png" alt="app logo" width="130px" />
      </div>
      <div :class="viewMode?'px-2':''">
        <strong> الوقت/ </strong>
        {{ formatDate(invoiceData.date) }}
        {{ formatTime12Hour(invoiceData.time) }}
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
          <strong>التوصيل</strong>
          {{ formatePrice(invoiceData.delivery_price) }}
        </div>
        <div v-if="invoiceData.debt">
          <strong>القديم</strong> {{ formatePrice(invoiceData.debt) }}
        </div>
        <div><strong>الإجمالي</strong> {{ formatePrice(calcTotal()) }}</div>
      </div>
    </div>
    <div :class="viewMode?'px-2':''" class="d-flex mt-4 ga-3 justify-between">
      <v-btn
        flat
        @click="startPrint"
        :loading="printing"
        style="width: 48%"
        color="success"
        prepend-icon="mdi-printer"
        >{{ viewMode ? "طباعة" : "حفظ وطباعة" }}
      </v-btn>
      <v-btn
        v-if="!viewMode"
        color="error"
        flat
        style="width: 48%"
        prepend-icon="mdi-close"
        @click="emit('reset')"
        >إعادة ظبط الفاتورة
      </v-btn>
      <v-btn
        v-if="viewMode"
        color="error"
        flat
        style="width: 48%"
        @click="$emit('close')"
        >إغلاق
      </v-btn>
    </div>
  </div>
</template>

<script setup>
const props = defineProps(["invoiceData", "viewMode"]);
const { formatDate, formatTime12Hour, formatePrice, useDownloadPDF } =
  useHelpers();
const printing = ref(false);
const { saveDataTo } = useFirebase();
const saving = ref(false);
const emit = defineEmits(["reset"]);
const mappedProducts = computed(() => {
  return props.invoiceData?.products.map((prod, index) => {
    console.log("🚀 ~ returnprops.invoiceData?.products.map ~ prod:", prod)
    return {
      عدد: prod.product_quantity || "",
      البيان: (prod.product_name || "") + (prod.option?` (${prod.option})`:""),
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
  return (
    Number(
      props.invoiceData?.products
        .map((el) => Number(el.product_price) * Number(el.product_quantity))
        .reduce((prev, current) => prev + current, 0) || 0
    ) +
    Number(props.invoiceData.debt || 0) +
    Number(props.invoiceData.delivery_price || 0)
  );
}
async function startPrint() {
  let time = new Date();
  if (props.invoiceData.time instanceof Date) {
    time = props.invoiceData.time;
  } else if (
    props.invoiceData.date instanceof Date &&
    typeof props.invoiceData.time === "string"
  ) {
    time = props.invoiceData.date.setHours(
      props.invoiceData.time.split(":")[0],
      props.invoiceData.time.split(":")[1]
    );
  }
  printing.value = true;
  if (!props.viewMode) {
    await saveDataTo("invoices", {
      ...props.invoiceData
    });
  }
  setTimeout(async () => {
    await useDownloadPDF(
      "invoice-data",
      `فاتورة ${props.invoiceData?.customer_name || ""}----${formatDate(
        props.invoiceData?.date
      ).replace(/ /g,'-')}----${formatTime12Hour(props.invoiceData?.time).replace(/ /g,'-')}`
    );
    printing.value = false;
  }, 100);
}
function saveInvoice() {
  saving.value = true;
  setTimeout(() => {
    saving.value = false;
  }, 1000);
}
</script>
