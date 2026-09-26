<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">الخزنة</h2>
      <div v-if="cashbox.initialized" class="flex flex-wrap gap-2">
        <UButton
          icon="i-lucide-plus"
          color="success"
          @click="depositOpen = true"
          >إضافة أموال</UButton
        >
        <UButton
          icon="i-lucide-minus"
          color="error"
          variant="soft"
          @click="withdrawOpen = true"
          >سحب أموال</UButton
        >
      </div>
    </div>

    <USkeleton v-if="cashbox.loading" class="h-24 w-full" />
    <!-- Onboarding: opening balance once -->
    <UCard
      v-else-if="!cashbox.initialized"
      variant="outline"
      class="mb-3 border-dashed"
    >
      <template #header>
        <div class="font-bold">تهيئة الخزنة لأول مرة</div>
      </template>
      <p class="mb-3 text-sm text-gray-500">
        أدخل النقدية الفعلية الموجودة حالياً بالمحل. تُسجل كرصيد افتتاحي ولا
        يمكن تكرارها.
      </p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <UFormField label="الرصيد الافتتاحي" required>
          <UInputNumber
            v-model="openingAmount"
            :min="0"
            placeholder="مثال: 12350"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UFormField label="ملاحظة">
          <UInput
            v-model="openingNote"
            placeholder="رصيد افتتاحي"
            size="lg"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <UButton
          color="success"
          block
          size="lg"
          :loading="openingBusy"
          icon="i-lucide-vault"
          @click="doOpening"
          >تأكيد الرصيد الافتتاحي</UButton
        >
      </template>
    </UCard>

    <template v-else>
      <!-- Dashboard -->
      <div class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <UCard variant="outline">
          <div class="text-lg font-bold text-emerald-700 sm:text-xl">
            {{ formatePrice(cashbox.balance) }}
          </div>
          <div class="text-xs text-gray-500">النقدية الحالية</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">
            {{ formatePrice(agg.costValue) }}
          </div>
          <div class="text-xs text-gray-500">قيمة المخزون بالتكلفة</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-emerald-700 sm:text-xl">
            {{ formatePrice(cashbox.balance + agg.costValue) }}
          </div>
          <div class="text-xs text-gray-500">إجمالي أصول المحل</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">
            {{ formatePrice(agg.saleValue) }}
          </div>
          <div class="text-xs text-gray-500">قيمة بيع المخزون</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-blue-600 sm:text-xl">
            {{ formatePrice(agg.expectedProfit) }}
          </div>
          <div class="text-xs text-gray-500">
            الربح المتوقع من المخزون
            <span class="text-gray-400">(غير محقق)</span>
          </div>
        </UCard>
      </div>

      <!-- Store-wide totals from the same source + formulas as /invoices -->
      <p class="mb-2 mt-4 text-xs font-bold text-gray-400">إجماليات المحل</p>
      <USkeleton v-if="statsLoading" class="mb-3 h-24 w-full" />
      <div v-else class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <UCard variant="outline">
          <div class="text-lg font-bold text-emerald-700 sm:text-xl">
            {{ formatePrice(stats.sales) }}
          </div>
          <div class="text-xs text-gray-500">إجمالي المبيعات</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-red-600 sm:text-xl">
            {{ formatePrice(stats.debts) }}
          </div>
          <div class="text-xs text-gray-500">إجمالي الديون</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-emerald-600 sm:text-xl">
            {{ formatePrice(stats.profits) }}
          </div>
          <div class="text-xs text-gray-500">
            إجمالي الأرباح <span class="text-gray-400">(شامل الديون)</span>
          </div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">{{ stats.invoices }}</div>
          <div class="text-xs text-gray-500">إجمالي الفواتير</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">{{ stats.customers }}</div>
          <div class="text-xs text-gray-500">إجمالي العملاء</div>
        </UCard>
      </div>

      <!-- History filter -->
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs font-bold text-gray-400">سجل العمليات</p>
        <USelect
          v-model="typeFilter"
          :items="typeOptions"
          value-key="value"
          size="sm"
          class="w-48"
        />
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
              <tr
                v-for="t in paged"
                :key="t.id"
                class="border-b border-gray-100 last:border-0 hover:bg-gray-50"
              >
                <td class="p-2 text-gray-600">
                  {{ formatDateTime(t.created_at) }}
                </td>
                <td class="p-2">{{ CASH_TYPE_LABELS[t.type] || t.type }}</td>
                <td class="p-2 text-gray-600">{{ t.note || "—" }}</td>
                <td
                  class="p-2 font-semibold"
                  :class="
                    t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'
                  "
                  dir="ltr"
                >
                  {{ t.direction === "in" ? "+" : "−"
                  }}{{ formatePrice(t.amount) }}
                </td>
                <td class="p-2">
                  <UBadge
                    :color="t.direction === 'in' ? 'success' : 'error'"
                    variant="soft"
                    >{{ t.direction === "in" ? "وارد" : "صادر" }}</UBadge
                  >
                </td>
                <td class="p-2 text-xs text-gray-500">{{ refLabel(t) }}</td>
              </tr>
            </tbody>
          </table>
          <UEmpty
            v-if="!paged.length"
            icon="i-lucide-vault"
            title="لا توجد عمليات مسجلة"
          />
        </div>
        <div class="grid gap-2 md:hidden">
          <UCard v-for="t in paged" :key="t.id" variant="outline">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate text-sm font-bold">
                  {{ CASH_TYPE_LABELS[t.type] || t.type }}
                </div>
                <div class="text-xs text-gray-500">
                  {{ formatDateTime(t.created_at)
                  }}{{ t.note ? ` • ${t.note}` : "" }}
                </div>
                <div class="text-xs text-gray-400">{{ refLabel(t) }}</div>
              </div>
              <div
                class="shrink-0 font-bold"
                :class="
                  t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'
                "
                dir="ltr"
              >
                {{ t.direction === "in" ? "+" : "−"
                }}{{ formatePrice(t.amount) }}
              </div>
            </div>
          </UCard>
          <UEmpty
            v-if="!paged.length"
            icon="i-lucide-vault"
            title="لا توجد عمليات مسجلة"
          />
        </div>
      </template>
      <div class="mt-3 flex items-center justify-between gap-2">
        <USelect
          v-model="currentPerPage"
          :items="[10, 25, 50, 100]"
          size="sm"
          class="w-24"
        />
        <UPagination
          v-model:page="currentPage"
          :total="filtered.length"
          dir="ltr"
          :items-per-page="currentPerPage"
          :sibling-count="1"
          size="sm"
        />
      </div>
    </template>

    <!-- Admin migration tools (F22): idempotent, chunked, no cash replay -->
    <div v-if="isAdmin" class="mt-4 border-t border-gray-100 pt-3">
      <p class="mb-2 text-xs font-bold text-gray-400">
        أدوات التهيئة والترحيل (لمرة واحدة، آمنة التكرار)
      </p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <UCard variant="outline">
          <div class="mb-1 text-sm font-bold">
            ربط العملاء بالفواتير القديمة
          </div>
          <p class="mb-2 text-xs text-gray-500">
            مطابقة دقيقة (هاتف + اسم) فقط، وتخطي الغامض. {{ migCustomerMsg }}
          </p>
          <UProgress
            v-if="migCustomerBusy"
            :value="migCustomerPct"
            class="mb-2"
          />
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            :loading="migCustomerBusy"
            icon="i-lucide-link"
            @click="runCustomerBackfill"
            >بدء الربط</UButton
          >
        </UCard>
        <UCard variant="outline">
          <div class="mb-1 text-sm font-bold">مراجعة الروابط وإصلاح الخاطئ</div>
          <p class="mb-2 text-xs text-gray-500">
            يفحص الروابط الحالية ويمسح غير الموثوق. {{ migRepairMsg }}
          </p>
          <UProgress v-if="migRepairBusy" :value="migRepairPct" class="mb-2" />
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            :loading="migRepairBusy"
            icon="i-lucide-shield-check"
            @click="runRepairLinks"
            >بدء المراجعة</UButton
          >
        </UCard>
        <UCard variant="outline">
          <div class="mb-1 text-sm font-bold">تهيئة ملخصات الديون</div>
          <p class="mb-2 text-xs text-gray-500">
            للدفتر الخفيف وإجماليات الخزنة: كل الفواتير الناقصة. {{ migSumMsg }}
          </p>
          <UProgress v-if="migSumBusy" :value="migSumPct" class="mb-2" />
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            :loading="migSumBusy"
            icon="i-lucide-list-checks"
            @click="runSumBackfill"
            >بدء التهيئة</UButton
          >
        </UCard>
        <UCard variant="outline">
          <div class="mb-1 text-sm font-bold">مراجعة متوسط تكلفة المخزون</div>
          <p class="mb-2 text-xs text-gray-500">
            إعادة تشغيل سجل الحركات ومقارنته بالمخزن — الإصلاح اليدوي فقط للصفوف القابلة. {{ repairMsg }}
          </p>
          <UProgress v-if="repairBusy" :value="repairPct" class="mb-2" />
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            :loading="repairBusy"
            icon="i-lucide-scale"
            @click="runRepairAnalyze"
            >بدء التحليل</UButton
          >
        </UCard>
        <UCard variant="outline" class="sm:col-span-2">
          <div class="flex items-center flex-col md:flex-row justify-between">
            <div>
              <div class="mb-1 text-sm font-bold">
                إدخال أرصدة المخزون الافتتاحية ({{ missingStock.length }})
              </div>
              <p class="mb-2 text-xs text-gray-500">
                للمنتجات التي لم يُدخل رصيدها بعد فقط — يُحفظ مرة واحدة لكل
                منتج. مؤشر الكمية القليلة افتراضيًا 5 ويمكن تغييره لكل منتج.
                {{ migStockMsg }}
              </p>
            </div>
            <UInput
              v-if="missingStock.length"
              v-model="stockSearch"
              placeholder="بحث عن منتج بالاسم..."
              icon="i-lucide-search"
              size="md"
              class="mb-2 w-full sm:max-w-xs"
            />
          </div>
          <div
            v-if="missingStock.length"
            class="mb-2 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2"
          >
            <div
              v-for="p in visibleMissingStock"
              :key="p.id"
              class="space-y-2 rounded-lg border border-gray-200 p-2"
            >
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold">{{ p.name }}</div>
                <div class="text-xs text-gray-500">
                  التكلفة: {{ formatePrice(p.cost_price) }}
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <UFormField label="الرصيد الافتتاحي">
                  <UInputNumber
                    v-model="openingQtys[p.id as string]"
                    :min="0"
                    :step="1"
                    placeholder="الكمية"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="مؤشر الكمية القليلة">
                  <UInputNumber
                    :model-value="openingThresholds[p.id as string] ?? p.low_stock_threshold ?? 5"
                    :min="0"
                    :step="0.5"
                    placeholder="5"
                    class="w-full"
                    @update:model-value="(value) => (openingThresholds[p.id as string] = value ?? 5)"
                  />
                </UFormField>
              </div>
            </div>
            <div
              v-if="!filteredMissingStock.length"
              class="text-sm text-gray-400 sm:col-span-2"
            >
              لا توجد منتجات مطابقة للبحث.
            </div>
            <!-- Chunk footer: counter + load-more (no observer: simple, no timing edge cases) -->
            <div
              v-if="visibleMissingStock.length < filteredMissingStock.length"
              class="flex flex-col items-center gap-1 py-1 sm:col-span-2"
            >
              <span class="text-xs text-gray-400">
                عرض {{ visibleMissingStock.length }} من {{ filteredMissingStock.length }}
              </span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                @click="showMoreStock"
                >عرض المزيد</UButton
              >
            </div>
          </div>
          <UProgress v-if="migStockBusy" :value="migStockPct" class="mb-2" />
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            :loading="migStockBusy"
            :disabled="!missingStock.length"
            icon="i-lucide-archive"
            @click="runStockEntry"
            >حفظ الأرصدة والمؤشرات</UButton
          >
        </UCard>
      </div>
    </div>

    <!-- Cost repair review -->
    <UiAppDialog v-model:open="repairOpen" title="مراجعة متوسط التكلفة">
      <div v-if="repairRows.length" class="mb-2 flex items-center justify-between gap-2 text-xs">
        <span class="text-gray-500">{{ repairRows.length }} منتج • المحدد: {{ selectedRepairable.length }}</span>
        <div class="flex gap-2">
          <UButton size="xs" color="neutral" variant="soft" @click="toggleRepairSelectAll">
            {{ allRepairableSelected ? "إلغاء تحديد الكل" : "تحديد القابل للإصلاح" }}
          </UButton>
          <UButton
            size="xs"
            color="warning"
            :loading="repairApplyBusy"
            :disabled="!selectedRepairable.length"
            @click="applySelectedRepairs"
            >تطبيق المحدد ({{ selectedRepairable.length }})</UButton
          >
        </div>
      </div>
      <div class="max-h-[60vh] space-y-2 overflow-y-auto">
        <UEmpty v-if="!repairRows.length && !repairBusy" icon="i-lucide-scale" title="شغّل التحليل أولاً" />
        <div
          v-for="r in repairRows"
          :key="r.product_id"
          class="flex items-start gap-2 rounded-lg border border-gray-200 p-2 text-sm"
        >
          <UCheckbox
            v-if="r.status === 'REPAIRABLE'"
            :model-value="isRepairSelected(r.product_id)"
            @update:model-value="() => toggleRepairRow(r.product_id)"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold">{{ r.product_name }}</div>
            <div class="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-500">
              <span>المخزون الحالي: {{ r.currentStock ?? "—" }}</span>
              <span>المعاد تشغيله: {{ r.replayedStock }}</span>
              <span>التكلفة الحالية: {{ r.currentCost ?? "—" }}</span>
              <span>المعاد حسابها: {{ r.recomputedCost ?? "—" }}</span>
            </div>
            <div class="mt-0.5 text-xs">
              <span v-if="r.difference !== null && r.difference !== 0" class="font-bold text-amber-600">
                الفرق: {{ r.difference > 0 ? "+" : "" }}{{ r.difference }}
              </span>
              <UBadge :color="repairStatusColor(r.status)" variant="soft" size="xs" class="ms-1">
                {{ REPAIR_STATUS_LABELS[r.status] }}
              </UBadge>
            </div>
          </div>
          <UButton
            v-if="r.status === 'REPAIRABLE'"
            size="xs"
            color="warning"
            variant="soft"
            :loading="repairRowBusy === r.product_id"
            @click="applySingleRepair(r)"
            >تطبيق</UButton
          >
        </div>
      </div>
      <p v-if="repairMsg" class="mt-2 text-sm font-semibold text-gray-700">{{ repairMsg }}</p>
    </UiAppDialog>

    <!-- Deposit dialog -->
    <UiAppDialog v-model:open="depositOpen" title="إضافة أموال">
      <div class="space-y-3">
        <UFormField label="المبلغ" required :error="amountError || undefined">
          <UInputNumber
            v-model="amount"
            :min="0"
            placeholder="مثال: 5000"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="submitError"
          color="error"
          variant="soft"
          :title="submitError"
        />
        <UFormField label="ملاحظة">
          <UInput
            v-model="note"
            placeholder="مثال: إضافة رأس مال"
            size="lg"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="success"
            class="min-h-11 flex-1"
            :loading="busy"
            icon="i-lucide-plus"
            @click="doAdjust('manual_deposit', 'in')"
            >تأكيد الإضافة</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="min-h-11 flex-1"
            :disabled="busy"
            @click="closeForms"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>

    <!-- Withdraw dialog -->
    <UiAppDialog v-model:open="withdrawOpen" title="سحب أموال">
      <div class="space-y-3">
        <UAlert
          color="info"
          variant="soft"
          :title="`الرصيد الحالي: ${formatePrice(cashbox.balance)}`"
        />
        <UFormField label="المبلغ" required :error="amountError || undefined">
          <UInputNumber
            v-model="amount"
            :min="0"
            placeholder="المبلغ"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="submitError"
          color="error"
          variant="soft"
          :title="submitError"
        />
        <UFormField label="ملاحظة">
          <UInput
            v-model="note"
            placeholder="سبب السحب"
            size="lg"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="error"
            class="min-h-11 flex-1"
            :loading="busy"
            icon="i-lucide-minus"
            @click="doAdjust('manual_withdrawal', 'out')"
            >تأكيد السحب</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="min-h-11 flex-1"
            :disabled="busy"
            @click="closeForms"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { CashDirection, CashTransactionType } from "~/types/finance";
