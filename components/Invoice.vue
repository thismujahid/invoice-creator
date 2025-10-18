<template>
  <div id="invoice-data" class="invoice">
    <v-alert
      color="warning"
      variant="tonal"
      v-if="invoiceData.id && !viewMode"
      class="mb-3"
    >
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
        :style="viewMode ? '' : `max-height: 60vh; overflow: auto;`"
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
            <strong
              >الخصم
              {{
                invoiceData.discount_for ? `(${invoiceData.discount_for})` : ""
              }}
              /</strong
            >
            {{
              invoiceData.discount_percentage
                ? `${invoiceData.discount}%`
                : formatePrice(invoiceData.discount)
            }}
          </div>
          <div>
            <strong
              >الإجمالي {{ invoiceData.discount ? "النهائي" : "" }}/</strong
            >
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
          @click="() => startPrint()"
          :loading="printing"
          style="width: 48%"
          color="success"
          prepend-icon="mdi-printer"
          >{{
            props.invoiceData.id && !viewMode
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
      <v-snackbar
        @update:model-value="(v) => (!v ? (snackBarText = {}) : false)"
        location="top end"
        color="primary"
        z-index="999999"
        :model-value="snackBarText && snackBarText.text ? true : false"
        :timeout="5000"
      >
        <v-progress-circular
          v-if="snackBarText && snackBarText.loading"
          indeterminate
          size="20"
          width="2"
        />

        {{ snackBarText ? snackBarText.text : "" }}
      </v-snackbar>
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
    let quantity = prod.product_quantity || "";
    if (prod.product_quantity == 0.5) {
      quantity = "1/2";
    } else if (prod.product_quantity == 0.25) {
      quantity = "1/4";
    } else if (prod.product_quantity == 0.75) {
      quantity = "3/4";
    }
    return {
      عدد: quantity,
      البيان:
        (prod.product_name || "") + (prod.option ? ` (${prod.option})` : ""),
      تصحيح: "",
      "سعر الوحدة": formatePrice(prod.product_price || 0),
      الإجمالي: formatePrice(calcTotalOfForm(prod)),
    };
  });
});
const snackBarText = ref();
const calcTotalOfForm = (form) => {
  if (form.product_price && form.product_quantity) {
    return Number(form.product_price) * Number(form.product_quantity);
  } else return 0;
};

async function startPrint(saveOnly) {
  if (!props.invoiceData.customer_name) {
    alert("شكلك نسيت تحدد عميل... مينفعش تحفظ فاتورة ملهاش عميل");
    return true;
  }
  if (
    !props.invoiceData.products[props.invoiceData.products.length - 1] ||
    !props.invoiceData.products[props.invoiceData.products.length - 1]
      .product_id
  ) {
    if (props.invoiceData.products.length === 1) {
      alert("مينفعش تحفظ فاتورة فاضية");
    } else {
      alert(
        "أخر عنصر في الفاتورة مش متحدد فيه منتج حدد منتج أو شيل العنصر لو مش محتاجه"
      );
    }
    return true;
  }
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
  printing.value = saveOnly ? false : true;
  delete props.invoiceData.order;
  if (!props.viewMode) {
    snackBarText.value = {
      loading: true,
      text: "جاري حفظ الفاتورة",
    };
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
  if (!saveOnly) {
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
  snackBarText.value = {
    loading: false,
    text: "تم حفظ الفاتورة بنجاح",
  };
}
const discountAmount = computed(() => {
  if (props.invoiceData.discount && props.invoiceData.discount_percentage) {
    return (calcTotal(props.invoiceData) * props.invoiceData.discount) / 100;
  } else return props.invoiceData.discount || 0;
});
function handleCtrlPlusS(e) {
  if (e && e.ctrlKey && e.keyCode === 83) {
    e.preventDefault();
    startPrint(true);
  }
}
onMounted(() => {
  window.addEventListener("keydown", handleCtrlPlusS);
});
onUnmounted(() => {
  window.removeEventListener("keydown", handleCtrlPlusS);
});
</script>
