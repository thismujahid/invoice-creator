<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">الخزنة</h2>
      <div v-if="cashbox.initialized" class="flex flex-wrap gap-2">
        <UButton icon="i-lucide-plus" color="success" @click="depositOpen = true">إضافة أموال</UButton>
        <UButton icon="i-lucide-minus" color="error" variant="soft" @click="withdrawOpen = true">سحب أموال</UButton>
      </div>
    </div>

    <USkeleton v-if="cashbox.loading" class="h-24 w-full" />
    <!-- Onboarding: opening balance once -->
    <UCard v-else-if="!cashbox.initialized" variant="outline" class="mb-3 border-dashed">
      <template #header>
        <div class="font-bold">تهيئة الخزنة لأول مرة</div>
      </template>
      <p class="mb-3 text-sm text-gray-500">أدخل النقدية الفعلية الموجودة حالياً بالمحل. تُسجل كرصيد افتتاحي ولا يمكن تكرارها.</p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <UFormField label="الرصيد الافتتاحي" required>
          <UInputNumber v-model="openingAmount" :min="0" placeholder="مثال: 12350" size="lg" class="w-full" />
        </UFormField>
        <UFormField label="ملاحظة">
          <UInput v-model="openingNote" placeholder="رصيد افتتاحي" size="lg" class="w-full" />
        </UFormField>
      </div>
      <template #footer>
        <UButton color="success" block size="lg" :loading="openingBusy" icon="i-lucide-vault" @click="doOpening">تأكيد الرصيد الافتتاحي</UButton>
      </template>
    </UCard>

    <template v-else>
      <!-- Dashboard -->
      <div class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <UCard variant="outline">
          <div class="text-lg font-bold text-emerald-700 sm:text-xl">{{ formatePrice(cashbox.balance) }}</div>
          <div class="text-xs text-gray-500">النقدية الحالية</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">{{ formatePrice(agg.costValue) }}</div>
          <div class="text-xs text-gray-500">قيمة المخزون بالتكلفة</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-emerald-700 sm:text-xl">{{ formatePrice(cashbox.balance + agg.costValue) }}</div>
          <div class="text-xs text-gray-500">إجمالي أصول المحل</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">{{ formatePrice(agg.saleValue) }}</div>
          <div class="text-xs text-gray-500">قيمة بيع المخزون</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-blue-600 sm:text-xl">{{ formatePrice(agg.expectedProfit) }}</div>
          <div class="text-xs text-gray-500">الربح المتوقع من المخزون <span class="text-gray-400">(غير محقق)</span></div>
        </UCard>
      </div>

      <!-- History filter -->
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs font-bold text-gray-400">سجل العمليات</p>
        <USelect v-model="typeFilter" :items="typeOptions" value-key="value" size="sm" class="w-48" />
      </div>
      <USkeleton v-if="cashbox.loadingTxns" class="h-24 w-full" />
      <template v-else>
        <div class="hidden overflow-x-auto md:block">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-gray-500">
                <th class="p-2 text-start font-medium">التاريخ</th>
                <th class="p-2 text-start font-medium">النوع</th>
                <th class="p-2 text-start font-medium">الوصف</th>
                <th class="p-2 text-start font-medium">المبلغ</th>
                <th class="p-2 text-start font-medium">الاتجاه</th>
                <th class="p-2 text-start font-medium">المرجع</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in paged" :key="t.id" class="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td class="p-2 text-gray-600">{{ formatDateTime(t.created_at) }}</td>
                <td class="p-2">{{ CASH_TYPE_LABELS[t.type] || t.type }}</td>
                <td class="p-2 text-gray-600">{{ t.note || "—" }}</td>
                <td class="p-2 font-semibold" :class="t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'" dir="ltr">
                  {{ t.direction === "in" ? "+" : "−" }}{{ formatePrice(t.amount) }}
                </td>
                <td class="p-2">
                  <UBadge :color="t.direction === 'in' ? 'success' : 'error'" variant="soft">{{ t.direction === "in" ? "وارد" : "صادر" }}</UBadge>
                </td>
                <td class="p-2 text-xs text-gray-500">{{ refLabel(t) }}</td>
              </tr>
            </tbody>
          </table>
          <UEmpty v-if="!paged.length" icon="i-lucide-vault" title="لا توجد عمليات مسجلة" />
        </div>
        <div class="grid gap-2 md:hidden">
          <UCard v-for="t in paged" :key="t.id" variant="outline">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate text-sm font-bold">{{ CASH_TYPE_LABELS[t.type] || t.type }}</div>
                <div class="text-xs text-gray-500">{{ formatDateTime(t.created_at) }}{{ t.note ? ` • ${t.note}` : "" }}</div>
                <div class="text-xs text-gray-400">{{ refLabel(t) }}</div>
              </div>
              <div class="shrink-0 font-bold" :class="t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'" dir="ltr">
                {{ t.direction === "in" ? "+" : "−" }}{{ formatePrice(t.amount) }}
              </div>
            </div>
          </UCard>
          <UEmpty v-if="!paged.length" icon="i-lucide-vault" title="لا توجد عمليات مسجلة" />
        </div>
      </template>
      <div class="mt-3 flex items-center justify-between gap-2">
        <USelect v-model="currentPerPage" :items="[10, 25, 50, 100]" size="sm" class="w-24" />
        <UPagination v-model:page="currentPage" :total="filtered.length" :items-per-page="currentPerPage" :sibling-count="1" size="sm" />
      </div>
    </template>

    <!-- Admin migration tools (F22): idempotent, chunked, no cash replay -->
    <div v-if="isAdmin" class="mt-4 border-t border-gray-100 pt-3">
      <p class="mb-2 text-xs font-bold text-gray-400">أدوات التهيئة والترحيل (لمرة واحدة، آمنة التكرار)</p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <UCard variant="outline">
          <div class="mb-1 text-sm font-bold">ربط العملاء بالفواتير القديمة</div>
          <p class="mb-2 text-xs text-gray-500">مطابقة رقم الهاتف فقط، وتخطي المرتبط وغير المطابق. {{ migCustomerMsg }}</p>
          <UProgress v-if="migCustomerBusy" :value="migCustomerPct" class="mb-2" />
          <UButton color="neutral" variant="soft" size="sm" :loading="migCustomerBusy" icon="i-lucide-link" @click="runCustomerBackfill">بدء الربط</UButton>
        </UCard>
        <UCard variant="outline">
          <div class="mb-1 text-sm font-bold">توثيق المخزون الافتتاحي</div>
          <p class="mb-2 text-xs text-gray-500">سجل افتتاحي لكل منتج لم يوثق بعد. {{ migStockMsg }}</p>
          <UProgress v-if="migStockBusy" :value="migStockPct" class="mb-2" />
          <UButton color="neutral" variant="soft" size="sm" :loading="migStockBusy" icon="i-lucide-archive" @click="runStockSeed">بدء التوثيق</UButton>
        </UCard>
      </div>
    </div>

    <!-- Deposit dialog -->
    <UiAppDialog v-model:open="depositOpen" title="إضافة أموال">
      <div class="space-y-3">
        <UFormField label="المبلغ" required :error="formError">
          <UInputNumber v-model="amount" :min="0" placeholder="مثال: 5000" size="lg" class="w-full" />
        </UFormField>
        <UFormField label="ملاحظة">
          <UInput v-model="note" placeholder="مثال: إضافة رأس مال" size="lg" class="w-full" />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="success" class="min-h-11 flex-1" :loading="busy" icon="i-lucide-plus" @click="doAdjust('manual_deposit', 'in')">تأكيد الإضافة</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="busy" @click="closeForms">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>

    <!-- Withdraw dialog -->
    <UiAppDialog v-model:open="withdrawOpen" title="سحب أموال">
      <div class="space-y-3">
        <UAlert color="info" variant="soft" :title="`الرصيد الحالي: ${formatePrice(cashbox.balance)}`" />
        <UFormField label="المبلغ" required :error="formError">
          <UInputNumber v-model="amount" :min="0" placeholder="المبلغ" size="lg" class="w-full" />
        </UFormField>
        <UFormField label="ملاحظة">
          <UInput v-model="note" placeholder="سبب السحب" size="lg" class="w-full" />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="error" class="min-h-11 flex-1" :loading="busy" icon="i-lucide-minus" @click="doAdjust('manual_withdrawal', 'out')">تأكيد السحب</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="busy" @click="closeForms">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { CashDirection, CashTransactionType } from "~/types/finance";