import { CASH_TYPE_LABELS } from "~/types/finance";
import type { RepairRow } from "~/composables/useInventoryCostRepair";
import { REPAIR_STATUS_LABELS } from "~/composables/useInventoryCostRepair";
import { toDateSafe } from "~/types";
import { collection, getCountFromServer } from "firebase/firestore";

definePageMeta({ title: "الخزنة" });
const { formatePrice } = useHelpers();
const {
  inventoryAggregates,
  round2,
  toNum,
  invoiceTotals,
  grossProfitOf,
  outstandingDebtOf,
} = useFinance();
const invoicesStore = useInvoicesStore();
const cashbox = useCashbox();
const products = useProductsStore();
const migration = useMigration();
const repairApi = useInventoryCostRepair();
const { notify } = useAppToast();

// Cost repair review state (§12).
const repairOpen = ref(false);
const repairBusy = ref(false);
const repairPct = ref(0);
const repairMsg = ref("");
const repairRows = ref<RepairRow[]>([]);
const repairSelected = ref(new Set<string>());
const repairApplyBusy = ref(false);
const repairRowBusy = ref<string | null>(null);
const selectedRepairable = computed(() =>
  repairRows.value.filter((r) => r.status === "REPAIRABLE" && repairSelected.value.has(r.product_id)),
);
const allRepairableSelected = computed(() => {
  const reps = repairRows.value.filter((r) => r.status === "REPAIRABLE");
  return reps.length > 0 && reps.every((r) => repairSelected.value.has(r.product_id));
});
function isRepairSelected(id: string): boolean {
  return repairSelected.value.has(id);
}
function toggleRepairRow(id: string): void {
  if (repairSelected.value.has(id)) repairSelected.value.delete(id);
  else repairSelected.value.add(id);
}
function toggleRepairSelectAll(): void {
  if (allRepairableSelected.value) {
    repairSelected.value = new Set();
  } else {
    repairSelected.value = new Set(
      repairRows.value.filter((r) => r.status === "REPAIRABLE").map((r) => r.product_id),
    );
  }
}
function repairStatusColor(s: RepairRow["status"]): "success" | "warning" | "error" | "neutral" {
  if (s === "OK") return "success";
  if (s === "REPAIRABLE") return "warning";
  if (s === "STOCK_MISMATCH" || s === "INVALID_HISTORY") return "error";
  return "neutral";
}
async function runRepairAnalyze(): Promise<void> {
  repairBusy.value = true;
  repairMsg.value = "";
  repairRows.value = [];
  repairSelected.value = new Set();
  repairOpen.value = true;
  try {
    repairRows.value = await repairApi.analyze((d, t) => {
      repairPct.value = t ? Math.round((d / t) * 100) : 100;
    });
    const reps = repairRows.value.filter((r) => r.status === "REPAIRABLE").length;
    repairMsg.value = `اكتمل التحليل: ${repairRows.value.length} منتج، ${reps} قابل للإصلاح.`;
  } catch (e) {
    repairMsg.value = "فشل التحليل.";
    notify("تعذر إتمام التحليل.", "error");
  } finally {
    repairBusy.value = false;
  }
}
async function applySingleRepair(r: RepairRow): Promise<void> {
  repairRowBusy.value = r.product_id;
  try {
    const res = await repairApi.applyOne(r, "إصلاح يدوي من المراجعة");
    if (!res.ok) {
      notify(res.error, "error");
      return;
    }
    notify(`تم إصلاح ${r.product_name}.`, "success");
    repairSelected.value.delete(r.product_id);
    await products.fetchProducts();
    await refreshRepairRows();
  } finally {
    repairRowBusy.value = null;
  }
}
async function applySelectedRepairs(): Promise<void> {
  const targets = selectedRepairable.value;
  if (!targets.length) return;
  repairApplyBusy.value = true;
  try {
    const res = await repairApi.applyMany(targets, "إصلاح جماعي من المراجعة", () => {});
    repairMsg.value = `تم تطبيق ${res.applied}، وتخطي ${res.skipped}، وفشل ${res.failed}.`;
    notify(repairMsg.value, res.failed ? "error" : "success");
    repairSelected.value = new Set();
    await products.fetchProducts();
    await refreshRepairRows();
  } finally {
    repairApplyBusy.value = false;
  }
}
async function refreshRepairRows(): Promise<void> {
  // Re-run analysis (idempotent: applied rows now report OK).
  repairRows.value = await repairApi.analyze();
}

