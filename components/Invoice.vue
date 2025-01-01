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
        <img src="/logo.png" alt="app logo" width="130px" />
      </div>
      <div>
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
        <div v-if="invoiceData.old_money">
          <strong>القديم</strong> {{ formatePrice(invoiceData.old_money) }}
        </div>
        <div><strong>الإجمالي</strong> {{ formatePrice(calcTotal()) }}</div>
      </div>
    </div>
    <div class="d-flex mt-4 ga-3 justify-between">
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
    return {
      عدد: prod.product_quantity || "",
      البيان: prod.product?.name || "",
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
    Number(props.invoiceData.old_money || 0) +
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
      customer_name: props.invoiceData.customer?.name,
      customer_phone: props.invoiceData.customer?.phone,
      date: time,
      debt: props.invoiceData.old_money,
      delivery_price: props.invoiceData.delivery_price,
      total: calcTotal(),
      products: props.invoiceData.products.map((prod) => {
        return {
          cost_price: prod.product?.cost_price,
          name: prod.product?.name,
          price: prod.product_price,
          quantity: prod.product_quantity,
        };
      }),
    });
  }
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
function saveInvoice() {
  saving.value = true;
  setTimeout(() => {
    saving.value = false;
  }, 1000);
}
</script>