import { CASH_TYPE_LABELS } from "~/types/finance";
import { toDateSafe } from "~/types";

definePageMeta({ title: "الخزنة" });
const { formatePrice } = useHelpers();
const { inventoryAggregates, round2 } = useFinance();
const cashbox = useCashbox();
const products = useProductsStore();
const migration = useMigration();
const { notify } = useAppToast();

// Migration tools state (F22)
const migCustomerBusy = ref(false);
const migCustomerPct = ref(0);
const migCustomerMsg = ref("");
const migStockBusy = ref(false);
const migStockPct = ref(0);
const migStockMsg = ref("");
async function runCustomerBackfill(): Promise<void> {
  migCustomerBusy.value = true;
  migCustomerMsg.value = "";
  try {
    const res = await migration.backfillCustomerIds((d, t) => {
      migCustomerPct.value = t ? Math.round((d / t) * 100) : 100;
    });
    migCustomerMsg.value = `تم: رُبط ${res.matched} من ${res.total} فاتورة.`;
    notify(`اكتمل الربط: ${res.matched} فاتورة.`, "success");
  } catch (e) {
    migCustomerMsg.value = "فشل الترحيل.";
    notify("تعذر إتمام الترحيل.", "error");
  } finally {
    migCustomerBusy.value = false;
  }
}
async function runStockSeed(): Promise<void> {
  migStockBusy.value = true;
  migStockMsg.value = "";
  try {
    const res = await migration.seedOpeningStock((d, t) => {
      migStockPct.value = t ? Math.round((d / t) * 100) : 100;
    });
    migStockMsg.value = `تم: وُثق ${res.created} من ${res.total} منتج.`;
    notify(`اكتمل التوثيق: ${res.created} منتج.`, "success");
  } catch (e) {
    migStockMsg.value = "فشل التوثيق.";
    notify("تعذر إتمام التوثيق.", "error");
  } finally {
    migStockBusy.value = false;
  }
}

