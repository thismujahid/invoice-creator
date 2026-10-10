<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4" dir="rtl">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">دفتر الديون</h2>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="soft"
          :loading="loading"
          @click="reload"
          >تحديث</UButton
        >
        <UButton
          icon="i-lucide-hand-coins"
          color="success"
          @click="openLoan(null)"
          >إضافة سلفة</UButton
        >
      </div>
    </div>
    <div
      v-if="customerFilter.id"
      class="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm"
    >
      <span class="min-w-0 flex-1 truncate"
        >ديون: {{ customerFilter.name || customerFilter.id }}</span
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
      placeholder="بحث بالاسم أو الهاتف"
      icon="i-lucide-search"
      size="lg"
      class="mb-3 w-full sm:max-w-xs"
    />
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :title="error"
      class="mb-3"
    >
      <template #actions
        ><UButton size="xs" @click="reload">إعادة المحاولة</UButton></template
      >
    </UAlert>
    <UiAppTableSkeleton v-if="loading" />
    <template v-else>
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b text-gray-500">
              <th class="p-2 text-start">العميل</th>
              <th
                class="p-2 text-start"
                title="إجمالي المتبقي من الفواتير × عددها"
              >
                الفواتير وقيمتها
              </th>
              <th class="p-2 text-start">سلف</th>
              <th class="p-2 text-start">له</th>
              <th
                class="p-2 text-start"
                title="الصافي المتوقع عند خصم رصيد العميل"
              >
                بعد التسوية
              </th>
              <th
                class="p-2 text-start"
                title="إجمالي الفواتير والسلف قبل التسوية"
              >
                عام
              </th>
              <th class="p-2 text-start">الأدوات</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in paged"
              :key="row.key"
              class="border-b last:border-0"
            >
              <td class="p-2 font-medium">
                {{ row.name
                }}<span
                  class="mt-0.5 block text-end text-xs font-normal text-gray-500"
                  dir="ltr"
                  >{{ row.phone ?? "—" }}</span
                >
              </td>
              <td class="p-2 font-semibold">
                {{ formatePrice(row.invoiceDebt) }} ج × {{ row.unpaidCount }}
              </td>
              <td class="p-2">{{ formatePrice(row.loanDebt) }}</td>
              <td class="p-2 font-bold text-emerald-700">
                {{ formatePrice(row.creditBalance) }}
              </td>
              <td
                class="p-2 font-bold"
                :class="
                  row.totalDebt > row.creditBalance
                    ? 'text-red-600'
                    : row.totalDebt < row.creditBalance
                      ? 'text-emerald-700'
                      : 'text-gray-600'
                "
              >
                {{
                  row.totalDebt > row.creditBalance
                    ? "عليه"
                    : row.totalDebt < row.creditBalance
                      ? "له"
                      : "متوازن"
                }}
                {{
                  formatePrice(
                    Math.abs(round2(row.totalDebt - row.creditBalance)),
                  )
                }}
              </td>
              <td class="p-2 font-bold text-red-600">
                {{ formatePrice(row.totalDebt) }}
              </td>
              <td class="p-2">
                <div class="flex gap-1.5">
                  <UTooltip text="عرض التفاصيل"
                    ><UButton
                      size="xs"
                      icon="i-lucide-eye"
                      color="neutral"
                      variant="soft"
                      aria-label="عرض التفاصيل"
                      @click="openDetails(row)"
                  /></UTooltip>
                  <UTooltip text="تسديد دفعة"
                    ><UButton
                      size="xs"
                      icon="i-lucide-hand-coins"
                      color="success"
                      variant="soft"
                      aria-label="تسديد دفعة"
                      :disabled="!row.customer_id"
                      @click="openPay(row)"
                  /></UTooltip>
                  <CustomerCreditSettlement
                    :customer-id="row.customer_id"
                    :customer-name="row.name"
                    :credit-balance="row.creditBalance"
                    :total-debt="row.totalDebt"
                    :obligations="[...row.invoices, ...row.loans]"
                    @settled="reload"
                  />
                  <UTooltip text="إضافة سلفة"
                    ><UButton
                      size="xs"
                      icon="i-lucide-plus"
                      color="info"
                      variant="soft"
                      aria-label="إضافة سلفة"
                      :disabled="!row.customer_id"
                      @click="openLoan(row)"
                  /></UTooltip>
                  <UTooltip text="عرض السلف"
                    ><UButton
                      size="xs"
                      icon="i-lucide-wallet"
                      color="neutral"
                      variant="soft"
                      aria-label="عرض السلف"
                      @click="openLoans(row)"
                  /></UTooltip>
                  <UTooltip text="سجل السداد"
                    ><UButton
                      size="xs"
                      icon="i-lucide-history"
                      color="neutral"
                      variant="soft"
                      aria-label="سجل السداد"
                      :disabled="!row.customer_id"
                      @click="openHistory(row)"
                  /></UTooltip>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="grid gap-2 md:hidden">
        <UCard
          v-for="row in paged"
          :key="row.key"
          variant="outline"
          @click="openDetails(row)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-bold">{{ row.name }}</div>
              <div class="text-end text-xs text-gray-500" dir="ltr">
                {{ row.phone ?? "—" }}
              </div>
            </div>
            <div class="flex max-w-28 flex-wrap justify-end gap-1" @click.stop>
              <UButton
                size="xs"
                icon="i-lucide-eye"
                color="neutral"
                variant="soft"
                aria-label="عرض التفاصيل"
                @click="openDetails(row)"
              />
              <UButton
                size="xs"
                icon="i-lucide-hand-coins"
                color="success"
                variant="soft"
                aria-label="تسديد دفعة"
                :disabled="!row.customer_id"
                @click="openPay(row)"
              />
              <CustomerCreditSettlement
                :customer-id="row.customer_id"
                :customer-name="row.name"
                :credit-balance="row.creditBalance"
                :total-debt="row.totalDebt"
                :obligations="[...row.invoices, ...row.loans]"
                @settled="reload"
              />
              <UButton
                size="xs"
                icon="i-lucide-plus"
                color="info"
                variant="soft"
                aria-label="إضافة سلفة"
                :disabled="!row.customer_id"
                @click="openLoan(row)"
              />
              <UButton
                size="xs"
                icon="i-lucide-wallet"
                color="neutral"
                variant="soft"
                aria-label="عرض السلف"
                @click="openLoans(row)"
              />
              <UButton
                size="xs"
                icon="i-lucide-history"
                color="neutral"
                variant="soft"
                aria-label="سجل السداد"
                :disabled="!row.customer_id"
                @click="openHistory(row)"
              />
            </div>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div>
              الفواتير:
              <b dir="ltr"
                >{{ formatePrice(row.invoiceDebt) }} ج ×
                {{ row.unpaidCount }}</b
              >
            </div>
            <div>
              سلف: <b>{{ formatePrice(row.loanDebt) }}</b>
            </div>
            <div>
              له:
              <b class="text-emerald-700">{{
                formatePrice(row.creditBalance)
              }}</b>
            </div>
            <div>
              عام: <b class="text-red-600">{{ formatePrice(row.totalDebt) }}</b>
            </div>
            <div
              class="col-span-2 font-bold"
              :class="
                row.totalDebt > row.creditBalance
                  ? 'text-red-600'
                  : row.totalDebt < row.creditBalance
                    ? 'text-emerald-700'
                    : 'text-gray-600'
              "
            >
              بعد التسوية:
              {{
                row.totalDebt > row.creditBalance
                  ? "عليه"
                  : row.totalDebt < row.creditBalance
                    ? "له"
                    : "متوازن"
              }}
              {{
                formatePrice(
                  Math.abs(round2(row.totalDebt - row.creditBalance)),
                )
              }}
              ج
            </div>
          </div>
        </UCard>
      </div>
      <UEmpty
        v-if="!filtered.length && !error"
        icon="i-lucide-notebook-text"
        title="لا توجد ديون أو أرصدة للعملاء"
      />
      <div class="mt-3 flex items-center justify-between gap-2">
        <USelect
          v-model="perPage"
          :items="[10, 25, 50, 100]"
          size="sm"
          class="w-24"
        />
        <UPagination
          v-model:page="page"
          dir="ltr"
          :total="filtered.length"
          :items-per-page="perPage"
          :sibling-count="1"
          size="sm"
        />
      </div>
    </template>

    <UiAppDialog
      v-model:open="detailsOpen"
      :title="`ديون ${selected?.name || ''}`"
    >
      <div v-if="selected" class="max-h-[70vh] space-y-3 overflow-y-auto">
        <div class="rounded-lg bg-gray-50 p-2 text-sm">
          إجمالي الدين:
          <b class="text-red-600">{{ formatePrice(selected.totalDebt) }} ج</b>
        </div>
        <div class="rounded-lg bg-emerald-50 p-2 text-sm">
          رصيد له:
          <b class="text-emerald-700"
            >{{ formatePrice(selected.creditBalance) }} ج</b
          >
        </div>
        <CustomerCreditSettlement
          :customer-id="selected.customer_id"
          :customer-name="selected.name"
          :credit-balance="selected.creditBalance"
          :total-debt="selected.totalDebt"
          :obligations="[...selected.invoices, ...selected.loans]"
          size="sm"
          label
          @settled="reload"
        />
        <p class="text-xs font-bold text-gray-500">الفواتير غير المسددة</p>
        <div
          v-for="item in selected.invoices"
          :key="item.id"
          class="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
        >
          <div>
            {{ formatDate(item.date) }} • الإجمالي
            {{ formatePrice(item.total) }}
            <div class="text-xs text-gray-500">
              مدفوع: {{ formatePrice(item.paid) }}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <b class="text-red-600">{{ formatePrice(item.remaining) }}</b
            ><UButton
              size="xs"
              icon="i-lucide-eye"
              color="neutral"
              variant="soft"
              aria-label="عرض الفاتورة"
              :loading="viewingId === item.id"
              @click="viewInvoice(item.id)"
            />
          </div>
        </div>
        <UEmpty
          v-if="!selected.invoices.length"
          title="لا توجد فواتير غير مسددة"
        />
        <div class="flex gap-2">
          <UButton
            size="sm"
            color="info"
            variant="soft"
            @click="openLoans(selected)"
            >عرض السلف ({{ selected.loans.length }})</UButton
          ><UButton
            size="sm"
            color="neutral"
            variant="soft"
            :disabled="!selected.customer_id"
            @click="openHistory(selected)"
            >سجل السداد</UButton
          >
        </div>
      </div>
      <template #footer
        ><div class="flex w-full gap-2">
          <UButton
            color="success"
            class="flex-1"
            :disabled="!selected?.customer_id"
            @click="selected && openPay(selected)"
            >تسديد دفعة</UButton
          ><UButton
            color="info"
            variant="soft"
            class="flex-1"
            :disabled="!selected?.customer_id"
            @click="selected && openLoan(selected)"
            >سلفة جديدة</UButton
          >
        </div></template
      >
    </UiAppDialog>

    <UiAppDialog v-model:open="loansOpen" title="سلف على العميل ورصيده"
      ><div class="max-h-[70vh] space-y-2 overflow-y-auto">
        <div
          v-if="selected"
          class="flex justify-between rounded-lg bg-emerald-50 p-2 text-sm"
        >
          <span>رصيد له من المرتجعات</span
          ><b class="text-emerald-700"
            >{{ formatePrice(selected.creditBalance) }} ج</b
          >
        </div>
        <div
          v-if="selected"
          class="flex justify-between rounded-lg bg-red-50 p-2 text-sm"
        >
          <span>سلف عليه</span
          ><b class="text-red-600">{{ formatePrice(selected.loanDebt) }} ج</b>
        </div>
        <div
          v-for="item in selected?.loans ?? []"
          :key="item.id"
          class="rounded-lg border p-2 text-sm"
        >
          <div class="flex justify-between">
            <b
              >{{ formatDate(item.date) }} • الأصل
              {{ formatePrice(item.total) }}</b
            ><b class="text-red-600">{{ formatePrice(item.remaining) }}</b>
          </div>
          <div class="text-xs text-gray-500">
            مدفوع: {{ formatePrice(item.paid)
            }}{{ item.note ? ` • ${item.note}` : "" }}
          </div>
        </div>
        <UEmpty v-if="!selected?.loans.length" title="لا يوجد سلف" /></div
    ></UiAppDialog>

    <UiAppDialog v-model:open="historyOpen" title="سجل السداد"
      ><div class="max-h-[70vh] space-y-2 overflow-y-auto">
        <USkeleton v-if="historyLoading" class="h-16 w-full" />
        <template v-else
          ><div
            v-for="item in payments"
            :key="item.id"
            class="rounded-lg border p-2 text-sm"
          >
            <div class="flex justify-between">
              <b>{{ formatDate(item.created_at) }}</b
              ><b class="text-emerald-600"
                >{{ item.source === "credit" ? "تسوية رصيد" : "نقدي" }}:
                {{ formatePrice(item.amount) }} ج</b
              >
            </div>
            <div class="text-xs text-gray-500">
              {{
                item.allocations
                  .map(
                    (a) =>
                      `${a.type === "invoice" ? "فاتورة" : "سلفة"}: ${formatePrice(a.amount)}`,
                  )
                  .join(" • ")
              }}{{ item.note ? ` • ${item.note}` : "" }}
            </div>
          </div>
          <UEmpty v-if="!payments.length" title="لا يوجد سدادات"
        /></template></div
    ></UiAppDialog>

    <UiAppDialog v-model:open="loanOpen" title="إضافة سلفة"
      ><div class="space-y-3">
        <UFormField label="العميل" required
          ><USelectMenu
            v-model="loanCustomer"
            :items="customers.list"
            by="id"
            label-key="name"
            :search-input="{
              placeholder: 'بحث عن عميل...',
              icon: 'i-lucide-search',
            }"
            class="w-full"
            :loading="customerLoading"
        /></UFormField>
        <UAlert
          v-if="customerError"
          color="error"
          variant="soft"
          :title="customerError"
          ><template #actions
            ><UButton size="xs" @click="refreshCustomers"
              >إعادة المحاولة</UButton
            ></template
          ></UAlert
        >
        <FormsCustomer
          v-model="customerOpen"
          :refresher="refreshCustomers"
          @done="onCustomerCreated"
          ><UButton size="sm" color="neutral" variant="soft"
            >إضافة عميل جديد</UButton
          ></FormsCustomer
        >
        <UFormField label="مبلغ السلفة" required
          ><UInputNumber
            v-model="loanAmount"
            :min="0.01"
            :step="0.01"
            class="w-full"
        /></UFormField>
        <UFormField label="ملاحظة"
          ><UInput v-model="loanNote" class="w-full"
        /></UFormField>
        <UAlert
          v-if="loanError"
          color="error"
          variant="soft"
          :title="loanError"
        />
      </div>
      <template #footer
        ><UButton color="success" block :loading="loanBusy" @click="createLoan"
          >تأكيد السلفة</UButton
        ></template
      ></UiAppDialog
    >

    <UiAppDialog
      v-model:open="payOpen"
      :title="`تسديد دفعة — ${payTarget?.name || ''}`"
      ><div v-if="payTarget" class="space-y-3">
        <div class="rounded-lg bg-gray-50 p-2 text-sm">
          إجمالي الدين: <b>{{ formatePrice(payTarget.totalDebt) }} ج</b>
        </div>
        <UFormField label="المبلغ المدفوع" required
          ><UInputNumber
            v-model="payAmount"
            :min="0.01"
            :max="payTarget.totalDebt"
            :step="0.01"
            class="w-full"
        /></UFormField>
        <div class="max-h-48 space-y-1 overflow-y-auto">
          <div
            v-for="item in payObligations"
            :key="`${item.type}-${item.id}`"
            class="flex justify-between gap-2 rounded border p-2 text-sm"
          >
            <span
              >{{ item.type === "invoice" ? "فاتورة" : "سلفة" }} •
              {{ formatDate(item.date) }}</span
            ><span
              >{{ formatePrice(allocations[`${item.type}-${item.id}`] ?? 0) }} /
              {{ formatePrice(item.remaining) }}</span
            >
          </div>
        </div>
        <UFormField label="ملاحظة"
          ><UInput v-model="payNote" class="w-full"
        /></UFormField>
        <UAlert
          v-if="paymentError"
          color="error"
          variant="soft"
          :title="paymentError"
        />
      </div>
      <template #footer
        ><UButton color="success" block :loading="paymentBusy" @click="pay"
          >تأكيد السداد</UButton
        ></template
      ></UiAppDialog
    >

    <UiAppDialog v-model:open="invoiceOpen" title="عرض الفاتورة" :z-index="700"
      ><USkeleton v-if="viewingId" class="h-48 w-full" />
      <div v-else class="max-h-[80vh] overflow-auto">
        <Invoice
          v-if="viewedInvoice"
          :invoice-data="viewedInvoice"
          :returns="viewedReturns"
          view-mode
          @close="invoiceOpen = false"
        /><ReturnHistory
          v-if="viewedReturns.length"
          class="mt-4"
          :customer-returns="viewedReturns"
        /></div
    ></UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import {
  toDateSafe,
  type Customer,
  type Invoice,
  type InvoiceDate,
} from "~/types";
import type { InvoiceReturn } from "~/types/finance";