// Migration tools state (F22)
const migCustomerBusy = ref(false);
const migCustomerPct = ref(0);
const migCustomerMsg = ref("");
const migRepairBusy = ref(false);
const migRepairPct = ref(0);
const migRepairMsg = ref("");
const migStockBusy = ref(false);
const migStockPct = ref(0);
const migStockMsg = ref("");
const migSumBusy = ref(false);
const migSumPct = ref(0);
const migSumMsg = ref("");
const openingQtys = ref<Record<string, number | undefined>>({});
const openingThresholds = ref<Record<string, number | undefined>>({});
const stockSearch = ref("");
const missingStock = computed(() =>
  products.list.filter(
    (p) =>
      p.id && (p.stock_quantity === null || p.stock_quantity === undefined),
  ),
);
// Search within not-yet-counted products (entered quantities are preserved
// while typing since inputs are keyed by product id).
const filteredMissingStock = computed(() => {
  const q = stockSearch.value.trim();
  if (!q) return missingStock.value;
  return missingStock.value.filter((p) => p.name?.includes(q));
});
// Lazy rendering: mount only the first chunk; user appends more with the
// button, so 60 heavy inputs never mount at once.
const STOCK_PAGE = 15;
const visibleCount = ref(STOCK_PAGE);
const visibleMissingStock = computed(() => filteredMissingStock.value.slice(0, visibleCount.value));
watch(stockSearch, () => {
  visibleCount.value = STOCK_PAGE;
});
function showMoreStock(): void {
  visibleCount.value += STOCK_PAGE;
}
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
async function runRepairLinks(): Promise<void> {
  migRepairBusy.value = true;
  migRepairMsg.value = "";
  try {
    const res = await migration.repairCustomerLinks((d, t) => {
      migRepairPct.value = t ? Math.round((d / t) * 100) : 100;
    });
    migRepairMsg.value = `تمت مراجعة ${res.reviewed}: سليم ${res.kept}، مُصحح ${res.cleared}.`;
    notify(`اكتملت المراجعة: صُحح ${res.cleared} رابط.`, "success");
  } catch (e) {
    migRepairMsg.value = "فشلت المراجعة.";
    notify("تعذر إتمام المراجعة.", "error");
  } finally {
    migRepairBusy.value = false;
  }
}
async function runSumBackfill(): Promise<void> {
  migSumBusy.value = true;
  migSumMsg.value = "";
  try {
    const res = await migration.backfillDebtSummaries((d, t) => {
      migSumPct.value = t ? Math.round((d / t) * 100) : 100;
    });
    migSumMsg.value = `تم: هُيئ ${res.created} من ${res.total} فاتورة.`;
    notify(`اكتملت التهيئة: ${res.created} فاتورة.`, "success");
    await fetchStats();
  } catch (e) {
    migSumMsg.value = "فشلت التهيئة.";
    notify("تعذر إتمام التهيئة.", "error");
  } finally {
    migSumBusy.value = false;
  }
}
async function runStockEntry(): Promise<void> {
  const selectedEntries = missingStock.value
    .filter((p) => p.id && openingQtys.value[p.id] !== undefined)
    .map((p) => ({
      product_id: p.id as string,
      quantity: round2(openingQtys.value[p.id as string] ?? 0),
      unit_cost: toNum(p.cost_price),
      low_stock_threshold: openingThresholds.value[p.id as string] ?? p.low_stock_threshold ?? 5,
    }));
  if (selectedEntries.some((entry) =>
    !Number.isFinite(entry.quantity) || entry.quantity < 0 ||
    !Number.isFinite(entry.low_stock_threshold) || entry.low_stock_threshold < 0
  )) {
    migStockMsg.value = "راجع الرصيد ومؤشر الكمية القليلة؛ يجب أن يكونا صفرًا أو أكبر.";
    return;
  }
  const entries = selectedEntries;
  if (!entries.length) {
    migStockMsg.value = "أدخل رصيدًا افتتاحيًا لمنتج واحد على الأقل؛ يمكن أن تكون الكمية صفرًا.";
    return;
  }
  migStockBusy.value = true;
  migStockMsg.value = "";
  try {
    const res = await migration.setOpeningStocks(entries, (d, t) => {
      migStockPct.value = t ? Math.round((d / t) * 100) : 100;
    });
    migStockMsg.value = `تم: حُفظ ${res.set} من ${res.total} منتج.`;
    notify(`اكتمل إدخال الأرصدة: ${res.set} منتج.`, "success");
    openingQtys.value = {};
    openingThresholds.value = {};
    await products.fetchProducts();
  } catch (e) {
    migStockMsg.value = "فشل الحفظ.";
    notify("تعذر إتمام الحفظ.", "error");
  } finally {
    migStockBusy.value = false;
  }
}

