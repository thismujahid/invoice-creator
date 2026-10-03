<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">الفواتير</h2>
      <!-- HOME delta: debts actions (pay-all + totals gate) + export. -->
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="isFilteredInvoicesContainsDebts"
          icon="i-lucide-hand-coins"
          color="success"
          :disabled="loading"
          :loading="isPayingFull"
          @click="payFull(isFilteredInvoicesContainsDebts)"
          >سداد جميع الفواتير المعروضة</UButton
        >
        <UButton
          icon="i-lucide-download"
          color="info"
          variant="soft"
          :loading="exporting"
          :disabled="loading"
          @click="() => handleSuccess(true)"
          >تصدير البيانات</UButton
        >
      </div>
    </div>
    <div class="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <UInput
        v-model="searchText"
        placeholder="بحث في الصفحة بالاسم أو الهاتف"
        icon="i-lucide-search"
        size="lg"
        class="w-full"
      />
      <USelect
        v-model="paid_amount_filter"
        :items="debtsFilterOptions"
        value-key="value"
        placeholder="الديون"
        size="lg"
        class="w-full"
      />
      <div class="flex gap-2">
        <UiAppDateField
          v-model="selectedDate"
          label="تاريخ الفاتورة"
          class="flex-1"
        />
        <UButton
          v-if="selectedDate"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="flex shrink-0 items-center justify-center"
          aria-label="مسح التاريخ"
          @click="selectedDate = null"
        />
      </div>
    </div>
    <UiAppStatsSkeleton v-if="statsLoading" />
    <UAlert v-else-if="!statsReady" color="warning" variant="soft" class="mb-3" title="إجماليات الفواتير تحتاج تهيئة من أدوات المدير في صفحة الخزنة." />
    <div v-else class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ formatePrice(invoiceStats.total_sales) }}
            </div>
            <div class="text-xs text-gray-500">إجمالي المبيعات{{ selectedDate ? " في اليوم المحدد" : "" }}</div>
          </div>
          <UIcon
            name="i-lucide-banknote"
            class="size-8 shrink-0 text-blue-500"
          />
        </div>
      </UCard>
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ formatePrice(invoiceStats.total_profit) }}
            </div>
            <div class="text-xs text-gray-500">إجمالي الأرباح <span class="text-gray-400">(شامل الديون)</span></div>
          </div>
          <UIcon
            name="i-lucide-trending-up"
            class="size-8 shrink-0 text-emerald-500"
          />
        </div>
      </UCard>
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ formatePrice(invoiceStats.outstanding_customer_debt) }}
            </div>
            <div class="text-xs text-gray-500">إجمالي المديونية</div>
          </div>
          <UIcon
            name="i-lucide-trending-down"
            class="size-8 shrink-0 text-red-500"
          />
        </div>
      </UCard>
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ invoiceStats.invoice_count }}
            </div>
            <div class="text-xs text-gray-500">عدد الفواتير</div>
          </div>
          <UIcon
            name="i-lucide-files"
            class="size-8 shrink-0 text-emerald-600"
          />
        </div>
      </UCard>
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ formatePrice(invoiceStats.total_paid) }}
            </div>
            <div class="text-xs text-gray-500">إجمالي المدفوع</div>
          </div>
          <UIcon name="i-lucide-wallet" class="size-8 shrink-0 text-blue-500" />
        </div>
      </UCard>
    </div>
    <UiAppTableSkeleton v-if="loading" />
    <template v-else>
      <!-- Desktop table -->
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th class="p-2 text-start font-medium">الأسم</th>
              <th class="p-2 text-start font-medium">الهاتف</th>
              <th class="p-2 text-start font-medium">عدد المنتجات</th>
              <th class="p-2 text-start font-medium">الإجمالي</th>
              <th class="p-2 text-start font-medium">المتبقى</th>
              <th class="p-2 text-start font-medium">الربح</th>
              <th class="p-2 text-start font-medium">تاريخ الإنشاء</th>
              <th class="p-2 text-start font-medium">الأدوات</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in paginateArray"
              :key="row.id"
              class="border-b border-gray-100 last:border-0 hover:bg-gray-50"
            >
              <td class="p-2 font-medium">
                {{ row.name }}
                <UBadge v-if="row.returnBadge" color="warning" variant="soft" size="xs" class="ms-1">{{ row.returnBadge }}</UBadge>
              </td>
              <td class="p-2 text-gray-600" dir="ltr">{{ row.phone }}</td>
              <td class="p-2">{{ row.products_count }}</td>
              <td class="p-2 font-semibold">{{ row.total }}</td>
              <td class="p-2 text-red-600">{{ formatePrice(row.debt) }}</td>
              <td class="p-2 font-semibold text-emerald-600">
                {{ row.profit }}
              </td>
              <td class="p-2 text-gray-600">{{ row.created_at }}</td>
              <td class="p-2">
                <div class="flex gap-1.5">
                  <UTooltip
                    v-if="outstandingDebtOf(row.invoice) > 0"
                    text="سداد الفاتورة بالكامل"
                    ><UButton
                      icon="i-lucide-hand-coins"
                      color="success"
                      variant="soft"
                      size="xs"
                      :loading="payingFullInvoiceId === row.invoice.id"
                      :disabled="isPayingFull"
                      aria-label="سداد الفاتورة بالكامل"
                      @click="payFull([row.invoice])"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="نسخ الفاتورة"
                    ><UButton
                      icon="i-lucide-copy"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="نسخ الفاتورة"
                      @click="copyInvoiceForEdit(row.invoice, true)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="تعديل الفاتورة"
                    ><UButton
                      icon="i-lucide-pencil"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="تعديل الفاتورة"
                      @click="copyInvoiceForEdit(row.invoice, false)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="عرض الفاتورة"
                    ><UButton
                      icon="i-lucide-eye"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="عرض الفاتورة"
                      @click="viewRow = row"
                      class="flex items-center justify-center"
                    /></UTooltip>
                  <UTooltip text="إنشاء مرتجع"
                    ><UButton
                      icon="i-lucide-undo-2"
                      color="warning"
                      variant="soft"
                      size="xs"
                      aria-label="إنشاء مرتجع"
                      @click="openReturn(row.invoice)"
                      class="flex items-center justify-center"
                    /></UTooltip>
                  <UTooltip text="حذف"
                    ><UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="soft"
                      size="xs"
                      aria-label="حذف"
                      @click="confirmDelete = row"
                      class="flex items-center justify-center"
                  /></UTooltip>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-files"
          title="لا يوجد فواتير مسجلة بالمستخدم الحالي حتى الأن"
        />
      </div>
      <!-- Mobile cards -->
      <div class="grid gap-2 md:hidden">
        <UCard
          v-for="row in paginateArray"
          :key="row.id"
          variant="outline"
          @click="viewRow = row"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-bold">{{ row.name }}</div>
              <UBadge v-if="row.returnBadge" color="warning" variant="soft" size="xs" class="mt-0.5">{{ row.returnBadge }}</UBadge>
              <div class="text-xs text-gray-500" dir="ltr">{{ row.phone }}</div>
              <div class="mt-1 text-xs text-gray-500">
                {{ row.created_at }} • {{ row.products_count }} منتجات
              </div>
              <div class="mt-1 font-bold text-emerald-700">{{ row.total }}</div>
              <div
                v-if="row.debt"
                class="mt-0.5 text-xs font-semibold text-red-600"
              >
                المتبقي: {{ formatePrice(row.debt) }}
              </div>
              <div class="mt-0.5 text-xs font-semibold text-emerald-600">
                الربح: {{ row.profit }}
              </div>
            </div>
            <div class="flex shrink-0 gap-1.5" @click.stop>
              <UButton
                v-if="outstandingDebtOf(row.invoice) > 0"
                icon="i-lucide-hand-coins"
                color="success"
                variant="soft"
                size="xs"
                aria-label="سداد"
                @click="payFull([row.invoice])"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-copy"
                color="success"
                variant="soft"
                size="xs"
                aria-label="نسخ"
                @click="copyInvoiceForEdit(row.invoice, true)"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-pencil"
                color="success"
                variant="soft"
                size="xs"
                aria-label="تعديل"
                @click="copyInvoiceForEdit(row.invoice, false)"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-undo-2"
                color="warning"
                variant="soft"
                size="xs"
                aria-label="مرتجع"
                @click="openReturn(row.invoice)"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="soft"
                size="xs"
                aria-label="حذف"
                @click="confirmDelete = row"
                class="flex items-center justify-center"
              />
            </div>
          </div>
        </UCard>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-files"
          title="لا يوجد فواتير مسجلة بالمستخدم الحالي حتى الأن"
        />
      </div>
    </template>
    <div class="mt-3 flex items-center justify-between gap-2">
      <USelect v-model="currentPerPage" :items="[25, 50, 100]" size="sm" class="w-24" />
      <div class="flex items-center gap-2"><span class="text-xs text-gray-500">صفحة {{ currentPage }}</span><div class="flex gap-2" dir="ltr"><UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-left" aria-label="الصفحة التالية" :disabled="loading || !hasMoreInvoices" @click="nextInvoicePage" /><UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-right" aria-label="الصفحة السابقة" :disabled="loading || currentPage <= 1" @click="previousInvoicePage" /></div></div>
    </div>
    <!-- View invoice -->
    <UiAppDialog v-model:open="viewOpen" title="عرض الفاتورة">
      <div
        v-if="viewRow"
        class="invoice-creator-view max-h-[80vh] overflow-auto"
      >
        <Invoice
          class="mx-auto"
          :view-mode="true"
          :invoice-data="{
            ...viewRow.invoice,
            date: viewRow.created_at_object,
            time: viewRow.created_at_object,
          }"
          @close="viewRow = null"
        />
      </div>
    </UiAppDialog>
    <!-- Delete confirm -->
    <UiAppDialog v-model:open="deleteOpen" title="هل أنت متأكد">
      <p class="mb-4 text-gray-600">
        أنت علي وشك حذف الفاتورة الخاصة بـ {{ confirmDelete?.name }}
      </p>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton
            color="error"
            block
            :loading="deleting"
            @click="deleteConfirmed"
            >حذف</UButton
          >
          <UButton
            color="neutral"
            variant="ghost"
            block
            :disabled="deleting"
            @click="confirmDelete = null"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
    <!-- Create return -->
    <UiAppDialog v-model:open="returnOpen" title="إنشاء مرتجع">
      <div v-if="returnInvoice" class="space-y-3">
        <p class="text-sm text-gray-500">
          الفاتورة: <strong>{{ returnInvoice.customer_name }}</strong>
          — المتبقي الحالي: <strong>{{ formatePrice(outstandingDebtOf(returnInvoice)) }}</strong>
        </p>
        <div v-for="r in returnRows" :key="r.key" class="rounded-lg border border-gray-200 p-2.5">
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <div class="min-w-0 text-sm font-bold">{{ formatInvoiceLineName(r.product_name, r.unit_name) }}</div>
            <div class="shrink-0 text-xs text-gray-500">{{ r.unit_name }} • سعر البيع: {{ formatePrice(r.unit_price) }} • المتاح: {{ r.maxQty }}</div>
          </div>
          <UInputNumber v-model="r.qty" :min="0" :max="r.maxQty" :step="0.01" size="lg" class="w-full" />
          <div class="mt-1 text-xs text-gray-500">قيمة الاسترداد: {{ formatePrice(previewRefund(r)) }}</div>
        </div>
        <UEmpty v-if="!returnRows.length" icon="i-lucide-undo-2" title="لا توجد أصناف قابلة للإرجاع" />
        <UFormField label="ملاحظة">
          <UInput v-model="returnNote" placeholder="اختياري" size="lg" class="w-full" />
        </UFormField>
        <UAlert color="info" variant="soft" :title="`الإجمالي المسترد: ${formatePrice(returnPreviewTotal)} — تخفيض الدين: ${formatePrice(returnPreviewSplit.debtReduction)} — نقدي: ${formatePrice(returnPreviewSplit.cashRefund)}`" />
        <p v-if="returnError" class="text-sm font-semibold text-red-600">{{ returnError }}</p>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="warning" class="min-h-11 flex-1" :loading="returnBusy" :disabled="!returnRows.length" icon="i-lucide-undo-2" @click="submitReturn">تأكيد المرتجع</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="returnBusy" @click="returnOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Invoice } from "~/types";