interface Obligation {
  id: string;
  type: "invoice" | "loan";
  total: number;
  paid: number;
  remaining: number;
  date: InvoiceDate;
  note?: string | null;
}
interface DebtRow {
  key: string;
  customer_id: string | null;
  name: string;
  phone: string | number | null;
  invoices: Obligation[];
  loans: Obligation[];
  invoiceDebt: number;
  loanDebt: number;
  totalDebt: number;
  creditBalance: number;
  unpaidCount: number;
}
interface Payment {
  id: string;
  amount: number;
  source?: "cash" | "credit";
  created_at: InvoiceDate;
  note: string | null;
  allocations: {
    type: "invoice" | "loan";
    reference_id: string;
    amount: number;
  }[];
}

const customers = useCustomersStore();
const { formatePrice, formatDate } = useHelpers();
const { notify } = useAppToast();
const { round2 } = useFinance();
const route = useRoute();
const customerFilter = computed(() => ({
  id:
    typeof route.query.customer_id === "string" ? route.query.customer_id : "",
  name:
    typeof route.query.customer_name === "string"
      ? route.query.customer_name
      : "",
}));
const book = ref<DebtRow[]>([]);
const search = ref("");
const loading = ref(true);
const error = ref("");
const page = ref(1);
const perPage = ref(10);
const selected = ref<DebtRow | null>(null);
const detailsOpen = ref(false);
const loansOpen = ref(false);
const historyOpen = ref(false);
const historyLoading = ref(false);
const payments = ref<Payment[]>([]);
const customerLoading = ref(false);
const customerError = ref("");
const customerOpen = ref(false);
const loanOpen = ref(false);
const loanCustomer = ref<Customer>();
const loanAmount = ref<number>();
const loanNote = ref("");
const loanError = ref("");
const loanBusy = ref(false);
const loanRequestId = ref(crypto.randomUUID());
const payOpen = ref(false);
const payTarget = ref<DebtRow | null>(null);
const payAmount = ref<number>();
const payNote = ref("");
const paymentError = ref("");
const paymentBusy = ref(false);
const paymentRequestId = ref(crypto.randomUUID());
const allocations = ref<Record<string, number>>({});
const invoiceOpen = ref(false);
const viewedInvoice = ref<Invoice | null>(null);
const viewedReturns = ref<InvoiceReturn[]>([]);
const viewingId = ref<string | null>(null);

