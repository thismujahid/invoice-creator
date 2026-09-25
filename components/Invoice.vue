<template>
  <div id="invoice-data" class="rounded-lg border border-gray-300 bg-white p-2.5 text-[13px] leading-relaxed">
    <UAlert
      v-if="invoiceData.id && !viewMode"
      color="warning"
      variant="soft"
      icon="i-lucide-file-pen-line"
      title="أنت في وضع التعديل علي فاتورة سابقة"
      class="no-print mb-2"
    />
    <div>
      <div class="sticky top-0 z-10 bg-white pb-1">
        <div class="flex items-center justify-between gap-2 px-1">
          <div class="min-w-0">
            <div><strong> الاسم/ </strong>{{ invoiceData.customer_name }}</div>
            <div><strong> الهاتف/ </strong><span dir="ltr">{{ invoiceData.customer_phone }}</span></div>
          </div>
          <img src="/logo.png" alt="app logo" width="110px" />
        </div>
        <div class="px-1 text-gray-500">
          <strong> الوقت/ </strong>
          {{ formatDate(invoiceData.date) }}
          {{ formatTime12Hour(invoiceData.time) }}
        </div>
      </div>
      <table class="inv-table w-full">
        <thead>
          <tr>
            <th class="w-10">عدد</th>
            <th>البيان</th>
            <th class="w-12">تصحيح</th>
            <th class="w-20">سعر الوحدة</th>
            <th class="w-20">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in mappedProducts" :key="i">
            <td>{{ row.عدد }}</td>
            <td class="text-start">{{ row.البيان }}</td>
            <td>{{ row.تصحيح }}</td>
            <td>{{ row["سعر الوحدة"] }}</td>
            <td class="font-semibold">{{ row.الإجمالي }}</td>
          </tr>
        </tbody>
      </table>
      <div class="sticky bottom-0 z-10 bg-white pt-1">
        <div class="inv-footer">
          <div v-if="invoiceData.debt"><strong>القديم/</strong> <span>{{ formatePrice(invoiceData.debt) }}</span></div>
          <div v-if="invoiceData.amount_of_mahros"><strong>محروس/</strong> <span>{{ formatePrice(invoiceData.amount_of_mahros) }}</span></div>
          <div v-if="invoiceData.amount_of_animal_feeds"><strong>العلف/</strong> <span>{{ formatePrice(invoiceData.amount_of_animal_feeds) }}</span></div>
          <div v-if="invoiceData.delivery_price"><strong>التوصيل/</strong> <span>{{ formatePrice(invoiceData.delivery_price) }}</span></div>
          <div v-if="invoiceData.discount">
            <strong>الإجمالي/</strong> <span>{{ formatePrice(calcTotal(invoiceData)) }}</span>
          </div>
          <div v-if="invoiceData.discount">
            <strong>الخصم {{ invoiceData.discount_for ? `(${invoiceData.discount_for})` : "" }}/</strong>
            <span>{{ invoiceData.discount_percentage ? `${invoiceData.discount}%` : formatePrice(invoiceData.discount) }}</span>
          </div>
          <div class="text-sm font-bold">
            <strong>الإجمالي {{ invoiceData.discount ? "النهائي" : "" }}/</strong>
            <span>{{ formatePrice(calcTotal(invoiceData) - discountAmount) }}</span>
          </div>
        </div>
      </div>
      <div class="no-print mt-3 flex gap-2 pb-1">
        <UButton
          class="min-h-11 flex-1"
          size="lg"
          color="success"
          icon="i-lucide-printer"
          :loading="printing"
          @click="() => startPrint()"
          >{{
            props.invoiceData.id && !viewMode
              ? "طباعة وحفظ التعديل"
              : viewMode
                ? "طباعة"
                : "حفظ وطباعة"
          }}</UButton
        >
        <UButton
          v-if="!viewMode"
          class="min-h-11 flex-1"
          color="error"
          variant="soft"
          icon="i-lucide-x"
          @click="emit('reset')"
          >إعادة ظبط الفاتورة</UButton
        >
        <UButton
          v-if="viewMode"
          class="min-h-11 flex-1"
          color="error"
          variant="soft"
          @click="emit('close')"
          >إغلاق</UButton
        >
      </div>
    </div>
    <!-- Below-cost confirm (P4: dialog instead of blocking confirm()) -->
    <UiAppDialog v-model:open="costConfirmOpen" title="تنبيه">
      <p class="mb-4 text-gray-600">توجد عناصر سعرها أقل من سعر التكلفة... هل تريد المتابعة على أية حال؟</p>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton color="success" block @click="confirmCostAndContinue">متابعة</UButton>
          <UButton color="neutral" variant="ghost" block @click="costConfirmOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Invoice, InvoiceProductLine } from "~/types";

const props = defineProps<{
  invoiceData: Invoice;
  viewMode?: boolean;
  isForAdmin?: boolean;
}>();
const { formatDate, calcTotal, formatTime12Hour, formatePrice, useDownloadPDF } = useHelpers();
const { notify } = useAppToast();
const printing = ref(false);
const { saveDataTo, updateItem } = useFirebase();
const emit = defineEmits(["reset", "saved", "close"]);