const depositOpen = ref(false);
const withdrawOpen = ref(false);
const amount = ref<number | undefined>(undefined);
const note = ref("");
const submitError = ref("");
const busy = ref(false);
// Live amount error: empty = untouched (no red); withdraw also checks balance.
const amountError = computed(() => {
  if (amount.value === undefined || amount.value === null) return "";
  if (!(amount.value > 0)) return "المبلغ يجب أن يكون أكبر من صفر.";
  if (withdrawOpen.value && round2(amount.value) > cashbox.balance) {
    return `الرصيد الحالي (${formatePrice(cashbox.balance)}) لا يكفي.`;
  }
  return "";
});
const openingAmount = ref<number | undefined>(undefined);
const openingNote = ref("");
const openingBusy = ref(false);

const typeFilter = ref<string | null>(null);
const typeOptions = computed(() => [
  { label: "الكل", value: null },
  ...Object.entries(CASH_TYPE_LABELS).map(([value, label]) => ({
    label,
    value,
  })),
]);
const currentPage = ref(1);
const currentPerPage = ref(25);
watch([typeFilter], () => {
  currentPage.value = 1;
});

const agg = computed(() => inventoryAggregates(products.list));

// Store totals from the SAME source + formulas as /invoices (full docs),
// so the numbers always match. Counts stay server-side (cheap).
// Loaded in onMounted (never top-level await) so navigation never blocks.
const statsLoading = ref(false);
const stats = ref({
  sales: 0,
  debts: 0,
  profits: 0,
  invoices: 0,
  customers: 0,
});
async function fetchStats(): Promise<void> {
  statsLoading.value = true;
  try {
    const { db } = useFirebase();
    const [all, invCount, cusCount] = await Promise.all([
      invoicesStore.fetchInvoices().then(() => invoicesStore.list),
      getCountFromServer(collection(db, "invoices")),
      getCountFromServer(collection(db, "customers")),
    ]);
    let sales = 0;
    let debts = 0;
    let profits = 0;
    for (const inv of all) {
      const t = invoiceTotals(inv);
      sales = round2(sales + t.net);
      debts = round2(debts + outstandingDebtOf(inv));
      profits = round2(profits + grossProfitOf(inv.products));
    }
    stats.value = {
      sales,
      debts,
      profits,
      invoices: invCount.data().count,
      customers: cusCount.data().count,
    };
  } catch (e) {
    console.error(e);
  } finally {
    statsLoading.value = false;
  }
}
const filtered = computed(() =>
  typeFilter.value
    ? cashbox.transactions.filter((t) => t.type === typeFilter.value)
    : [...cashbox.transactions],
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

function refLabel(t: {
  invoice_id?: string | null;
  return_id?: string | null;
  loan_id?: string | null;
  product_id?: string | null;
}): string {
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
  submitError.value = "";
}

async function doAdjust(
  type: CashTransactionType,
  direction: CashDirection,
): Promise<void> {
  submitError.value = "";
  if (amountError.value || amount.value === undefined) {
    submitError.value = amountError.value || "أدخل المبلغ أولاً.";
    return;
  }
  const v = round2(amount.value);
  busy.value = true;
  try {
    const res = await cashbox.adjustCash({
      type,
      direction,
      amount: v,
      note: note.value.trim() || null,
    });
    if (!res.ok) {
      submitError.value = res.error;
      return;
    }
    notify(
      direction === "in"
        ? "تمت إضافة المبلغ للخزنة بنجاح."
        : "تم سحب المبلغ من الخزنة بنجاح.",
      "success",
    );
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
    const res = await cashbox.ensureOpeningBalance(
      v,
      openingNote.value.trim() || null,
    );
    if (!res.ok) {
      notify(res.error, "error");
      return;
    }
    notify("تم تهيئة الخزنة بالرصيد الافتتاحي.", "success");
  } finally {
    openingBusy.value = false;
  }
}

onMounted(() => {
  Promise.all([
    cashbox.fetchCashbox(),
    cashbox.fetchTransactions(),
    products.fetchProducts(),
    fetchStats(),
  ]);
});
</script>
