<template>
  <div id="invoice-data" class="rounded-lg border border-gray-300 bg-white p-2.5 text-[13px] leading-relaxed">
    <UAlert
      v-if="invoiceData.id && !isReadOnly"
      color="warning"
      variant="soft"
      icon="i-lucide-file-pen-line"
      title="أنت في وضع التعديل علي فاتورة سابقة"
      class="no-print mb-2"
    />
    <UAlert
      v-if="invoiceData.status === 'cancelled'"
      color="error"
      variant="soft"
      icon="i-lucide-ban"
      title="فاتورة ملغاة — للعرض والتدقيق فقط"
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
      <InvoiceGroupedItemsTable :lines="invoiceData.products ?? []" />
      <section v-if="hasReturns" class="mt-3 rounded-lg border border-red-100 bg-red-50/40 p-3">
        <h3 class="mb-2 font-bold text-red-800">الأصناف المرتجعة</h3>
        <div v-for="(row, i) in returnedProducts" :key="`return-${i}`" class="flex items-center justify-between gap-3 border-t border-red-100 py-2 first:border-0">
          <div class="min-w-0">
            <div class="font-medium">{{ row.quantity }} × {{ row.name }}</div>
            <div class="text-xs text-gray-500">{{ formatePrice(row.unitPrice) }} ج للوحدة بعد الخصم</div>
          </div>
          <strong class="shrink-0 text-red-700">{{ formatePrice(row.amount) }} ج</strong>
        </div>
      </section>
      <div class="bg-white pt-1" :class="hasReturns ? '' : 'sticky bottom-0 z-10'">
        <div v-if="hasReturns" class="mt-3 space-y-3">
          <div class="rounded-lg border border-gray-200 p-3">
            <h3 class="mb-2 font-bold">ملخص الفاتورة</h3>
            <div v-if="invoiceData.discount" class="flex justify-between gap-3 py-1 text-gray-600"><span>الإجمالي قبل الخصم</span><span>{{ formatePrice(calcTotal(invoiceData)) }} ج</span></div>
            <div v-if="invoiceData.discount" class="flex justify-between gap-3 py-1 text-gray-600"><span>الخصم {{ invoiceData.discount_for ? `(${invoiceData.discount_for})` : "" }} ({{ discountLabel }})</span><span class="tabular-nums">{{ formatePrice(discountAmount) }} ج</span></div>
            <div class="flex justify-between gap-3 py-1"><span>الفاتورة قبل المرتجع</span><strong>{{ formatePrice(originalTotal) }} ج</strong></div>
            <div class="flex justify-between gap-3 py-1 text-red-700"><span>خصم المرتجع</span><strong dir="ltr">-{{ formatePrice(returnTotal) }} ج</strong></div>
            <div class="mt-2 flex justify-between gap-3 border-t border-gray-200 pt-2 text-lg font-extrabold"><span>الصافي بعد المرتجع</span><span class="tabular-nums">{{ formatePrice(netAfterReturns) }} ج</span></div>
          </div>
          <div class="rounded-lg border border-gray-200 p-3">
            <h3 class="mb-2 font-bold">توزيع قيمة المرتجع</h3>
            <div v-if="debtReductionTotal" class="flex justify-between gap-3 py-1"><span>تخفيض دين العميل</span><strong>{{ formatePrice(debtReductionTotal) }} ج</strong></div>
            <div v-if="cashRefundTotal" class="flex justify-between gap-3 py-1"><span>نقد أُعيد للعميل</span><strong>{{ formatePrice(cashRefundTotal) }} ج</strong></div>
            <div v-if="returnCreditTotal" class="flex justify-between gap-3 py-1"><span>رصيد أُضيف لمحفظة العميل</span><strong>{{ formatePrice(returnCreditTotal) }} ج</strong></div>
            <div class="mt-2 flex justify-between gap-3 border-t border-gray-200 pt-2 font-bold"><span>المتبقي على الفاتورة الآن</span><span>{{ formatePrice(currentRemaining) }} ج</span></div>
          </div>
        </div>
        <div v-else class="inv-footer">
          <div v-if="oldDebt > 0"><strong>القديم/</strong> <span>{{ formatePrice(oldDebt) }}</span></div>
          <div v-if="walletBalance > 0 && !Number(invoiceData.credit_used || 0)"><strong>رصيد المحفظة/</strong> <span>{{ formatePrice(walletBalance) }}</span></div>
          <div v-if="invoiceData.amount_of_mahros"><strong>محروس/</strong> <span>{{ formatePrice(invoiceData.amount_of_mahros) }}</span></div>
          <div v-if="invoiceData.amount_of_animal_feeds"><strong>العلف/</strong> <span>{{ formatePrice(invoiceData.amount_of_animal_feeds) }}</span></div>
          <div v-if="invoiceData.delivery_price"><strong>التوصيل/</strong> <span>{{ formatePrice(invoiceData.delivery_price) }}</span></div>
          <div v-if="invoiceData.discount">
            <strong>الإجمالي قبل الخصم/</strong> <span class="tabular-nums">{{ formatePrice(calcTotal(invoiceData)) }}</span>
          </div>
          <div v-if="invoiceData.discount">
            <strong>الخصم {{ invoiceData.discount_for ? `(${invoiceData.discount_for})` : "" }} ({{ discountLabel }})/</strong>
            <span class="tabular-nums">{{ formatePrice(discountAmount) }}</span>
          </div>
          <div class="inv-grand"><strong>الإجمالي {{ invoiceData.discount ? "بعد الخصم" : "" }}/</strong><span class="tabular-nums">{{ formatePrice(originalTotal) }}</span></div>
          <!-- paid / remaining rows: 0 is a valid financial value, never hide it. -->
          <div v-if="invoiceData.paid_amount !== null && invoiceData.paid_amount !== undefined">
            <strong>المدفوع/</strong>
            <span>{{ formatePrice(invoiceData.paid_amount) }}</span>
          </div>
          <div v-if="invoiceData.credit_used" class="no-print"><strong>من رصيد العميل/</strong><span>{{ formatePrice(invoiceData.credit_used) }}</span></div>
          <div v-if="invoiceData.paid_amount !== null && invoiceData.paid_amount !== undefined" class="inv-remaining">
            <strong>المتبقي/</strong>
            <span class="tabular-nums">{{ formatePrice((calcTotal(invoiceData) - discountAmount) - Number(invoiceData.paid_amount ?? 0)) }}</span>
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
            props.invoiceData.id && !isReadOnly
              ? "طباعة وحفظ التعديل"
              : isReadOnly
                ? "طباعة"
                : "حفظ وطباعة"
          }}</UButton
        >
        <UButton
          v-if="!isReadOnly"
          class="min-h-11 flex-1"
          color="error"
          variant="soft"
          icon="i-lucide-x"
          @click="emit('reset')"
          >إعادة ظبط الفاتورة</UButton
        >
        <UButton
          v-if="isReadOnly"
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
          <UButton color="success" block :loading="printing" :disabled="printing" @click="confirmCostAndContinue">متابعة</UButton>
          <UButton color="neutral" variant="ghost" block :disabled="printing" @click="costConfirmOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Invoice } from "~/types";