const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase();
  const rows = customerFilter.value.id
    ? book.value.filter((row) => row.customer_id === customerFilter.value.id)
    : book.value;
  return term
    ? rows.filter(
        (row) =>
          row.name.toLocaleLowerCase().includes(term) ||
          String(row.phone ?? "").includes(term),
      )
    : rows;
});
const paged = computed(() =>
  filtered.value.slice(
    (page.value - 1) * perPage.value,
    page.value * perPage.value,
  ),
);
const payObligations = computed(() =>
  payTarget.value
    ? [...payTarget.value.invoices, ...payTarget.value.loans].sort(
        (a, b) =>
          (toDateSafe(a.date)?.getTime() ?? 0) -
          (toDateSafe(b.date)?.getTime() ?? 0),
      )
    : [],
);
watch([search, perPage], () => {
  page.value = 1;
});
watch(
  () => customerFilter.value.id,
  () => {
    page.value = 1;
  },
);
async function clearCustomerFilter(): Promise<void> {
  await navigateTo({ path: route.path, query: {} }, { replace: true });
}
watch(payAmount, () => {
  let rest = round2(payAmount.value ?? 0);
  const next: Record<string, number> = {};
  for (const item of payObligations.value) {
    const amount = round2(Math.min(item.remaining, rest));
    if (amount > 0) next[`${item.type}-${item.id}`] = amount;
    rest = round2(rest - amount);
  }
  allocations.value = next;
});

