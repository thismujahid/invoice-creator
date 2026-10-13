<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4" dir="rtl">
    <div
      class="mb-4 flex gap-2 border-b border-gray-200 pb-2"
      role="tablist"
      aria-label="أقسام الفواتير"
    >
      <UButton
        role="tab"
        :aria-selected="activeTab === 'sales'"
        :color="activeTab === 'sales' ? 'success' : 'neutral'"
        :variant="activeTab === 'sales' ? 'solid' : 'soft'"
        @click="activeTab = 'sales'"
        >فواتير البيع</UButton
      ><UButton
        role="tab"
        :aria-selected="activeTab === 'returns'"
        :color="activeTab === 'returns' ? 'success' : 'neutral'"
        :variant="activeTab === 'returns' ? 'solid' : 'soft'"
        @click="activeTab = 'returns'"
        >سجل المرتجعات</UButton
      >
    </div>
    <CashierReturnJournal v-if="activeTab === 'returns'" />
    <div v-show="activeTab === 'sales'">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="text-lg font-bold text-gray-900">الفواتير</h2>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="payableItems.length"
            icon="i-lucide-hand-coins"
            color="success"
            variant="soft"
            :loading="payingAll"
            @click="payAllVisible"
            >سداد جميع الفواتير المعروضة</UButton
          ><UButton
            icon="i-lucide-download"
            color="info"
            variant="soft"
            :loading="exporting"
            :disabled="loading"
            @click="exportInvoices"
            >تصدير البيانات</UButton
          ><UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            :loading="loading"
            @click="loadPage"
            >تحديث</UButton
          >
        </div>
      </div>
      <div
        v-if="customerFilter.id"
        class="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm"
      >
        <span class="min-w-0 flex-1 truncate"
          >فواتير: {{ customerFilter.name || customerFilter.id }}</span
        >
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-x"
          @click="clearCustomerFilter"
          >عرض الكل</UButton
        >
      </div>
      <UInput
        v-model="search"
        placeholder="بحث في كل الفواتير بالاسم أو الهاتف"
        icon="i-lucide-search"
        size="lg"
        class="mb-3 w-full sm:max-w-xs"
        :disabled="!!customerFilter.id"
      />
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        :title="error"
        class="mb-3"
      >
        <template #actions
          ><UButton size="xs" color="error" variant="soft" @click="loadPage"
            >إعادة المحاولة</UButton
          ></template
        >
      </UAlert>
      <UiAppTableSkeleton v-if="loading" />
      <template v-else>
        <div class="hidden overflow-x-auto md:block">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-gray-500">
                <th class="p-2 text-start">العميل</th>
                <th class="p-2 text-start">الهاتف</th>
                <th class="p-2 text-start">التاريخ</th>
                <th class="p-2 text-start">المنتجات</th>
                <th class="p-2 text-start">الإجمالي</th>
                <th class="p-2 text-start">المدفوع</th>
                <th class="p-2 text-start">المتبقي</th>
                <th class="p-2 text-start">الأدوات</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in items"
                :key="item.id"
                class="border-b last:border-0"
              >
                <td class="p-2">
                  {{ item.customer_name
                  }}<UBadge
                    v-if="
                      item.return_status === 'full' ||
                      item.return_status === 'partial'
                    "
                    color="warning"
                    variant="soft"
                    size="xs"
                    class="ms-1"
                    >{{
                      item.return_status === "full"
                        ? "مرتجع كامل"
                        : "مرتجع جزئي"
                    }}
                    · {{ formatePrice(item.return_total) }} ج</UBadge
                  >
                </td>
                <td class="p-2" dir="ltr">{{ item.customer_phone ?? "—" }}</td>
                <td class="p-2">{{ formatDate(item.date) }}</td>
                <td class="p-2">{{ item.product_count }}</td>
                <td class="p-2">
                  {{ formatePrice(item.total - item.return_total) }} ج<span
                    v-if="item.return_status"
                    class="block text-xs text-gray-500"
                    >الأصلي {{ formatePrice(item.total) }} ج</span
                  >
                </td>
                <td class="p-2">
                  {{
                    formatePrice(
                      netCollectedOf(
                        item.paid - item.credit_used,
                        item.cash_refund_total || 0,
                      ),
                    )
                  }}
                  ج
                </td>
                <td class="p-2">{{ formatePrice(item.remaining) }} ج</td>
                <td class="p-2">
                  <div class="flex gap-1.5">
                    <UTooltip
                      v-if="item.remaining > 0"
                      text="سداد الفاتورة بالكامل"
                      ><UButton
                        size="xs"
                        icon="i-lucide-hand-coins"
                        color="success"
                        variant="soft"
                        aria-label="سداد الفاتورة بالكامل"
                        :loading="payingId === item.id"
                        :disabled="!!payingId || payingAll"
                        @click="payFull(item)"
                    /></UTooltip>
                    <UTooltip text="نسخ الفاتورة"
                      ><UButton
                        size="xs"
                        icon="i-lucide-copy"
                        color="success"
                        variant="soft"
                        aria-label="نسخ الفاتورة"
                        :loading="copyingId === item.id"
                        @click="copyInvoice(item.id)"
                    /></UTooltip>
                    <UTooltip v-if="!item.credit_used" text="تعديل الفاتورة"
                      ><UButton
                        size="xs"
                        icon="i-lucide-pencil"
                        color="success"
                        variant="soft"
                        aria-label="تعديل الفاتورة"
                        :loading="editingId === item.id"
                        @click="editInvoice(item.id)"
                    /></UTooltip>
                    <UTooltip text="عرض الفاتورة"
                      ><UButton
                        size="xs"
                        icon="i-lucide-eye"
                        color="neutral"
                        variant="soft"
                        aria-label="عرض الفاتورة"
                        :loading="viewingId === item.id"
                        @click="viewInvoice(item.id)"
                    /></UTooltip>
                    <UTooltip text="إنشاء مرتجع"
                      ><UButton
                        size="xs"
                        icon="i-lucide-undo-2"
                        color="warning"
                        variant="soft"
                        aria-label="إنشاء مرتجع"
                        :loading="returnLoading && returnTarget?.id === item.id"
                        @click="openReturn(item)"
                    /></UTooltip>
                    <UTooltip text="حذف"
                      ><UButton
                        size="xs"
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="soft"
                        aria-label="حذف"
                        @click="deleteTarget = item"
                    /></UTooltip>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="space-y-2 md:hidden">
          <UCard v-for="item in items" :key="item.id" variant="outline">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="font-bold">
                  {{ item.customer_name
                  }}<UBadge
                    v-if="
                      item.return_status === 'full' ||
                      item.return_status === 'partial'
                    "
                    color="warning"
                    variant="soft"
                    size="xs"
                    class="ms-1"
                    >{{
                      item.return_status === "full"
                        ? "مرتجع كامل"
                        : "مرتجع جزئي"
                    }}
                    · {{ formatePrice(item.return_total) }} ج</UBadge
                  >
                </div>
                <div class="text-xs text-gray-500" dir="ltr">
                  {{ item.customer_phone ?? "—" }}
                </div>
                <div class="text-xs text-gray-500">
                  {{ formatDate(item.date) }} · {{ item.product_count }} منتجات
                </div>
              </div>
              <div class="flex max-w-40 flex-wrap justify-end gap-1">
                <UButton
                  v-if="item.remaining > 0"
                  size="xs"
                  icon="i-lucide-hand-coins"
                  color="success"
                  variant="soft"
                  aria-label="سداد الفاتورة بالكامل"
                  :loading="payingId === item.id"
                  :disabled="!!payingId || payingAll"
                  @click="payFull(item)"
                /><UButton
                  size="xs"
                  icon="i-lucide-copy"
                  color="success"
                  variant="soft"
                  aria-label="نسخ الفاتورة"
                  :loading="copyingId === item.id"
                  @click="copyInvoice(item.id)"
                /><UButton
                  v-if="!item.credit_used"
                  size="xs"
                  icon="i-lucide-pencil"
                  color="success"
                  variant="soft"
                  aria-label="تعديل الفاتورة"
                  :loading="editingId === item.id"
                  @click="editInvoice(item.id)"
                /><UButton
                  size="xs"
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="soft"
                  aria-label="عرض الفاتورة"
                  :loading="viewingId === item.id"
                  @click="viewInvoice(item.id)"
                /><UButton
                  size="xs"
                  icon="i-lucide-undo-2"
                  color="warning"
                  variant="soft"
                  aria-label="إنشاء مرتجع"
                  :loading="returnLoading && returnTarget?.id === item.id"
                  @click="openReturn(item)"
                /><UButton
                  size="xs"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="soft"
                  aria-label="حذف"
                  @click="deleteTarget = item"
                />
              </div>
            </div>
            <div class="mt-2 text-sm">
              الصافي: {{ formatePrice(item.total - item.return_total) }} ج ·
              النقد المحصل:
              {{
                formatePrice(
                  netCollectedOf(
                    item.paid - item.credit_used,
                    item.cash_refund_total || 0,
                  ),
                )
              }}
              ج · المتبقي: {{ formatePrice(item.remaining) }} ج
            </div>
          </UCard>
        </div>
        <UEmpty
          v-if="!items.length && !error"
          icon="i-lucide-files"
          title="لا توجد فواتير"
        />
        <div class="mt-3 flex items-center justify-between gap-2">
          <span class="text-sm text-gray-500">صفحة {{ page }}</span>
          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="soft"
              :disabled="page <= 1 || loading"
              @click="previousPage"
              >السابق</UButton
            >
            <UButton
              color="neutral"
              variant="soft"
              :disabled="!nextCursor || loading"
              @click="nextPage"
              >التالي</UButton
            >
          </div>
        </div>
      </template>
      <UiAppDialog v-model:open="invoiceOpen" title="عرض الفاتورة">
        <div class="max-h-[80vh] overflow-auto">
          <USkeleton v-if="viewReturnsLoading" class="h-64 w-full" /><Invoice
            v-else-if="selectedInvoice"
            :invoice-data="selectedInvoice"
            :returns="viewReturns"
            view-mode
            @close="invoiceOpen = false"
          /><ReturnHistory
            v-if="selectedInvoice && viewReturnsExpected && !viewReturnsLoading"
            class="mt-4"
            :customer-returns="viewReturns"
            :error="viewReturnsError"
          />
        </div>
      </UiAppDialog>
      <UiAppDialog
        v-model:open="returnOpen"
        title="إنشاء مرتجع"
        width="sm:max-w-3xl"
      >
        <div class="space-y-4" dir="rtl">
          <USkeleton v-if="returnLoading" class="h-36 w-full" />
          <template v-else>
            <div
              class="grid gap-2 rounded-xl bg-gray-50 p-3 text-sm sm:grid-cols-3"
            >
              <div>
                <span class="block text-xs text-gray-500">العميل</span
                ><strong>{{ returnTarget?.customer_name }}</strong>
              </div>
              <div>
                <span class="block text-xs text-gray-500"
                  >الدين على الفاتورة</span
                ><strong>{{ formatePrice(returnRemaining) }} ج</strong>
              </div>
              <div>
                <span class="block text-xs text-gray-500"
                  >رصيد العميل المحفوظ</span
                ><strong>{{ formatePrice(returnCreditBalance) }} ج</strong>
              </div>
            </div>
            <div class="space-y-2">
              <h3 class="text-sm font-bold">الأصناف المراد إرجاعها</h3>
              <div
                v-for="row in returnRows"
                :key="row.key"
                class="grid items-center gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_9rem_7rem]"
              >
                <div class="min-w-0">
                  <strong>{{
                    formatInvoiceLineName(row.product_name, row.unit_name)
                  }}</strong>
                  <div class="text-xs text-gray-500">
                    المتاح {{ row.maxQty }} {{ row.unit_name }} · سعر البيع
                    {{ formatePrice(row.unit_price) }} ج
                  </div>
                </div>
                <UFormField label="الكمية"
                  ><UInputNumber
                    v-model="row.qty"
                    :min="0"
                    :max="row.maxQty"
                    :step="0.01"
                    class="w-full"
                /></UFormField>
                <div class="text-sm">
                  <span class="block text-xs text-gray-500">قيمة المرتجع</span
                  ><strong
                    >{{
                      formatePrice(
                        round2(row.unit_price * row.qty * returnRatio),
                      )
                    }}
                    ج</strong
                  >
                </div>
              </div>
            </div>
            <UEmpty
              v-if="!returnRows.length"
              title="لا توجد أصناف قابلة للإرجاع"
            />
            <div
              class="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm"
            >
              <h3 class="font-bold">تسوية المرتجع</h3>
              <div class="grid gap-2 sm:grid-cols-2">
                <div>
                  إجمالي المرتجع
                  <strong class="float-end"
                    >{{ formatePrice(returnTotal) }} ج</strong
                  >
                </div>
                <div>
                  تخفيض الدين
                  <strong class="float-end"
                    >{{ formatePrice(returnDebtReduction) }} ج</strong
                  >
                </div>
                <div v-if="returnCreditRestored">
                  إعادة رصيد مستخدم
                  <strong class="float-end"
                    >{{ formatePrice(returnCreditRestored) }} ج</strong
                  >
                </div>
                <div>
                  المتاح للنقد أو الرصيد
                  <strong class="float-end"
                    >{{ formatePrice(returnSettlement) }} ج</strong
                  >
                </div>
              </div>
              <UFormField label="المبلغ الذي سيُرد نقدًا الآن"
                ><UInputNumber
                  v-model="returnCashRefund"
                  :min="0"
                  :max="returnSettlement"
                  :step="0.01"
                  class="w-full"
              /></UFormField>
              <p class="font-semibold text-emerald-800">
                رصيد سيُحفظ للعميل:
                {{
                  formatePrice(
                    returnCreditRestored +
                      Math.max(0, round2(returnSettlement - returnCashRefund)),
                  )
                }}
                ج · نقد خارج: {{ formatePrice(returnCashRefund) }} ج
              </p>
              <p class="text-xs text-gray-600">
                يمكن استخدام الرصيد في فاتورة لاحقة كسداد.
              </p>
            </div>
            <UFormField label="ملاحظة"
              ><UInput
                v-model="returnNote"
                placeholder="اختياري"
                class="w-full"
            /></UFormField>
            <UAlert
              v-if="returnError"
              color="error"
              variant="soft"
              :title="returnError"
            />
          </template>
        </div>
        <template #footer
          ><div class="flex w-full gap-2">
            <UButton
              color="warning"
              :loading="returnBusy"
              :disabled="
                returnLoading ||
                !returnRows.some((row) => row.qty > 0) ||
                returnCashRefund > returnSettlement
              "
              @click="submitReturn"
              >تأكيد المرتجع</UButton
            ><UButton
              color="neutral"
              variant="soft"
              :disabled="returnBusy"
              @click="returnOpen = false"
              >إلغاء</UButton
            >
          </div></template
        >
      </UiAppDialog>
      <UiAppDialog v-model:open="deleteOpen" title="هل أنت متأكد؟">
        <p class="mb-4 text-sm">
          أنت على وشك حذف فاتورة {{ deleteTarget?.customer_name }}.
        </p>
        <UAlert
          color="warning"
          variant="soft"
          title="الفواتير التي أثّرت على المخزون أو الخزنة لا يمكن حذفها؛ استخدم المرتجع."
          class="mb-3"
        />
        <template #footer
          ><div class="flex w-full gap-2">
            <UButton color="error" :loading="deleting" @click="deleteConfirmed"
              >حذف</UButton
            ><UButton
              color="neutral"
              variant="soft"
              :disabled="deleting"
              @click="deleteTarget = null"
              >إلغاء</UButton
            >
          </div></template
        >
      </UiAppDialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Invoice, InvoiceDate } from "~/types";