const mappedProducts = computed(() => {
  // Empty draft lines (no product picked yet) never render or print.
  return (props.invoiceData?.products ?? []).filter((prod) => prod.product_id).map((prod) => {
    let quantity: string | number = prod.product_quantity || "";
    if (prod.product_quantity === 0.5) quantity = "1/2";
    else if (prod.product_quantity === 0.25) quantity = "1/4";
    else if (prod.product_quantity === 0.75) quantity = "3/4";
    return {
      عدد: quantity,
      البيان: (prod.product_name || "") + (prod.option ? ` (${prod.option})` : ""),
      تصحيح: "",
      "سعر الوحدة": formatePrice(prod.product_price || 0),
      الإجمالي: formatePrice(calcTotalOfForm(prod)),
    };
  });
});
const costConfirmOpen = ref(false);
const costConfirmed = ref(false);
const pendingSaveOnly = ref<boolean | undefined>(undefined);
const calcTotalOfForm = (form: Pick<InvoiceProductLine, "product_price" | "product_quantity">): number => {
  if (form.product_price && form.product_quantity) {
    return Number(form.product_price) * Number(form.product_quantity);
  }
  return 0;
};

function resolveTime(dateVal: unknown, timeVal: unknown): Date {
  if (timeVal instanceof Date && !isNaN(timeVal.getTime())) return new Date(timeVal);
  if (dateVal instanceof Date && typeof timeVal === "string") {
    const [h, m] = timeVal.split(":");
    const d = new Date(dateVal);
    d.setHours(Number(h || 0), Number(m || 0), 0, 0);
    return d;
  }
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) return new Date(dateVal);
  return new Date();
}

async function startPrint(saveOnly?: boolean) {
  if (!props.invoiceData.customer_name) {
    // P4: toast instead of blocking alert().
    notify("يبدو أنك نسيت تحديد العميل، لا يمكن حفظ فاتورة دون اختيار عميل.", "error");
    return true;
  }
  const lines = (props.invoiceData.products ?? []).filter((l) => l.product_id);
  if (!lines.length) {
    notify("لا يمكن حفظ فاتورة فارغة.", "error");
    return true;
  }
  const _time = resolveTime(props.invoiceData.date, props.invoiceData.time);
  void _time;
  if (isAdmin.value && !costConfirmed.value) {
    const belowCost = lines.some(
      (element) => Number(element.product_price) < Number(element.product_cost_price)
    );
    if (belowCost) {
      pendingSaveOnly.value = saveOnly;
      costConfirmOpen.value = true;
      return;
    }
  }
  await doSave(saveOnly);
}

function confirmCostAndContinue(): void {
  costConfirmed.value = true;
  costConfirmOpen.value = false;
  void doSave(pendingSaveOnly.value);
}

async function doSave(saveOnly?: boolean) {
  printing.value = saveOnly ? false : true;

  if (!props.viewMode) {
    // Button loader (printing) is the progress indicator — no extra alert.
    const { id, order: _order, ...data } = props.invoiceData as Invoice & { order?: unknown };
    void _order;
    // Persist only filled lines — drop empty drafts.
    const filled = (props.invoiceData.products ?? []).filter((l) => l.product_id);
    const payload = { ...data, products: filled } as Record<string, unknown>;
    if (id) {
      await updateItem("invoices", id, payload);
    } else {
      const response = (await saveDataTo("invoices", payload)) as { id?: string } | null;
      if (response?.id) emit("saved", response.id);
    }
  }
  if (!saveOnly) {
    setTimeout(async () => {
      await useDownloadPDF(
        "invoice-data",
        `فاتورة ${props.invoiceData?.customer_name || ""}----${formatDate(props.invoiceData?.date).replace(/ /g, "-")}----${formatTime12Hour(props.invoiceData?.time).replace(/ /g, "-")}`
      );
      printing.value = false;
    }, 100);
  }
  if (!props.viewMode) {
    costConfirmed.value = false;
    notify("تم حفظ الفاتورة بنجاح", "success");
  }
}
const discountAmount = computed(() => {
  if (props.invoiceData.discount && props.invoiceData.discount_percentage) {
    return (calcTotal(props.invoiceData) * Number(props.invoiceData.discount)) / 100;
  }
  return Number(props.invoiceData.discount || 0);
});
function handleCtrlPlusS(e: KeyboardEvent) {
  if (e && e.ctrlKey && e.code === "KeyS") {
    e.preventDefault();
    void startPrint(true);
  }
}
onMounted(() => {
  window.addEventListener("keydown", handleCtrlPlusS);
});
onUnmounted(() => {
  window.removeEventListener("keydown", handleCtrlPlusS);
});
</script>

<style scoped>
.inv-table {
  border-collapse: collapse;
  margin-top: 5px;
}
.inv-table thead th,
.inv-table tbody td {
  border-bottom: thin solid #000;
  border-left: thin solid #000;
  text-align: center;
  padding: 2px 5px;
  height: 30px;
}
.inv-table thead th {
  border-top: thin solid #000;
}
.inv-table thead th:first-child,
.inv-table tbody td:first-child {
  border-right: thin solid #000;
}
.inv-table thead th:last-child,
.inv-table tbody td:last-child {
  border-left: thin solid #000;
}
.inv-footer {
  border-bottom: thin solid #000;
  border-right: thin solid #000;
  border-left: thin solid #000;
  padding: 5px;
}
.inv-footer > div {
  display: flex;
  padding-block: 5px;
  align-items: center;
  padding-inline-end: 10px;
  justify-content: space-between;
  line-height: 1;
}
.inv-footer > div:not(:last-of-type) {
  border-bottom: 1px dashed rgba(128, 128, 128, 0.163);
}
@media print {
  .no-print {
    display: none !important;
  }
}
</style>
