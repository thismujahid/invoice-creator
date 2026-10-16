<template>
  <span>
    <UButton size="xs" color="warning" variant="link" :disabled="!customerId" @click="openDialog">صرف رصيد العميل</UButton>
    <UiAppDialog v-model:open="open" :title="`صرف رصيد ${customerName}`">
      <div class="space-y-3" dir="rtl">
        <USkeleton v-if="loading" class="h-16 w-full" />
        <template v-else>
          <div class="rounded-lg bg-emerald-50 p-3 text-sm">الرصيد المتاح للعميل: <strong>{{ formatePrice(balance) }}</strong></div>
          <UFormField label="المبلغ المصروف نقدًا"><UInputNumber v-model="amount" :min="0" :max="balance" :step="0.01" class="w-full" /></UFormField>
          <p class="text-xs text-gray-500">سيُخصم من رصيد العميل والخزنة معًا. لن تتغير قيمة الفاتورة الأصلية.</p>
          <UAlert v-if="error" color="error" variant="soft" :title="error" />
        </template>
      </div>
      <template #footer><div class="flex w-full gap-2"><UButton color="warning" :loading="busy" :disabled="loading || !amount || amount > balance" @click="pay">تأكيد الصرف</UButton><UButton color="neutral" variant="soft" :disabled="busy" @click="open = false">إلغاء</UButton></div></template>
    </UiAppDialog>
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{ customerId?: string | null; customerName: string }>();
const emit = defineEmits<{ paid: [] }>();
const { formatePrice } = useHelpers();
const { notify } = useAppToast();
const open = ref(false);
const loading = ref(false);
const busy = ref(false);
const balance = ref(0);
const amount = ref(0);
const error = ref("");
let requestId = crypto.randomUUID();
async function openDialog(): Promise<void> {
  if (!props.customerId) return;
  open.value = true;
  loading.value = true;
  error.value = "";
  amount.value = 0;
  requestId = crypto.randomUUID();
  try {
    const result = await callStaff<{ customerId: string }, { balance: number }>("getCustomerCredit", { customerId: props.customerId });
    balance.value = result.balance;
  } catch { error.value = "تعذر تحميل رصيد العميل."; }
  finally { loading.value = false; }
}
async function pay(): Promise<void> {
  if (!props.customerId || busy.value || !Number.isFinite(amount.value) || amount.value <= 0 || amount.value > balance.value) return;
  busy.value = true;
  error.value = "";
  try {
    await callStaff<{ requestId: string; customerId: string; amount: number }, { balance: number; amount: number }>("payCustomerCredit", { requestId, customerId: props.customerId, amount: amount.value });
    notify("تم صرف رصيد العميل وتحديث الخزنة.", "success");
    open.value = false;
    emit("paid");
  } catch { error.value = "تعذر الصرف. راجع رصيد العميل والخزنة ثم أعد المحاولة."; }
  finally { busy.value = false; }
}
</script>
