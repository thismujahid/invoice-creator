<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4" dir="rtl">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold">سلف وديون العملاء</h2>
      <FormsCustomer v-model="customerOpen" :refresher="refreshCustomers" @done="onCustomerCreated">
        <UButton icon="i-lucide-user-plus" color="success" variant="soft">إضافة عميل</UButton>
      </FormsCustomer>
    </div>
    <UFormField label="العميل" class="mb-4">
      <USelectMenu v-model="selectedCustomer" :items="customers.list" label-key="name" by="id" v-model:search-term="search" :search-input="{ placeholder: 'ابحث عن عميل', icon: 'i-lucide-search' }" :ignore-filter="true" class="w-full" :loading="customerLoading" />
    </UFormField>
    <div v-if="selectedCustomer" class="mb-4 flex flex-wrap items-end gap-2">
      <UFormField label="مبلغ السلفة" class="min-w-40 flex-1">
        <UInputNumber v-model="loanAmount" :min="0.01" :step="0.01" class="w-full" />
      </UFormField>
      <UButton color="success" icon="i-lucide-hand-coins" :loading="loanBusy" @click="createLoan">منح سلفة</UButton>
    </div>
    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-3" />
    <div v-if="loading" class="space-y-2"><USkeleton v-for="n in 3" :key="n" class="h-20 w-full" /></div>
    <template v-else-if="selectedCustomer">
      <div v-if="!obligations.length" class="rounded-lg border border-dashed p-5 text-center text-gray-500">لا توجد مبالغ مستحقة لهذا العميل.</div>
      <div v-for="obligation in obligations" :key="`${obligation.type}-${obligation.id}`" class="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div><div class="font-semibold">{{ obligation.type === 'invoice' ? 'باقي فاتورة' : 'سلفة' }}</div><div class="text-sm text-gray-500">المتبقي: {{ formatePrice(obligation.remaining) }} ج</div></div>
        <UButton color="success" variant="soft" size="sm" @click="openPayment(obligation)">تسديد</UButton>
      </div>
    </template>
    <UiAppDialog v-model:open="paymentOpen" title="تسديد مبلغ مستحق">
      <div class="space-y-3">
        <div>المتبقي: {{ formatePrice(paymentTarget?.remaining ?? 0) }} ج</div>
        <UFormField label="المبلغ المدفوع"><UInputNumber v-model="paymentAmount" :min="0.01" :max="paymentTarget?.remaining" :step="0.01" class="w-full" /></UFormField>
        <UAlert v-if="paymentError" color="error" variant="soft" :title="paymentError" />
      </div>
      <template #footer><UButton color="success" block :loading="paymentBusy" @click="pay">تأكيد السداد</UButton></template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Customer } from "~/types";

interface CashierObligation {
  id: string;
  type: "invoice" | "loan";
  total: number;
  paid: number;
  remaining: number;
}

const customers = useCustomersStore();
const { formatePrice } = useHelpers();
const { notify } = useAppToast();
const selectedCustomer = ref<Customer | undefined>();
const search = ref("");
const customerOpen = ref(false);
const customerLoading = ref(true);
const loading = ref(false);
const error = ref("");
const loanAmount = ref<number>();
const loanBusy = ref(false);
const paymentOpen = ref(false);
const paymentTarget = ref<CashierObligation | null>(null);
const paymentAmount = ref<number>();
const paymentError = ref("");
const paymentBusy = ref(false);
const obligations = ref<CashierObligation[]>([]);
const loanRequestId = ref(crypto.randomUUID());
const paymentRequestId = ref(crypto.randomUUID());

async function refreshCustomers(): Promise<void> {
  customerLoading.value = true;
  try { await customers.fetchCustomers(undefined, true); }
  finally { customerLoading.value = false; }
}

function onCustomerCreated(customer: Customer): void {
  selectedCustomer.value = customers.list.find((item) => item.id === customer.id) ?? customer;
}

async function refresh(): Promise<void> {
  if (!selectedCustomer.value?.id) return;
  loading.value = true;
  error.value = "";
  try {
    const result = await callStaff<{ customerId: string }, { invoices: Omit<CashierObligation, "type">[]; loans: Omit<CashierObligation, "type">[] }>("getCashierDebts", { customerId: selectedCustomer.value.id });
    obligations.value = [
      ...result.invoices.map((item) => ({ ...item, type: "invoice" as const })),
      ...result.loans.map((item) => ({ ...item, type: "loan" as const })),
    ];
  } catch { error.value = "تعذر تحميل مستحقات العميل."; }
  finally { loading.value = false; }
}

async function createLoan(): Promise<void> {
  if (!selectedCustomer.value?.id || !loanAmount.value || loanAmount.value <= 0) { error.value = "اختر العميل وأدخل مبلغًا صحيحًا."; return; }
  loanBusy.value = true;
  error.value = "";
  try {
    await callStaff("createStaffLoan", { requestId: loanRequestId.value, customerId: selectedCustomer.value.id, amount: loanAmount.value });
    loanRequestId.value = crypto.randomUUID();
    loanAmount.value = undefined;
    notify("تم تسجيل السلفة وخصمها من الخزنة.", "success");
    await refresh();
  } catch { error.value = "تعذر تسجيل السلفة. تحقق من رصيد الخزنة وحاول مجددًا."; }
  finally { loanBusy.value = false; }
}

function openPayment(obligation: CashierObligation): void {
  paymentTarget.value = obligation;
  paymentRequestId.value = crypto.randomUUID();
  paymentAmount.value = obligation.remaining;
  paymentError.value = "";
  paymentOpen.value = true;
}

async function pay(): Promise<void> {
  const target = paymentTarget.value;
  if (!selectedCustomer.value?.id || !target || !paymentAmount.value || paymentAmount.value <= 0 || paymentAmount.value > target.remaining) {
    paymentError.value = "أدخل مبلغًا لا يتجاوز المتبقي.";
    return;
  }
  paymentBusy.value = true;
  paymentError.value = "";
  try {
    await callStaff("payStaffDebts", { requestId: paymentRequestId.value, customer_id: selectedCustomer.value.id, amount: paymentAmount.value, allocations: [{ type: target.type, reference_id: target.id, amount: paymentAmount.value }] });
    paymentOpen.value = false;
    notify("تم تسجيل السداد.", "success");
    await refresh();
  } catch { paymentError.value = "تعذر السداد. حدّث بيانات العميل وحاول مجددًا."; }
  finally { paymentBusy.value = false; }
}

watch(() => selectedCustomer.value?.id, () => { obligations.value = []; void refresh(); });
onMounted(async () => { if (await useAuthReady()) await refreshCustomers(); });
</script>
