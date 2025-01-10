<template>
  <div id="invoice-data" class="invoice">
    <v-alert color="warning" variant="tonal" v-if="invoiceData.id && !viewMode" class="mb-3">
      <v-icon icon="mdi-file-edit-outline" />
      أنت في وضع التعديل علي فاتورة سابقة
    </v-alert>
    <div>
      <div class="invoice-header">
        <div
          :class="viewMode ? 'px-2' : ''"
          class="d-flex align-center justify-between"
        >
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
        <div :class="viewMode ? 'px-2' : ''">
          <strong> الوقت/ </strong>
          {{ formatDate(invoiceData.date) }}
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
      <div class="invoice-footer">
        <div class="footer">
          <div v-if="invoiceData.debt">
            <strong>القديم/</strong> {{ formatePrice(invoiceData.debt) }}
          </div>
          <div v-if="invoiceData.amount_of_mahros">
            <strong>محروس/</strong>
            {{ formatePrice(invoiceData.amount_of_mahros) }}
          </div>
          <div v-if="invoiceData.amount_of_animal_feeds">
            <strong>العلف/</strong>
            {{ formatePrice(invoiceData.amount_of_animal_feeds) }}
          </div>
          <div v-if="invoiceData.delivery_price">
            <strong>التوصيل/</strong>
            {{ formatePrice(invoiceData.delivery_price) }}
          </div>
          <div v-if="invoiceData.discount">
            <strong>الإجمالي/</strong>
              {{ formatePrice(calcTotal(invoiceData)) }}
          </div>
          <div v-if="invoiceData.discount">
            <strong>الخصم/</strong>
              {{ invoiceData.discount_percentage?`${invoiceData.discount}%`:formatePrice(invoiceData.discount) }}
          </div>
          <div>
            <strong>الإجمالي {{invoiceData.discount?'النهائي':''}}/</strong>
               {{ formatePrice(calcTotal(invoiceData) - discountAmount) }}
          </div>
        </div>
      </div>
      <div
        :class="viewMode ? 'px-2' : ''"
        class="d-flex mt-4 ga-3 pb-2 justify-between"
      >
        <v-btn
          flat
          @click="startPrint"
          :loading="printing"
          style="width: 48%"
          color="success"
          prepend-icon="mdi-printer"
          >{{
            props.invoiceData.id
              ? "طباعة وحفظ التعديل"
              : viewMode
              ? "طباعة"
              : "حفظ وطباعة"
          }}
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
  </div>
</template>

<script setup>
const props = defineProps(["invoiceData", "viewMode"]);
const {
  formatDate,
  calcTotal,
  formatTime12Hour,
  formatePrice,
  useDownloadPDF,
} = useHelpers();
const printing = ref(false);
const { saveDataTo, updateItem } = useFirebase();
const emit = defineEmits(["reset"]);
const mappedProducts = computed(() => {
  return props.invoiceData?.products.map((prod, index) => {
    return {
      عدد: prod.product_quantity || "",
      البيان:
        (prod.product_name || "") + (prod.option ? ` (${prod.option})` : ""),
      تصحيح: "",
      "سعر الوحدة": formatePrice(prod.product_price||0),
      الإجمالي: formatePrice(calcTotalOfForm(prod)),
    };
  });
});
const calcTotalOfForm = (form) => {
  if (form.product_price && form.product_quantity) {
    return Number(form.product_price) * Number(form.product_quantity);
  } else return 0;
};

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
  delete props.invoiceData.order;
  if (!props.viewMode) {
    if (props.invoiceData.id) {
      const data = {
        ...props.invoiceData,
      };
      delete data.id;
      await updateItem("invoices", props.invoiceData.id, data);
    } else {
      const response = await saveDataTo("invoices", {
        ...props.invoiceData,
      });
      props.invoiceData.id = response.id;
    }
  }
  setTimeout(async () => {
    await useDownloadPDF(
      "invoice-data",
      `فاتورة ${props.invoiceData?.customer_name || ""}----${formatDate(
        props.invoiceData?.date
      ).replace(/ /g, "-")}----${formatTime12Hour(
        props.invoiceData?.time
      ).replace(/ /g, "-")}`
    );
    printing.value = false;
  }, 100);
}
const discountAmount = computed(()=>{
  if(props.invoiceData.discount && props.invoiceData.discount_percentage){
    return (calcTotal(props.invoiceData) * props.invoiceData.discount) / 100
  }else return props.invoiceData.discount||0
})
</script>
