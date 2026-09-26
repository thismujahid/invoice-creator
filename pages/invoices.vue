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
          v-if="isAdmin"
          :icon="hideTotal ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          color="error"
          variant="soft"
          :disabled="loading"
          @click="!hideTotal ? (hideTotal = true) : (startViewTotal = true)"
          >عرض الأموال</UButton
        >
        <FormsAuthScreen
          @close="() => (startViewTotal = false)"
          @success="
            (val) =>
              val ? ((hideTotal = !hideTotal), (startViewTotal = false)) : false
          "
          v-if="startViewTotal && isAdmin"
          success-text="تم التحقق من الهوية بنجاح... تم عرض إجماليات الفواتير المعروضة بنجاح"
          title="برجاء تأكيد هويتك لتتمكن من عرض إجماليات الفواتير المعروضة"
        />
        <UButton
          icon="i-lucide-download"
          color="info"
          variant="soft"
          v-if="isAdmin"
          :loading="exporting"
          :disabled="loading"
          @click="startExport = true"
          >تصدير البيانات</UButton
        >
        <FormsAuthScreen
          @close="() => (startExport = false)"
          @success="handleSuccess"
          v-if="startExport && isAdmin"
          success-text="تم التحقق من الهوية بنجاح... جاري تصدير الفواتير"
          title="برجاء تأكيد هويتك لتتمكن من تصدير الفواتير"
        />
      </div>
    </div>
    <div class="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <UInput
        v-model="searchText"
        placeholder="بحث بالاسم أو الهاتف"
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
        @update:model-value="loadInvoices"
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
          @click="
            selectedDate = null;
            loadInvoices();
          "
        />
      </div>
    </div>
    <!-- HOME delta: debts dashboard cards (replaces single total alert). -->
    <div class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ hideTotal ? "***********" : totalPaidInvs }}
            </div>
            <div class="text-xs text-gray-500">إجمالي المبيعات</div>
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
              {{ hideTotal ? "***********" : totalProfit }}
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
              {{ totalDebts }}
            </div>
            <div class="text-xs text-gray-500">إجمالي الديون</div>
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
              {{ totalInvoices }}
            </div>
            <div class="text-xs text-gray-500">إجمالي الفواتير</div>
          </div>
          <UIcon
            name="i-lucide-files"
            class="size-8 shrink-0 text-emerald-600"
          />
        </div>
      </UCard>
    </div>
    <FormsAuthScreen
      @close="() => (startViewTotal = false)"
      @success="
        (val) =>
          val ? ((hideTotal = !hideTotal), (startViewTotal = false)) : false
      "
      v-if="startViewTotal && isAdmin"
      success-text="تم التحقق من الهوية بنجاح... تم عرض إجماليات الفواتير المعروضة بنجاح"
      title="برجاء تأكيد هويتك لتتمكن من عرض إجماليات الفواتير المعروضة"
    />
    <USkeleton v-if="loading" class="h-24 w-full" />
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
                {{ hideTotal ? "****" : row.profit }}
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
                  <UTooltip v-if="isAdmin" text="حذف"
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
                الربح: {{ hideTotal ? "****" : row.profit }}
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
                v-if="isAdmin"
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
      <USelect
        v-model="currentPerPage"
        :items="[10, 25, 50, 100, 150]"
        size="sm"
        class="w-24"
      />
      <UPagination
        dir="ltr"
        v-model:page="currentPage"
        :total="filteredInvoices.length"
        :items-per-page="currentPerPage"
        :sibling-count="1"
        size="sm"
      />
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
            <div class="min-w-0 text-sm font-bold">{{ r.product_name }}</div>
            <div class="shrink-0 text-xs text-gray-500">سعر البيع: {{ formatePrice(r.unit_price) }} • المتاح: {{ r.maxQty }}</div>
          </div>
          <UInputNumber v-model="r.qty" :min="0" :max="r.maxQty" :step="1" size="lg" class="w-full" />
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

definePageMeta({ title: "الفواتير" });
const hideTotal = ref(true);
const authStore = useAuth();
// HOME delta: debts filter replaces the creator filter.
const paid_amount_filter = ref<number | null>(null);
const debtsFilterOptions = [
  { label: "الكل", value: null },
  { label: " فواتير ذات ديون", value: 1 },
];
const isPayingFull = ref(false);
const startExport = ref(false);
const selectedDate = ref<Date | null>(null);
const startViewTotal = ref(false);
const searchText = ref<string>("");
const currentPage = ref(1);
const currentPerPage = ref(10);
const loading = ref(false);
const exporting = ref(false);
const deleting = ref(false);

// Native date input applies immediately.
watch(selectedDate, () => {
  currentPage.value = 1;
  void loadInvoices();
});

// FLAG [B4-FIXED]: page reset moved to watcher — no side-effects inside computed.
watch(searchText, () => {
  currentPage.value = 1;
});