import type { InvoiceReturn } from "~/types/finance";
import { netCollectedOf } from "~/composables/invoiceStats";

interface CashierInvoiceSummary {
  id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | number | null;
  date: InvoiceDate;
  product_count: number;
  total: number;
  paid: number;
  remaining: number;
  return_status: "full" | "partial" | null;
  return_total: number;
  cash_refund_total: number;
  credit_used: number;
}

const { formatePrice, formatDate, formatInvoiceLineName } = useHelpers();
const activeTab = ref<"sales" | "returns">("sales");
const { round2 } = useFinance();
const { notify } = useAppToast();
const invoices = useInvoicesStore();
const customers = useCustomersStore();
const route = useRoute();
const customerFilter = computed(() => ({
  id:
    typeof route.query.customer_id === "string" ? route.query.customer_id : "",
  name:
    typeof route.query.customer_name === "string"
      ? route.query.customer_name
      : "",
}));
const items = ref<CashierInvoiceSummary[]>([]);
const search = ref("");
const page = ref(1);
const cursors = ref<(string | null)[]>([null]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const error = ref("");
const viewingId = ref<string | null>(null);
const copyingId = ref<string | null>(null);
const editingId = ref<string | null>(null);
const payingId = ref<string | null>(null);
const payingAll = ref(false);
const exporting = ref(false);
const payableItems = computed(() =>
  items.value.filter((item) => item.remaining > 0),
);
const selectedInvoice = ref<Invoice | null>(null);
const viewReturns = ref<InvoiceReturn[]>([]);
const viewReturnsLoading = ref(false);
const viewReturnsError = ref("");
const viewReturnsExpected = ref(false);
const invoiceOpen = ref(false);
interface ReturnRow {
  key: string;
  product_name: string;
  unit_name: string;
  unit_price: number;
  maxQty: number;
  qty: number;
}
const returnTarget = ref<CashierInvoiceSummary | null>(null);
const returnRows = ref<ReturnRow[]>([]);
const returnRemaining = ref(0);
const returnRatio = ref(1);
const returnCashRefund = ref(0);
const returnCreditBalance = ref(0);
const returnCreditUsed = ref(0);
const returnCreditRestoredBefore = ref(0);
const returnNote = ref("");
const returnError = ref("");
const returnLoading = ref(false);
const returnBusy = ref(false);
const returnRequestId = ref(crypto.randomUUID());
const returnOpen = computed({
  get: () => returnTarget.value !== null,
  set: (value: boolean) => {
    if (!value) returnTarget.value = null;
  },
});
const returnTotal = computed(() =>
  round2(
    returnRows.value.reduce(
      (sum, row) =>
        sum + round2(row.unit_price * (row.qty ?? 0) * returnRatio.value),
      0,
    ),
  ),
);
const returnDebtReduction = computed(() =>
  Math.min(returnTotal.value, returnRemaining.value),
);
const returnCreditRestored = computed(() =>
  Math.min(
    Math.max(0, round2(returnTotal.value - returnDebtReduction.value)),
    Math.max(
      0,
      round2(returnCreditUsed.value - returnCreditRestoredBefore.value),
    ),
  ),
);
const returnSettlement = computed(() =>
  Math.max(
    0,
    round2(
      returnTotal.value -
        returnDebtReduction.value -
        returnCreditRestored.value,
    ),
  ),
);
const deleteTarget = ref<CashierInvoiceSummary | null>(null);
const deleteOpen = computed({
  get: () => deleteTarget.value !== null,
  set: (value: boolean) => {
    if (!value) deleteTarget.value = null;
  },
});
const deleting = ref(false);
let loadSequence = 0;

async function loadPage(): Promise<void> {
  const sequence = ++loadSequence;
  loading.value = true;
  error.value = "";
  try {
    const result = await callStaff<
      { cursor: string | null; search: string; customerId: string },
      { items: CashierInvoiceSummary[]; nextCursor: string | null }
    >("getCashierInvoices", {
      cursor: cursors.value[page.value - 1] ?? null,
      search: search.value.trim(),
      customerId: customerFilter.value.id,
    });
    if (sequence !== loadSequence) return;
    items.value = result.items;
    nextCursor.value = result.nextCursor;
  } catch {
    if (sequence !== loadSequence) return;
    error.value = "تعذر تحميل الفواتير. حاول مرة أخرى.";
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

async function nextPage(): Promise<void> {
  if (!nextCursor.value || loading.value) return;
  cursors.value[page.value] = nextCursor.value;
  page.value += 1;
  await loadPage();
}

async function previousPage(): Promise<void> {
  if (page.value <= 1 || loading.value) return;
  page.value -= 1;
  await loadPage();
}

async function viewInvoice(id: string): Promise<void> {
  if (viewingId.value) return;
  viewingId.value = id;
  error.value = "";
  try {
    selectedInvoice.value = await callStaff<{ id: string }, Invoice>(
      "getCashierInvoice",
      { id },
    );
    invoiceOpen.value = true;
    viewReturns.value = [];
    viewReturnsError.value = "";
    viewReturnsExpected.value = items.value.some(
      (item) =>
        item.id === id &&
        (item.return_status === "partial" || item.return_status === "full"),
    );
    if (viewReturnsExpected.value) {
      viewReturnsLoading.value = true;
      try {
        const result = await callStaff<
          { id: string },
          { items: InvoiceReturn[] }
        >("getCashierInvoiceReturns", { id });
        viewReturns.value = result.items;
      } catch {
        viewReturnsError.value = "تعذر تحميل سجل المرتجعات.";
      } finally {
        viewReturnsLoading.value = false;
      }
    }
  } catch {
    error.value = "تعذر فتح الفاتورة. حاول مرة أخرى.";
  } finally {
    viewingId.value = null;
  }
}

async function copyInvoice(id: string): Promise<void> {
  if (copyingId.value) return;
  copyingId.value = id;
  error.value = "";
  try {
    const source = await callStaff<{ id: string }, Invoice>(
      "getCashierInvoice",
      { id },
    );
    invoices.invoiceToEdit = { ...source, id: undefined };
    await navigateTo("/");
  } catch {
    error.value = "تعذر نسخ الفاتورة. حاول مرة أخرى.";
  } finally {
    copyingId.value = null;
  }
}

async function editInvoice(id: string): Promise<void> {
  if (editingId.value) return;
  editingId.value = id;
  error.value = "";
  try {
    invoices.invoiceToEdit = await callStaff<{ id: string }, Invoice>(
      "getCashierInvoice",
      { id },
    );
    await navigateTo("/");
  } catch {
    error.value = "تعذر فتح الفاتورة للتعديل. حاول مرة أخرى.";
  } finally {
    editingId.value = null;
  }
}

async function openReturn(item: CashierInvoiceSummary): Promise<void> {
  returnTarget.value = item;
  returnRows.value = [];
  returnNote.value = "";
  returnCashRefund.value = 0;
  returnError.value = "";
  returnRequestId.value = crypto.randomUUID();
  returnLoading.value = true;
  try {
    const preview = await callStaff<
      { id: string },
      {
        remaining: number;
        ratio: number;
        creditUsed: number;
        creditRestored: number;
        creditBalance: number;
        rows: Omit<ReturnRow, "qty">[];
      }
    >("getStaffReturnPreview", { id: item.id });
    returnRemaining.value = preview.remaining;
    returnRatio.value = preview.ratio;
    returnCreditBalance.value = preview.creditBalance;
    returnCreditUsed.value = preview.creditUsed;
    returnCreditRestoredBefore.value = preview.creditRestored;
    returnRows.value = preview.rows
      .filter((row) => row.maxQty > 0)
      .map((row) => ({ ...row, qty: 0 }));
  } catch {
    returnError.value =
      "تعذر إعداد المرتجع. قد يحتاج سجل الفاتورة القديمة إلى مراجعة المسؤول.";
  } finally {
    returnLoading.value = false;
  }
}

async function submitReturn(): Promise<void> {
  if (!returnTarget.value || returnBusy.value) return;
  const items = returnRows.value
    .filter((row) => row.qty > 0)
    .map((row) => ({ rowKey: row.key, quantity: row.qty }));
  if (
    !items.length ||
    items.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)
  ) {
    returnError.value = "حدد كمية صالحة للإرجاع.";
    return;
  }
  returnBusy.value = true;
  returnError.value = "";
  try {
    const result = await callStaff<
      {
        requestId: string;
        id: string;
        items: typeof items;
        note: string | null;
        cashRefund: number;
      },
      {
        id: string;
        debtReduction: number;
        cashRefund: number;
        creditIssued: number;
        creditRestored: number;
      }
    >("createStaffReturn", {
      requestId: returnRequestId.value,
      id: returnTarget.value.id,
      items,
      note: returnNote.value.trim() || null,
      cashRefund: returnCashRefund.value,
    });
    returnTarget.value = null;
    notify(
      `تم تسجيل المرتجع — تخفيض الدين: ${formatePrice(result.debtReduction)} ج، نقدي: ${formatePrice(result.cashRefund)} ج، رصيد للعميل: ${formatePrice(result.creditIssued + result.creditRestored)} ج.`,
      "success",
    );
    useProductsStore().invalidateCache();
    await loadPage();
  } catch {
    returnError.value =
      "تعذر تسجيل المرتجع. أعد فتح الفاتورة وراجع الكمية ورصيد الخزنة.";
  } finally {
    returnBusy.value = false;
  }
}

async function deleteConfirmed(): Promise<void> {
  if (!deleteTarget.value || deleting.value) return;
  deleting.value = true;
  error.value = "";
  try {
    await callStaff("deleteStaffInvoice", { id: deleteTarget.value.id });
    deleteTarget.value = null;
    notify("تم حذف الفاتورة.", "success");
    await loadPage();
  } catch {
    deleteTarget.value = null;
    error.value =
      "لا يمكن حذف فاتورة لها حركات مخزنية أو نقدية. استخدم المرتجع بدلاً من الحذف.";
  } finally {
    deleting.value = false;
  }
}

async function settle(item: CashierInvoiceSummary): Promise<void> {
  if (item.remaining <= 0) return;
  let customerId = item.customer_id;
  if (!customerId) {
    await customers.fetchCustomers(undefined, true);
    const matches = customers.list.filter(
      (customer) =>
        customer.name === item.customer_name &&
        String(customer.phone ?? "").replace(/\D/g, "") ===
          String(item.customer_phone ?? "").replace(/\D/g, ""),
    );
    if (matches.length !== 1 || !matches[0]?.id)
      throw new Error("Legacy customer cannot be identified.");
    customerId = matches[0].id;
  }
  await callStaff("payStaffDebts", {
    requestId: crypto.randomUUID(),
    customer_id: customerId,
    amount: item.remaining,
    allocations: [
      { type: "invoice", reference_id: item.id, amount: item.remaining },
    ],
  });
}

async function payFull(item: CashierInvoiceSummary): Promise<void> {
  if (payingId.value || payingAll.value) return;
  payingId.value = item.id;
  error.value = "";
  try {
    await settle(item);
    notify("تم سداد الفاتورة بالكامل وتحديث الخزنة.", "success");
    await loadPage();
  } catch {
    error.value = "تعذر سداد الفاتورة. حدّث القائمة وحاول مجددًا.";
  } finally {
    payingId.value = null;
  }
}

async function payAllVisible(): Promise<void> {
  if (payingAll.value || payingId.value) return;
  payingAll.value = true;
  error.value = "";
  let completed = 0;
  try {
    for (const item of payableItems.value) {
      await settle(item);
      completed += 1;
    }
    notify(`تم سداد ${completed} فاتورة.`, "success");
  } catch {
    error.value = `تم سداد ${completed} فاتورة، وتعذر سداد الباقي. حدّث القائمة قبل المحاولة مجددًا.`;
  } finally {
    payingAll.value = false;
    await loadPage();
  }
}

async function exportInvoices(): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  error.value = "";
  try {
    const exported: CashierInvoiceSummary[] = [];
    let cursor: string | null = null;
    do {
      const result: {
        items: CashierInvoiceSummary[];
        nextCursor: string | null;
      } = await callStaff<
        { cursor: string | null; search: string; customerId: string },
        { items: CashierInvoiceSummary[]; nextCursor: string | null }
      >("getCashierInvoices", {
        cursor,
        search: search.value.trim(),
        customerId: customerFilter.value.id,
      });
      exported.push(...result.items);
      cursor = result.nextCursor;
    } while (cursor);
    if (!exported.length) {
      notify("لا توجد فواتير للتصدير.", "info");
      return;
    }
    const returns: InvoiceReturn[] = [];
    const returnedIds = exported
      .filter(
        (item) =>
          item.return_status === "partial" || item.return_status === "full",
      )
      .map((item) => item.id);
    for (let index = 0; index < returnedIds.length; index += 25) {
      const result = await callStaff<
        { ids: string[] },
        { items: InvoiceReturn[] }
      >("getCashierInvoiceReturns", {
        ids: returnedIds.slice(index, index + 25),
      });
      returns.push(...result.items);
    }
    const returnTotals = new Map<string, number>();
    for (const record of returns)
      returnTotals.set(
        record.invoice_id,
        Math.round(
          ((returnTotals.get(record.invoice_id) || 0) +
            Number(record.total_refund || 0)) *
            100,
        ) / 100,
      );
    const XLSX = await import("xlsx/dist/xlsx.full.min.js");
    const rows = exported.map((item) => ({
      "اسم العميل": item.customer_name,
      "رقم الهاتف": item.customer_phone ?? "",
      التاريخ: formatDate(item.date),
      "عدد المنتجات": item.product_count,
      الإجمالي: item.total,
      "النقد المحصل": netCollectedOf(
        item.paid - item.credit_used,
        item.cash_refund_total || 0,
      ),
      "من رصيد العميل": item.credit_used,
      المتبقي: item.remaining,
      "حالة المرتجع":
        item.return_status === "full"
          ? "مرتجع كامل"
          : item.return_status === "partial"
            ? "مرتجع جزئي"
            : "",
      "إجمالي المرتجع": returnTotals.get(item.id) || 0,
      "الصافي بعد المرتجعات":
        Math.round((item.total - (returnTotals.get(item.id) || 0)) * 100) / 100,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows),
      "الفواتير",
    );
    if (returns.length) {
      const returnRows = returns.flatMap((record) =>
        (record.items || []).map((line, index) => ({
          "رقم الفاتورة": record.invoice_id,
          "رقم المرتجع": record.id || "",
          التاريخ: formatDate(record.created_at),
          المنتج: line.product_name,
          الكمية: line.quantity,
          الوحدة: line.unit_name || "وحدة",
          "قيمة الصنف": line.refund_amount,
          "إجمالي المرتجع": index === 0 ? record.total_refund : "",
          "تخفيض الدين": index === 0 ? record.debt_reduction : "",
          "نقد مردود": index === 0 ? record.cash_refund : "",
          "رصيد محفوظ للعميل":
            index === 0
              ? round2(
                  Number(record.credit_issued || 0) +
                    Number(record.credit_restored || 0),
                )
              : "",
        })),
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(returnRows),
        "المرتجعات",
      );
    }
    XLSX.writeFile(
      workbook,
      `فواتير_البيع_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  } catch {
    error.value = "تعذر تصدير الفواتير. حاول مرة أخرى.";
  } finally {
    exporting.value = false;
  }
}

async function clearCustomerFilter(): Promise<void> {
  await navigateTo({ path: route.path, query: {} }, { replace: true });
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  if (customerFilter.value.id) return;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    cursors.value = [null];
    void loadPage();
  }, 350);
});
watch(
  () => customerFilter.value.id,
  () => {
    search.value = "";
    page.value = 1;
    cursors.value = [null];
    void loadPage();
  },
);
onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

onMounted(async () => {
  if (await useAuthReady()) await loadPage();
  else loading.value = false;
});
</script>
