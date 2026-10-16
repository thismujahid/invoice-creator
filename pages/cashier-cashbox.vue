<template>
  <div class="space-y-4 rounded-xl bg-white p-3 shadow-sm sm:p-4" dir="rtl">
    <UiAppPageHeader title="خزنة الكاشير" description="عملياتك النقدية اليوم فقط"><template #actions><UButton color="neutral" variant="soft" :loading="loading" @click="load">تحديث</UButton></template></UiAppPageHeader>
    <UiAppStatsSkeleton v-if="loading && !summary" />
    <UAlert v-if="error" color="error" variant="soft" :title="error" />
    <template v-if="summary">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4"><UCard variant="outline"><strong v-if="summary.opening === null">غير مهيأة</strong><strong v-else><UiAppMoneyDisplay :text="formatePrice(summary.opening)" /></strong><div class="text-xs text-gray-500">رصيد بداية اليوم</div></UCard><UCard variant="outline"><strong class="text-emerald-700"><UiAppMoneyDisplay :text="formatePrice(summary.cashIn)" /></strong><div class="text-xs text-gray-500">نقد دخل بعملياتك</div></UCard><UCard variant="outline"><strong class="text-red-700"><UiAppMoneyDisplay :text="formatePrice(summary.cashOut)" /></strong><div class="text-xs text-gray-500">نقد خرج بعملياتك</div></UCard><UCard variant="outline"><strong>{{ summary.operationCount }}</strong><div class="text-xs text-gray-500">عدد حركاتك اليوم</div></UCard></div>
      <div><h2 class="mb-2 font-bold">سجل عملياتك اليوم</h2><div class="space-y-2"><UCard v-for="item in summary.operations" :key="item.id" variant="outline"><div class="flex items-start justify-between gap-2 text-sm"><div><strong>{{ label(item.type) }}</strong><div class="text-xs text-gray-500">{{ item.reference_label || formatDate(item.created_at) }}</div><div v-if="item.reference_label" class="text-xs text-gray-500">{{ formatDate(item.created_at) }}</div></div><b :class="item.direction === 'in' ? 'text-emerald-700' : 'text-red-700'"><UiAppMoneyDisplay :text="`${item.direction === 'in' ? '+' : '-'}${formatePrice(item.amount)}`" /></b></div></UCard><UEmpty v-if="!summary.operations.length" title="لا توجد حركات نقدية لك اليوم" /></div><p v-if="summary.operationCount > summary.operations.length" class="mt-2 text-xs text-gray-500">معروض آخر {{ summary.operations.length }} حركة من {{ summary.operationCount }}.</p></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { CASH_TYPE_LABELS, type CashTransactionType } from "~/types/finance";
import { toDateSafe } from "~/types";

definePageMeta({ title: "خزنة الكاشير" });
interface CashierMovement { id: string; type: string; direction: "in" | "out"; amount: number; reference_label: string; created_at: unknown }
interface CashierSummary { day: string; opening: number | null; cashIn: number; cashOut: number; operationCount: number; operations: CashierMovement[] }
const { formatePrice } = useHelpers();
const summary = ref<CashierSummary | null>(null);
const loading = ref(false);
const error = ref("");
function label(type: string): string { return CASH_TYPE_LABELS[type as CashTransactionType] || "حركة نقدية"; }
function formatDate(value: unknown): string { return toDateSafe(value)?.toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }) ?? "—"; }
async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try { summary.value = await callStaff<Record<string, never>, CashierSummary>("getCashierCashSummary", {}); }
  catch { error.value = "تعذر تحميل عمليات الخزنة. حاول مرة أخرى."; }
  finally { loading.value = false; }
}
onMounted(() => { void load(); });
</script>