import { toDateSafe } from "~/types";
import type { ReturnRow } from "~/composables/useInvoiceReturns";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import { doc, getDoc } from "firebase/firestore";
import { invoiceDayKey } from "~/composables/invoiceStats";

definePageMeta({ title: "الفواتير" });
const route = useRoute();
const authStore = useAuth();
const { db } = useFirebase();
// HOME delta: debts filter replaces the creator filter.
const paid_amount_filter = ref<number | null>(null);
const debtsFilterOptions = [
  { label: "الكل", value: null },
  { label: " فواتير ذات ديون", value: 1 },
];
const isPayingFull = ref(false);
const payingFullInvoiceId = ref<string | null>(null);
const selectedDate = ref<Date | null>(null);
const searchText = ref<string>("");
const currentPage = ref(1);
const currentPerPage = ref(25);
const invoiceCursors = ref<(QueryDocumentSnapshot | null)[]>([null]);
const hasMoreInvoices = ref(false);
const loading = ref(true);
const exporting = ref(false);
const deleting = ref(false);
const statsLoading = ref(true);
const statsReady = ref(false);
const invoiceStats = ref({ total_sales: 0, total_paid: 0, outstanding_customer_debt: 0, total_profit: 0, invoice_count: 0 });

async function loadInvoiceStats(): Promise<void> {
  statsLoading.value = true;
  try {
    const statsRef = selectedDate.value
      ? doc(db, "invoice_stats_daily", invoiceDayKey({ date: selectedDate.value }) as string)
      : doc(db, "store_stats", "current");
    const snapshot = await getDoc(statsRef);
    if (!snapshot.exists()) {
      statsReady.value = false;
      invoiceStats.value = { total_sales: 0, total_paid: 0, outstanding_customer_debt: 0, total_profit: 0, invoice_count: 0 };
      return;
    }
    const data = snapshot.data();
    statsReady.value = selectedDate.value !== null || data.initialized === true;
    if (!statsReady.value) {
      invoiceStats.value = { total_sales: 0, total_paid: 0, outstanding_customer_debt: 0, total_profit: 0, invoice_count: 0 };
      return;
    }
    invoiceStats.value = {
      total_sales: Number(data.total_sales) || 0,
      total_paid: Number(data.total_paid) || 0,
      outstanding_customer_debt: Number(data.outstanding_customer_debt ?? data.outstanding_debt) || 0,
      total_profit: Number(data.total_profit) || 0,
      invoice_count: Math.max(0, Math.floor(Number(data.invoice_count) || 0)),
    };
  } catch (error) {
    console.error(error);
    statsReady.value = false;
  } finally {
    statsLoading.value = false;
  }
}