// HOME delta: settle debts in full (single or bulk) — preserved from home.
async function payFull(listInvs: Invoice[] | null | undefined) {
  // Same UX as before, now atomic + ledger-logged via debt payments (F18/F19).
  const list = (listInvs ?? []).filter((inv) => inv.id && outstandingDebtOf(inv) > 0);
  if (!list.length) return;
  isPayingFull.value = true;
  try {
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
      const customer_id =
        first.customer_id || String(first.customer_phone ?? first.customer_name ?? "");
      const res = await debtsApi.payDebts({
        customer_id,
        allocations: invs.map((inv) => ({
          type: "invoice" as const,
          reference_id: inv.id as string,
          amount: outstandingDebtOf(inv),
        })),
      });
      if (!res.ok) {
        notifyToast(res.error, "error");
        return;
      }
    }
    notifyToast("تم تسجيل السداد وتحديث الخزنة.", "success");
    await Promise.all([loadInvoices(), loadReturnsMap()]);
  } finally {
    isPayingFull.value = false;
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
const { formatePrice, calcTotal } = useHelpers();
const { round2, lineRefundValue, netRatioOf, splitRefund, outstandingDebtOf } = useFinance();
const invoicesStore = useInvoicesStore();
const returnsApi = useInvoiceReturns();
const debtsApi = useDebts();
const { notify: notifyToast } = useAppToast();
// HOME delta: debts/profit math (preserved from home branch).
const toNum = (num: unknown): number => {
  return num && typeof num !== "number" ? Number(num) : (num as number) || 0;
};
const calcInvTotal = (inv: Invoice): number =>
  inv.products?.reduce(
    (total, prod) =>
      (total +=
        (toNum(prod.product_price) - toNum(prod.product_cost_price)) *
        toNum(prod.product_quantity)),
    0,
  ) ?? 0;
const totalDebts = computed(() => {
  return formatePrice(
    filteredInvoices.value.reduce((t, i) => (t += outstandingDebtOf(i)), 0),
  );
});
const totalProfit = computed(() => {
  let total = 0;
  for (const inv of filteredInvoices.value) total += calcInvTotal(inv);
  return formatePrice(total);
});
const totalPaidInvs = computed(() => {
  return formatePrice(
    filteredInvoices.value.reduce(
      (total, inv) => total + (calcTotal(inv) - discountAmount(inv)),
      0,
    ),
  );
});
const totalInvoices = computed(() => filteredInvoices.value.length);
const isFilteredInvoicesContainsDebts = computed<Invoice[] | null>(() => {
  if (searchText.value) {
    return filteredInvoices.value.some((i) => outstandingDebtOf(i) > 0)
      ? filteredInvoices.value
      : null;
  } else return null;
});
const filteredInvoices = computed<Invoice[]>(() => {
  const q = searchText.value?.trim();
  if (!q) return [...invoicesStore.list];
  return invoicesStore.list.filter(
    (invoice) =>
      invoice.customer_name?.includes(q) ||
      String(invoice.customer_phone ?? "").includes(q),
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
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  return sortedInvoices.value
    .slice(startIndex, startIndex + currentPerPage.value)
    .map((invoice) => ({
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
async function loadInvoices() {
  loading.value = true;
  try {
    // HOME delta: debts filter (remaining >= 0.1) replaces creator filter.
    await invoicesStore.fetchInvoices({
      remaining: paid_amount_filter.value ?? undefined,
      date: selectedDate.value ?? undefined,
    });
  } finally {
    loading.value = false;
  }
}
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
// Derived return state per invoice (from invoice_returns, never mutating lines).
const returnsByInvoice = ref(new Map<string, number>());
async function loadReturnsMap(): Promise<void> {
  const all = await returnsApi.fetchRecentReturns(500);
  const m = new Map<string, number>();
  for (const r of all) {
    const sum = (r.items ?? []).reduce((s, it) => s + toNum(it.quantity), 0);
    m.set(r.invoice_id, round2((m.get(r.invoice_id) ?? 0) + sum));
  }
  returnsByInvoice.value = m;
}
function returnBadgeFor(inv: Invoice): string {
  if (!inv.id) return "";
  const returned = returnsByInvoice.value.get(inv.id) ?? 0;
  if (returned <= 0) return "";
  const sold = (inv.products ?? []).reduce((s, l) => s + toNum(l.product_quantity), 0);
  return returned + 1e-9 >= sold ? "مرتجع كلي" : "مرتجع جزئي";
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
    await loadInvoices();
    deleting.value = false;
  }
}
async function handleSuccess(isSuccess: boolean) {
  if (!isSuccess) {
    startExport.value = false;
    return;
  }
  exporting.value = true;
  try {
    const res = await invoicesStore.exportInvoicesToExcel(
      filteredInvoices.value,
    );
    authStore.snackBarText = res;
    authStore.snackBarColor = "success";
  } catch (err) {
    authStore.snackBarText = String(err);
    authStore.snackBarColor = "error";
  } finally {
    exporting.value = false;
    startExport.value = false;
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
function previewRefund(r: ReturnRow): number {
  if (!returnInvoice.value) return 0;
  return lineRefundValue(r.unit_price, Math.min(toNum(r.qty), r.maxQty), netRatioOf(returnInvoice.value));
}
const returnPreviewSplit = computed(() => {
  if (!returnInvoice.value) return { debtReduction: 0, cashRefund: 0, total: 0 };
  const ratio = netRatioOf(returnInvoice.value);
  const total = round2(
    returnRows.value.reduce((s, r) => s + lineRefundValue(r.unit_price, Math.min(toNum(r.qty), r.maxQty), ratio), 0),
  );
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
        .map((r) => ({ product_id: r.product_id, quantity: Math.min(round2(toNum(r.qty)), r.maxQty) }))
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
    await Promise.all([loadInvoices(), loadReturnsMap()]);
  } finally {
    returnBusy.value = false;
  }
}
void loadInvoices();
void loadReturnsMap();
</script>
