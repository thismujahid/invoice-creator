<template>
  <span>
    <UButton
      :size="size"
      color="warning"
      variant="soft"
      icon="i-lucide-scale"
      :disabled="!customerId || amount <= 0"
      :aria-label="`تسوية رصيد ${customerName}`"
      @click="openDialog"
    >{{ label ? 'تسوية الرصيد' : '' }}</UButton>
    <UiAppDialog v-model:open="open" :title="`تسوية رصيد ${customerName}`">
      <div class="space-y-3 text-sm" dir="rtl">
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded-lg bg-emerald-50 p-3">له رصيد: <b>{{ formatePrice(creditBalance) }} ج</b></div>
          <div class="rounded-lg bg-red-50 p-3">عليه دين: <b>{{ formatePrice(totalDebt) }} ج</b></div>
        </div>
        <div class="rounded-lg bg-amber-50 p-3 font-semibold">قيمة التسوية: {{ formatePrice(amount) }} ج</div>
        <div class="space-y-1">
          <div v-for="item in allocations" :key="`${item.type}-${item.reference_id}`" class="flex justify-between gap-2 rounded border p-2">
            <span>{{ item.type === 'invoice' ? 'فاتورة' : 'سلفة' }}</span><b>{{ formatePrice(item.amount) }} ج</b>
          </div>
        </div>
        <p class="text-xs text-gray-500">سيُخصم المبلغ من رصيد العميل وديونه، دون حركة نقدية في الخزنة.</p>
        <UAlert v-if="error" color="error" variant="soft" :title="error" />
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="warning" :loading="busy" :disabled="amount <= 0" @click="settle">تأكيد التسوية</UButton>
          <UButton color="neutral" variant="soft" :disabled="busy" @click="open = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
  </span>
</template>

<script setup lang="ts">
import { toDateSafe } from "~/types";
import { allocateCustomerCredit } from "~/composables/finance";

interface Obligation { id: string; type?: "invoice" | "loan"; kind?: "invoice" | "loan"; remaining: number; date: unknown }
interface Allocation { type: "invoice" | "loan"; reference_id: string; amount: number }

const props = withDefaults(defineProps<{
  customerId: string | null;
  customerName: string;
  creditBalance: number;
  totalDebt: number;
  obligations: Obligation[];
  size?: "xs" | "sm";
  label?: boolean;
}>(), { size: "xs", label: false });
const emit = defineEmits<{ settled: [] }>();
const { round2 } = useFinance();
const { formatePrice } = useHelpers();
const { notify } = useAppToast();
const open = ref(false);
const busy = ref(false);
const error = ref("");
let requestId = crypto.randomUUID();

const allocations = computed<Allocation[]>(() => {
  const obligations = props.obligations.flatMap((item) => {
    const type = item.type ?? item.kind;
    return type ? [{ id: item.id, type, remaining: item.remaining, date: toDateSafe(item.date) }] : [];
  });
  return allocateCustomerCredit(Math.min(props.creditBalance, props.totalDebt), obligations);
});
const amount = computed(() => round2(allocations.value.reduce((sum, item) => sum + item.amount, 0)));

function openDialog(): void {
  error.value = "";
  requestId = crypto.randomUUID();
  open.value = true;
}

async function settle(): Promise<void> {
  if (!props.customerId || busy.value || amount.value <= 0) return;
  busy.value = true;
  error.value = "";
  try {
    await callStaff("payStaffDebts", {
      requestId,
      customer_id: props.customerId,
      source: "credit",
      amount: amount.value,
      allocations: allocations.value,
    });
    open.value = false;
    notify(`تمت تسوية ${formatePrice(amount.value)} ج من رصيد العميل دون حركة في الخزنة.`, "success");
    emit("settled");
  } catch {
    error.value = "تعذرت التسوية. حدّث دفتر الديون وتحقق من الرصيد ثم حاول مرة أخرى.";
  } finally {
    busy.value = false;
  }
}
</script>
