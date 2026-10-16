<template>
  <div class="space-y-5" dir="rtl">
    <div class="grid grid-cols-2 gap-3 text-sm">
      <div class="rounded-xl border border-red-100 bg-red-50/60 px-4 py-3"><span class="block text-xs text-red-700">عليه الآن</span><b class="mt-1 block text-base text-red-800">{{ formatePrice(totalDebt) }}</b></div>
      <div class="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3"><span class="block text-xs text-emerald-700">له الآن</span><b class="mt-1 block text-base text-emerald-800">{{ formatePrice(creditBalance) }}</b></div>
    </div>
    <div class="flex justify-end"><UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" :loading="loading" @click="load">تحديث السجل</UButton></div>
    <UAlert v-if="error" color="error" variant="soft" :title="error" />
    <USkeleton v-else-if="loading" class="h-32 w-full" />
    <UEmpty v-else-if="!items.length" title="لا توجد عمليات لهذا العميل" />
    <ol v-else class="space-y-3">
      <li v-for="(item, index) in items" :key="`${item.type}-${item.id}`" class="grid grid-cols-[1rem_minmax(0,1fr)] gap-3">
        <div class="relative flex justify-center">
          <span v-if="index < items.length - 1" class="absolute -bottom-3 top-5 w-px bg-gray-200" />
          <span class="relative mt-4 size-2.5 rounded-full ring-4 ring-white" :class="tone(item) === 'red' ? 'bg-red-500' : tone(item) === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'" />
        </div>
        <div class="min-w-0 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2"><UIcon :name="icon(item)" class="size-4 shrink-0" :class="textColor(item)" /><span class="font-semibold leading-6 text-gray-900">{{ label(item) }}</span></div>
            <strong class="whitespace-nowrap text-base tabular-nums" :class="textColor(item)">{{ formatePrice(item.amount) }}</strong>
          </div>
          <time class="mt-1 block text-sm text-gray-600">{{ formatDate(item.date) }}</time>
          <p v-if="item.detail" class="mt-2 text-xs leading-5 text-gray-600">{{ item.detail }}</p>
          <UButton v-if="item.invoiceId" icon="i-lucide-file-text" color="neutral" variant="soft" size="xs" class="mt-3" @click="emit('viewInvoice', item.invoiceId)">{{ item.type === 'credit_added' ? 'عرض فاتورة المرتجع' : 'عرض الفاتورة' }}</UButton>
        </div>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { toDateSafe, type InvoiceDate } from "~/types";

type HistoryType = "deferred" | "loan" | "credit_added" | "credit_used" | "payment" | "settlement";
interface HistoryItem {
  id: string;
  type: HistoryType;
  amount: number;
  date: InvoiceDate;
  detail: string;
  invoiceId?: string | null;
}

const props = defineProps<{ customerId: string | null; totalDebt: number; creditBalance: number }>();
const emit = defineEmits<{ viewInvoice: [id: string] }>();
const { formatePrice } = useHelpers();
const items = ref<HistoryItem[]>([]);
const loading = ref(false);
const error = ref("");

function tone(item: HistoryItem): "red" | "green" | "amber" {
  if (item.type === "loan" || item.type === "deferred") return "red";
  return item.type === "credit_used" ? "amber" : "green";
}
function label(item: HistoryItem): string {
  return { deferred: "أجّل دفع من فاتورة", loan: "استلف", credit_added: "أُضيف لرصيده من مرتجع", credit_used: "اتخصم من رصيده في فاتورة", payment: "سدد نقدًا", settlement: "سدد بالتسوية" }[item.type];
}
function icon(item: HistoryItem): string {
  return { deferred: "i-lucide-receipt-text", loan: "i-lucide-hand-coins", credit_added: "i-lucide-undo-2", credit_used: "i-lucide-wallet", payment: "i-lucide-banknote", settlement: "i-lucide-scale" }[item.type];
}
function textColor(item: HistoryItem): string {
  return tone(item) === "red" ? "text-red-700" : tone(item) === "amber" ? "text-amber-700" : "text-emerald-700";
}
function formatDate(value: InvoiceDate): string {
  return toDateSafe(value)?.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }) ?? "—";
}
async function load(): Promise<void> {
  if (!props.customerId) return;
  loading.value = true;
  error.value = "";
  try {
    const result = await callStaff<{ customerId: string }, { items: HistoryItem[] }>("getCustomerHistory", { customerId: props.customerId });
    items.value = result.items;
  } catch {
    error.value = "تعذر تحميل سجل العميل. حاول مرة أخرى.";
  } finally {
    loading.value = false;
  }
}
watch(() => props.customerId, load, { immediate: true });
</script>