import type { InvoiceReturn } from "~/types/finance";

const props = defineProps<{
  invoiceData: Invoice;
  openingBalance?: { credit: number; debt: number } | null;
  viewMode?: boolean;
  isForAdmin?: boolean;
  returns?: InvoiceReturn[];
}>();
const { formatDate, calcTotal, formatTime12Hour, formatePrice, useDownloadPDF, formatInvoiceLineName } = useHelpers();
const { notify } = useAppToast();
const printing = ref(false);
const isReadOnly = computed(() => props.viewMode === true || props.invoiceData.status === "cancelled");
const { saveDataTo, updateItem } = useFirebase();
const emit = defineEmits(["reset", "saved", "close"]);
const oldDebt = computed(() => Number(props.openingBalance?.debt ?? props.invoiceData.debt ?? 0));
const walletBalance = computed(() => Number(props.openingBalance?.credit ?? 0));

const hasReturns = computed(() => !!isReadOnly.value && !!props.returns?.length);
const { round2 } = useFinance();
const returnTotal = computed(() => round2((props.returns ?? []).reduce((sum, item) => sum + Number(item.total_refund || 0), 0)));
const cashRefundTotal = computed(() => round2((props.returns ?? []).reduce((sum, item) => sum + Number(item.cash_refund || 0), 0)));
const debtReductionTotal = computed(() => round2((props.returns ?? []).reduce((sum, item) => sum + Number(item.debt_reduction || 0), 0)));
const returnCreditTotal = computed(() => round2((props.returns ?? []).reduce((sum, item) => sum + Number(item.credit_issued || 0) + Number(item.credit_restored || 0), 0)));
const originalTotal = computed(() => round2(calcTotal(props.invoiceData) - discountAmount.value));
const netAfterReturns = computed(() => round2(originalTotal.value - returnTotal.value));
const currentRemaining = computed(() => Number(props.invoiceData.remaining ?? Math.max(0, netAfterReturns.value - Number(props.invoiceData.paid_amount ?? 0) + cashRefundTotal.value)));
const returnedProducts = computed(() => hasReturns.value ? (props.returns ?? []).flatMap((record) => (record.items ?? []).map((item) => ({
  name: formatInvoiceLineName(item.product_name, item.unit_name),
  quantity: item.quantity,
  unitPrice: item.quantity ? item.refund_amount / item.quantity : 0,
  amount: item.refund_amount,
}))) : []);
const costConfirmOpen = ref(false);
const costConfirmed = ref(false);
const pendingSaveOnly = ref<boolean | undefined>(undefined);

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
  if (lines.some((line) => !Number.isFinite(Number(line.unit_factor)) || Number(line.unit_factor) <= 0 || !Number.isFinite(Number(line.base_quantity)) || line.base_quantity! < 0)) {
    notify("بيانات وحدة أحد الأسطر أو كميته الأساسية غير مكتملة. أعد اختيار النوع والوحدة.", "error");
    return true;
  }
  // Admin/client parity with the cashier path: a discount can never exceed the
  // invoice (the server rejects it too — this fails fast with a clear message).
  const gross = calcTotal(props.invoiceData);
  const discountRaw = Number(props.invoiceData.discount || 0);
  if (!isReadOnly.value && (!Number.isFinite(discountRaw) || discountRaw < 0
    || (props.invoiceData.discount_percentage && discountRaw > 100)
    || (!props.invoiceData.discount_percentage && discountRaw - gross > 0.005)
    || gross - (props.invoiceData.discount_percentage ? (gross * discountRaw) / 100 : discountRaw) < -0.005)) {
    notify("راجع الخصم: لا يجوز أن يتجاوز إجمالي الفاتورة.", "error");
    return true;
  }
  const _time = resolveTime(props.invoiceData.date, props.invoiceData.time);
  void _time;
  if (!isReadOnly.value && !costConfirmed.value) {
    // Same-unit comparison: selected-unit price vs derived selected-unit
    // average (base average × factor). Never compare against base cost directly.
    const belowCost = lines.some((element) => {
      const factor = Number(element.unit_factor);
      if (!Number.isFinite(factor) || factor <= 0) return true;
      const baseCost = Number(element.product_cost_price);
      if (!Number.isFinite(baseCost)) return false;
      // product_cost_price on the form may already be a selected-unit average
      // for legacy lines; prefer cost_groups/base snapshot when available.
      const historicalBase = Array.isArray(element.cost_groups) && element.cost_groups.length
        ? element.cost_groups.reduce((s, g) => s + Number(g.base_quantity) * Number(g.unit_cost), 0) /
          Math.max(1e-9, element.cost_groups.reduce((s, g) => s + Number(g.base_quantity), 0))
        : Number(element.base_cost_snapshot ?? element.product_cost_price);
      const avgForUnit = Number.isFinite(historicalBase) ? historicalBase * factor : baseCost;
      return Number(element.product_price) - avgForUnit < -1e-9;
    });
    if (belowCost) {
      pendingSaveOnly.value = saveOnly;
      costConfirmOpen.value = true;
      return;
    }
  }
  await doSave(saveOnly);
}