async function reload(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const result = await callStaff<Record<string, never>, { items: DebtRow[] }>(
      "getCashierDebtBook",
      {},
    );
    book.value = result.items;
    if (selected.value)
      selected.value =
        book.value.find((row) => row.key === selected.value?.key) ?? null;
    if (!selected.value) detailsOpen.value = false;
  } catch {
    error.value = "تعذر تحميل دفتر الديون. حاول مرة أخرى.";
  } finally {
    loading.value = false;
  }
}
async function refreshCustomers(): Promise<void> {
  customerLoading.value = true;
  customerError.value = "";
  try {
    await customers.fetchCustomers(undefined, true);
  } catch {
    customerError.value = "تعذر تحميل العملاء. حاول مرة أخرى.";
  } finally {
    customerLoading.value = false;
  }
}
function onCustomerCreated(customer: Customer): void {
  loanCustomer.value =
    customers.list.find((item) => item.id === customer.id) ?? customer;
}
function openDetails(row: DebtRow): void {
  selected.value = row;
  detailsOpen.value = true;
}
function openLoans(row: DebtRow): void {
  selected.value = row;
  detailsOpen.value = false;
  loansOpen.value = true;
}
async function openHistory(row: DebtRow): Promise<void> {
  if (!row.customer_id) return;
  selected.value = row;
  detailsOpen.value = false;
  payments.value = [];
  historyOpen.value = true;
  historyLoading.value = true;
  try {
    const result = await callStaff<
      { customerId: string },
      { items: Payment[] }
    >("getCashierPayments", { customerId: row.customer_id });
    payments.value = result.items;
  } catch {
    error.value = "تعذر تحميل سجل السداد.";
  } finally {
    historyLoading.value = false;
  }
}
function openLoan(row: DebtRow | null): void {
  detailsOpen.value = false;
  loanCustomer.value = row?.customer_id
    ? (customers.list.find((item) => item.id === row.customer_id) ?? {
        id: row.customer_id,
        name: row.name,
        phone: row.phone,
      })
    : undefined;
  loanAmount.value = undefined;
  loanNote.value = "";
  loanError.value = "";
  loanRequestId.value = crypto.randomUUID();
  loanOpen.value = true;
}
async function createLoan(): Promise<void> {
  if (loanBusy.value) return;
  if (!loanCustomer.value?.id || !loanAmount.value || loanAmount.value <= 0) {
    loanError.value = "اختر العميل وأدخل مبلغًا صحيحًا.";
    return;
  }
  loanBusy.value = true;
  loanError.value = "";
  try {
    await callStaff("createStaffLoan", {
      requestId: loanRequestId.value,
      customerId: loanCustomer.value.id,
      amount: loanAmount.value,
      note: loanNote.value.trim() || null,
    });
    loanOpen.value = false;
    notify("تم تسجيل السلفة وخصمها من الخزنة.", "success");
    await reload();
  } catch {
    loanError.value = "تعذر تسجيل السلفة. تحقق من رصيد الخزنة وحاول مجددًا.";
  } finally {
    loanBusy.value = false;
  }
}
function openPay(row: DebtRow): void {
  if (!row.customer_id) return;
  detailsOpen.value = false;
  payTarget.value = row;
  payAmount.value = undefined;
  payNote.value = "";
  paymentError.value = "";
  paymentRequestId.value = crypto.randomUUID();
  payOpen.value = true;
}
async function pay(): Promise<void> {
  if (paymentBusy.value || !payTarget.value?.customer_id) return;
  const amount = round2(payAmount.value ?? 0);
  const selectedAllocations = payObligations.value
    .map((item) => ({
      type: item.type,
      reference_id: item.id,
      amount: allocations.value[`${item.type}-${item.id}`] ?? 0,
    }))
    .filter((item) => item.amount > 0);
  if (
    amount <= 0 ||
    amount > payTarget.value.totalDebt ||
    Math.abs(
      round2(selectedAllocations.reduce((sum, item) => sum + item.amount, 0)) -
        amount,
    ) > 0.005
  ) {
    paymentError.value = "أدخل مبلغًا صحيحًا لا يتجاوز إجمالي الدين.";
    return;
  }
  paymentBusy.value = true;
  paymentError.value = "";
  try {
    await callStaff("payStaffDebts", {
      requestId: paymentRequestId.value,
      customer_id: payTarget.value.customer_id,
      amount,
      allocations: selectedAllocations,
      note: payNote.value.trim() || null,
    });
    payOpen.value = false;
    notify("تم تسجيل السداد وتحديث الخزنة.", "success");
    await reload();
  } catch {
    paymentError.value = "تعذر السداد. حدّث دفتر الديون وحاول مجددًا.";
  } finally {
    paymentBusy.value = false;
  }
}
async function viewInvoice(id: string): Promise<void> {
  if (viewingId.value) return;
  detailsOpen.value = false;
  viewedInvoice.value = null;
  viewedReturns.value = [];
  viewingId.value = id;
  invoiceOpen.value = true;
  try {
    const [invoice, returns] = await Promise.all([
      callStaff<{ id: string }, Invoice>("getCashierInvoice", { id }),
      callStaff<{ id: string }, { items: InvoiceReturn[] }>(
        "getCashierInvoiceReturns",
        { id },
      ),
    ]);
    viewedInvoice.value = invoice;
    viewedReturns.value = returns.items;
  } catch {
    error.value = "تعذر فتح الفاتورة.";
    invoiceOpen.value = false;
  } finally {
    viewingId.value = null;
  }
}
onMounted(async () => {
  if (!(await useAuthReady())) {
    loading.value = false;
    return;
  }
  await Promise.all([reload(), refreshCustomers()]);
});
</script>