// Native date input applies immediately.
watch(selectedDate, () => {
  void loadInvoices(true);
  void loadInvoiceStats();
});
watch(paid_amount_filter, () => { void loadInvoices(true); });
watch(currentPerPage, () => { void loadInvoices(true); });

// HOME delta: settle debts in full (single or bulk) — preserved from home.
async function payFull(listInvs: Invoice[] | null | undefined) {
  // Same UX as before, now atomic + ledger-logged via debt payments (F18/F19).
  const list = (listInvs ?? []).filter((inv) => inv.id && outstandingDebtOf(inv) > 0);
  if (!list.length || isPayingFull.value) return;
  isPayingFull.value = true;
  payingFullInvoiceId.value = list.length === 1 ? String(list[0]?.id) : null;
  try {
    await customerStore.fetchCustomers();
    const groups = new Map<string, Invoice[]>();
    for (const inv of list) {
      const key = debtsApi.customerKeyOf({
        customer_id: inv.customer_id,
        customer_phone: inv.customer_phone,
        customer_name: inv.customer_name,
      });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(inv);
    }
    for (const [, invs] of groups) {
      const first = invs[0];
      if (!first) continue;
      const legacyCustomer = customerStore.list.find((customer) =>
        String(customer.name || "").trim().toLocaleLowerCase() === String(first.customer_name || "").trim().toLocaleLowerCase() &&
        String(customer.phone ?? "").replace(/\D/g, "") === String(first.customer_phone ?? "").replace(/\D/g, ""),
      );
      const customer_id = first.customer_id || legacyCustomer?.id;
      if (!customer_id) {
        notifyToast("تعذر ربط الفاتورة القديمة بسجل العميل. لم يتم تسجيل السداد.", "error");
        return;
      }
      const allocations = invs.map((inv) => ({ type: "invoice" as const, reference_id: inv.id as string, amount: outstandingDebtOf(inv) }));
      const res = await debtsApi.payDebts({
        customer_id,
        amount: round2(allocations.reduce((sum, item) => sum + item.amount, 0)),
        allocations,
      });
      if (!res.ok) {
        notifyToast(res.error, "error");
        return;
      }
    }
    notifyToast("تم تسجيل السداد وتحديث الخزنة.", "success");
    await Promise.all([loadInvoices(), loadInvoiceStats()]);
  } finally {
    isPayingFull.value = false;
    payingFullInvoiceId.value = null;
  }
}