function confirmCostAndContinue(): void {
  if (printing.value) return;
  costConfirmed.value = true;
  costConfirmOpen.value = false;
  void doSave(pendingSaveOnly.value);
}

async function doSave(saveOnly?: boolean) {
  printing.value = saveOnly ? false : true;

  if (!isReadOnly.value) {
    // Button loader (printing) is the progress indicator — no extra alert.
    const { id, order: _order, ...data } = props.invoiceData as Invoice & { order?: unknown };
    void _order;
    // Persist only filled lines — drop empty drafts.
    const filled = (props.invoiceData.products ?? []).filter((l) => l.product_id);
    // HOME delta: persist computed remaining (debts feature).
    const remaining = (calcTotal(props.invoiceData) - discountAmount.value) - Number(props.invoiceData.paid_amount || 0);
    const payload = { ...data, products: filled, remaining } as Omit<Invoice, "id">;
    if (id) {
      // Atomic edit: stock + paid deltas with corrective logs (F10).
      const invoicesStore = useInvoicesStore();
      const res = await invoicesStore.updateInvoiceWithAccounting(id, payload);
      if (!res.ok) {
        printing.value = false;
        notify(res.error, "error");
        return;
      }
      emit("saved", id);
    } else {
      // Atomic create: invoice + stock + inventory logs + cashbox (F9).
      const invoicesStore = useInvoicesStore();
      const res = await invoicesStore.createInvoiceWithAccounting(payload);
      if (!res.ok) {
        printing.value = false;
        notify(res.error, "error");
        return;
      }
      emit("saved", res.id);
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
  if (!isReadOnly.value) {
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
/** Human-readable discount basis: `10%` or `مبلغ ثابت`. Amount always shown beside it. */
const discountLabel = computed(() => props.invoiceData.discount_percentage ? `${props.invoiceData.discount}%` : "مبلغ ثابت");
// Ctrl+S lives on the host page (pages/index.vue) so hidden + preview
// instances never double-fire.
defineExpose({ startPrint });
</script>

<style scoped>
/* .inv-table lives in assets/css/main.css (shared with the grouped table). */
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
.inv-grand {
  font-size: 1.15em;
  font-weight: 800;
}
.inv-remaining {
  font-weight: 800;
}
@media print {
  .no-print {
    display: none !important;
  }
}
</style>