const depositOpen = ref(false);
const withdrawOpen = ref(false);
const amount = ref<number | undefined>(undefined);
const note = ref("");
const formError = ref("");
const busy = ref(false);
const openingAmount = ref<number | undefined>(undefined);
const openingNote = ref("");
const openingBusy = ref(false);

const typeFilter = ref<string | null>(null);
const typeOptions = computed(() => [
  { label: "الكل", value: null },
  ...Object.entries(CASH_TYPE_LABELS).map(([value, label]) => ({ label, value })),
]);
const currentPage = ref(1);
const currentPerPage = ref(25);
watch([typeFilter], () => {
  currentPage.value = 1;
});

const agg = computed(() => inventoryAggregates(products.list));
const filtered = computed(() =>
  typeFilter.value ? cashbox.transactions.filter((t) => t.type === typeFilter.value) : [...cashbox.transactions],
);
const paged = computed(() => {
  const s = (currentPage.value - 1) * currentPerPage.value;
  return filtered.value.slice(s, s + currentPerPage.value);
});

function formatDateTime(v: unknown): string {
  const d = toDateSafe(v);
  if (!d) return "-";
  return `${d.toLocaleDateString("ar-EG")} ${d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}`;
}

function refLabel(t: { invoice_id?: string | null; return_id?: string | null; loan_id?: string | null; product_id?: string | null }): string {
  if (t.invoice_id) return `فاتورة #${String(t.invoice_id).slice(0, 6)}`;
  if (t.return_id) return `مرتجع #${String(t.return_id).slice(0, 6)}`;
  if (t.loan_id) return `سلفة #${String(t.loan_id).slice(0, 6)}`;
  if (t.product_id) return `منتج #${String(t.product_id).slice(0, 6)}`;
  return "—";
}

function closeForms(): void {
  depositOpen.value = false;
  withdrawOpen.value = false;
  amount.value = undefined;
  note.value = "";
  formError.value = "";
}

async function doAdjust(type: CashTransactionType, direction: CashDirection): Promise<void> {
  formError.value = "";
  const v = round2(amount.value);
  if (!v || v <= 0) {
    formError.value = "المبلغ يجب أن يكون أكبر من صفر.";
    return;
  }
  if (direction === "out" && v > cashbox.balance) {
    formError.value = `الرصيد الحالي (${formatePrice(cashbox.balance)}) لا يكفي.`;
    return;
  }
  busy.value = true;
  try {
    const res = await cashbox.adjustCash({ type, direction, amount: v, note: note.value.trim() || null });
    if (!res.ok) {
      formError.value = res.error;
      return;
    }
    notify(direction === "in" ? "تمت إضافة المبلغ للخزنة بنجاح." : "تم سحب المبلغ من الخزنة بنجاح.", "success");
    closeForms();
  } finally {
    busy.value = false;
  }
}

async function doOpening(): Promise<void> {
  const v = round2(openingAmount.value);
  if (!v || v <= 0) {
    notify("أدخل الرصيد الافتتاحي (أكبر من صفر).", "error");
    return;
  }
  openingBusy.value = true;
  try {
    const res = await cashbox.ensureOpeningBalance(v, openingNote.value.trim() || null);
    if (!res.ok) {
      notify(res.error, "error");
      return;
    }
    notify("تم تهيئة الخزنة بالرصيد الافتتاحي.", "success");
  } finally {
    openingBusy.value = false;
  }
}

onMounted(async () => {
  await Promise.all([cashbox.fetchCashbox(), cashbox.fetchTransactions(), products.fetchProducts()]);
});
</script>