function formatTimestamp(
  seconds: number | undefined,
  returnObject?: false,
): string;
function formatTimestamp(seconds: number | undefined, returnObject: true): Date;
function formatTimestamp(
  seconds: number | undefined,
  returnObject?: boolean,
): string | Date {
  if (seconds === undefined || seconds === null)
    return returnObject ? new Date(0) : "-";
  const date = new Date(seconds * 1000);
  if (returnObject) return date;
  const formattedDate = date.toLocaleDateString("ar-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("ar-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formattedDate} ${formattedTime}`;
}
const { formatePrice, calcTotal, formatInvoiceLineName } = useHelpers();
const { round2, lineRefundValue, netRatioOf, splitRefund, outstandingDebtOf, lineBaseQuantity, grossProfitOf } = useFinance();
const invoicesStore = useInvoicesStore();
const customerStore = useCustomersStore();
const returnsApi = useInvoiceReturns();
const productsStore = useProductsStore();
const debtsApi = useDebts();
const { notify: notifyToast } = useAppToast();
// HOME delta: debts/profit math (preserved from home branch).
const toNum = (num: unknown): number => {
  return num && typeof num !== "number" ? Number(num) : (num as number) || 0;
};
const calcInvTotal = (inv: Invoice): number => grossProfitOf(inv.products);
const isFilteredInvoicesContainsDebts = computed<Invoice[] | null>(() => {
  if (searchText.value) {
    return filteredInvoices.value.some((i) => outstandingDebtOf(i) > 0)
      ? filteredInvoices.value
      : null;
  } else return null;
});
const filteredInvoices = computed<Invoice[]>(() => {
  const q = searchText.value?.trim();
  const customerId = String(route.query.customer_id ?? "");
  const customerName = String(route.query.customer_name ?? "");
  const customerPhone = String(route.query.customer_phone ?? "");
  return invoicesStore.list.filter(
    (invoice) =>
      (!customerId || invoice.customer_id === customerId || (!invoice.customer_id && invoice.customer_name === customerName && String(invoice.customer_phone ?? "") === customerPhone)) &&
      (!customerName || invoice.customer_name === customerName) &&
      (!customerPhone || String(invoice.customer_phone ?? "") === customerPhone) &&
      (!q || invoice.customer_name?.includes(q) || String(invoice.customer_phone ?? "").includes(q)),
  );
});
function discountAmount(invoice: Invoice): number {
  if (invoice.discount && invoice.discount_percentage) {
    return (calcTotal(invoice) * Number(invoice.discount)) / 100;
  }
  return Number(invoice.discount || 0);
}
const sortedInvoices = computed<Invoice[]>(() =>
  [...filteredInvoices.value].sort((a, b) => {
    const da = toDateSafe(a.date)?.getTime() ?? 0;
    const db = toDateSafe(b.date)?.getTime() ?? 0;
    return db - da;
  }),
);
const paginateArray = computed(() => {
  return sortedInvoices.value.map((invoice) => ({
      id: invoice.id,
      name: invoice.customer_name,
      phone: invoice.customer_phone,
      products_count: invoice.products?.length || 0,
      total: formatePrice(calcTotal(invoice) - discountAmount(invoice)),
      // HOME delta: debt + profit columns replace the creator column.
      debt: outstandingDebtOf(invoice),
      profit: formatePrice(calcInvTotal(invoice)),
      returnBadge: returnBadgeFor(invoice),
      created_at: formatTimestamp(
        (invoice.date as { seconds?: number })?.seconds,
      ),
      invoice,
      created_at_object: formatTimestamp(
        (invoice.date as { seconds?: number })?.seconds,
        true,
      ),
  }));
});
// FLAG [B1-FIXED]: clone before stripping id — never mutate the store row.
// NOTE: Firestore Timestamp class instances are NOT structuredClone-able
// (DataCloneError), so unwrap Vue reactivity with toRaw() and fall back
// to JSON on failure. Dates/Timestamps survive as ISO strings or
// {seconds,nanoseconds} plain objects — both handled by toDateSafe().
function copyInvoiceForEdit(source: Invoice, stripId: boolean): void {
  const raw = toRaw(source) as Invoice;
  let clone: Invoice;
  try {
    clone = structuredClone(raw);
  } catch {
    clone = JSON.parse(JSON.stringify(raw)) as Invoice;
  }
  if (stripId) delete clone.id;
  invoicesStore.invoiceToEdit = clone;
  navigateTo("/");
}
function invoiceFilters() {
  return {
    remaining: paid_amount_filter.value ?? undefined,
    date: selectedDate.value ?? undefined,
    customer_id: route.query.customer_id ? String(route.query.customer_id) : undefined,
    customer_name: route.query.customer_name ? String(route.query.customer_name) : undefined,
    customer_phone: route.query.customer_phone ? String(route.query.customer_phone) : undefined,
  };
}
async function loadInvoices(reset = false) {
  loading.value = true;
  try {
    if (reset) { currentPage.value = 1; invoiceCursors.value = [null]; }
    const page = await invoicesStore.fetchInvoicePage(invoiceFilters(), invoiceCursors.value[currentPage.value - 1] ?? null, currentPerPage.value);
    invoicesStore.list = page.items;
    hasMoreInvoices.value = page.hasMore;
    if (page.cursor) invoiceCursors.value[currentPage.value] = page.cursor;
  } finally {
    loading.value = false;
  }
}
async function nextInvoicePage(): Promise<void> { if (!hasMoreInvoices.value || loading.value) return; currentPage.value += 1; await loadInvoices(); }
async function previousInvoicePage(): Promise<void> { if (currentPage.value <= 1 || loading.value) return; currentPage.value -= 1; await loadInvoices(); }
watch(() => [route.query.customer_id, route.query.customer_name, route.query.customer_phone], () => { void loadInvoices(true); });
type InvoiceRow = {
  id?: string;
  name: string | null;
  phone?: string | number | null;
  products_count: number;
  total: string;
  debt: string | number | null;
  profit: string;
  returnBadge: string;
  created_at: string;
  invoice: Invoice;
  created_at_object: Date;
};
function returnBadgeFor(inv: Invoice): string {
  if (inv.return_status === "full") return "مرتجع كلي";
  if (inv.return_status === "partial") return "مرتجع جزئي";
  return "";
}
const viewRow = ref<InvoiceRow | null>(null);
const viewOpen = computed({
  get: () => viewRow.value !== null,
  set: (v: boolean) => {
    if (!v) viewRow.value = null;
  },
});
const confirmDelete = ref<InvoiceRow | null>(null);
const deleteOpen = computed({
  get: () => confirmDelete.value !== null,
  set: (v: boolean) => {
    if (!v) confirmDelete.value = null;
  },
});
async function deleteConfirmed() {
  const id = confirmDelete.value?.id;
  if (!id) return;
  deleting.value = true;
  try {
    const res = await invoicesStore.deleteInvoice(id);
    if (res.blocked) return; // guard message already shown; keep dialog open
    confirmDelete.value = null;
  } catch (err) {
    authStore.snackBarColor = "error";
    authStore.snackBarText = String(err);
  } finally {
    await Promise.all([loadInvoices(), loadInvoiceStats()]);
    deleting.value = false;
  }
}
async function handleSuccess(isSuccess: boolean) {
  if (!isSuccess) {
    return;
  }
  exporting.value = true;
  try {
    const allFiltered = await invoicesStore.fetchInvoicesForExport(invoiceFilters());
    const queryText = searchText.value.trim().toLocaleLowerCase();
    const matching = queryText ? allFiltered.filter((invoice) => `${invoice.customer_name ?? ""} ${invoice.customer_phone ?? ""}`.toLocaleLowerCase().includes(queryText)) : allFiltered;
    const res = await invoicesStore.exportInvoicesToExcel(matching);
    authStore.snackBarText = res;
    authStore.snackBarColor = "success";
  } catch (err) {
    authStore.snackBarText = String(err);
    authStore.snackBarColor = "error";
  } finally {
    exporting.value = false;
  }
}
// Return dialog state (F11).
const returnInvoice = ref<Invoice | null>(null);
const returnRows = ref<ReturnRow[]>([]);
const returnNote = ref("");
const returnError = ref("");
const returnBusy = ref(false);
const returnOpen = computed({
  get: () => returnInvoice.value !== null,
  set: (v: boolean) => {
    if (!v) returnInvoice.value = null;
  },
});
async function openReturn(inv: Invoice): Promise<void> {
  returnError.value = "";
  returnNote.value = "";
  returnInvoice.value = inv;
  returnRows.value = [];
  const prev = await returnsApi.fetchReturnsForInvoice(inv.id as string);
  returnRows.value = returnsApi.buildReturnRows(inv, prev);
}
/** Exact preview refund for a cost-group row: spread over its own lines. */
function rowRefundValue(r: ReturnRow, ratio: number): number {
  let need = Math.min(round2(toNum(r.qty)), r.maxQty);
  let total = 0;
  for (const ln of r.lines) {
    if (need <= 0) break;
    const take = Math.min(need, ln.qty - ln.returnedQty);
    if (take <= 0) continue;
    need = round2(need - take);
    total = round2(total + lineRefundValue(ln.price, take, ratio));
  }
  return total;
}
function previewRefund(r: ReturnRow): number {
  if (!returnInvoice.value) return 0;
  return rowRefundValue(r, netRatioOf(returnInvoice.value));
}
const returnPreviewSplit = computed(() => {
  if (!returnInvoice.value) return { debtReduction: 0, cashRefund: 0, total: 0 };
  const ratio = netRatioOf(returnInvoice.value);
  const total = round2(returnRows.value.reduce((s, r) => s + rowRefundValue(r, ratio), 0));
  const split = splitRefund(total, outstandingDebtOf(returnInvoice.value));
  return { ...split, total };
});
const returnPreviewTotal = computed(() => returnPreviewSplit.value.total);
async function submitReturn(): Promise<void> {
  if (!returnInvoice.value) return;
  returnError.value = "";
  returnBusy.value = true;
  try {
    const res = await returnsApi.createReturn(
      returnInvoice.value,
      returnRows.value
        .map((r) => ({ rowKey: r.key, quantity: Math.min(round2(toNum(r.qty)), r.maxQty) }))
        .filter((i) => i.quantity > 0),
      returnNote.value.trim() || null,
    );
    if (!res.ok) {
      returnError.value = res.error;
      return;
    }
    notifyToast(
      `تم تسجيل المرتجع — تخفيض الدين: ${formatePrice(res.debtReduction)}، نقدي: ${formatePrice(res.cashRefund)}.`,
      "success",
    );
    returnInvoice.value = null;
    await Promise.all([loadInvoices(), loadInvoiceStats(), productsStore.fetchProducts()]);
  } finally {
    returnBusy.value = false;
  }
}
onMounted(async () => {
  const authed = await useAuthReady();
  if (!authed) {
    loading.value = false;
    statsLoading.value = false;
    return; // layout redirects to /login
  }
  await Promise.all([loadInvoices(), loadInvoiceStats()]);
});
</script>
