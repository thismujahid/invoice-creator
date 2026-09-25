<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">دفتر الديون</h2>
      <UButton icon="i-lucide-hand-coins" color="success" @click="openLoan(null)">إضافة سلفة</UButton>
    </div>
    <UInput v-model="searchText" placeholder="بحث بالاسم أو الهاتف" icon="i-lucide-search" size="lg" class="mb-3 w-full sm:max-w-xs" />
    <USkeleton v-if="loading" class="h-24 w-full" />
    <template v-else>
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th class="p-2 text-start font-medium">اسم العميل</th>
              <th class="p-2 text-start font-medium">الهاتف</th>
              <th class="p-2 text-start font-medium">فواتير غير مسددة</th>
              <th class="p-2 text-start font-medium">ديون الفواتير</th>
              <th class="p-2 text-start font-medium">السلف</th>
              <th class="p-2 text-start font-medium">إجمالي الدين</th>
              <th class="p-2 text-start font-medium">الأدوات</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in paged" :key="c.key" class="border-b border-gray-100 last:border-0 hover:bg-gray-50">
              <td class="p-2 font-medium">{{ c.name }}</td>
              <td class="p-2 text-gray-600" dir="ltr">{{ c.phone ?? "—" }}</td>
              <td class="p-2">{{ c.unpaidCount }}</td>
              <td class="p-2">{{ formatePrice(c.invoiceDebt) }}</td>
              <td class="p-2">{{ formatePrice(c.loanDebt) }}</td>
              <td class="p-2 font-bold text-red-600">{{ formatePrice(c.totalDebt) }}</td>
              <td class="p-2">
                <div class="flex gap-1.5">
                  <UTooltip text="التفاصيل والسداد"><UButton icon="i-lucide-eye" color="neutral" variant="soft" size="xs" aria-label="التفاصيل" @click="openDetails(c)" class="flex items-center justify-center" /></UTooltip>
                  <UTooltip text="تسديد دفعة"><UButton icon="i-lucide-hand-coins" color="success" variant="soft" size="xs" aria-label="تسديد" @click="openPay(c)" class="flex items-center justify-center" /></UTooltip>
                  <UTooltip text="إضافة سلفة"><UButton icon="i-lucide-plus" color="info" variant="soft" size="xs" aria-label="سلفة" @click="openLoan(c)" class="flex items-center justify-center" /></UTooltip>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <UEmpty v-if="!paged.length" icon="i-lucide-notebook-text" title="لا توجد ديون مستحقة" />
      </div>
      <div class="grid gap-2 md:hidden">
        <UCard v-for="c in paged" :key="c.key" variant="outline" @click="openDetails(c)">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-bold">{{ c.name }}</div>
              <div class="text-xs text-gray-500" dir="ltr">{{ c.phone ?? "" }}</div>
              <div class="mt-1 text-xs text-gray-500">{{ c.unpaidCount }} فواتير • سلف: {{ formatePrice(c.loanDebt) }}</div>
              <div class="mt-1 font-bold text-red-600">{{ formatePrice(c.totalDebt) }}</div>
            </div>
            <div class="flex shrink-0 gap-1.5" @click.stop>
              <UButton icon="i-lucide-hand-coins" color="success" variant="soft" size="xs" aria-label="تسديد" @click="openPay(c)" class="flex items-center justify-center" />
              <UButton icon="i-lucide-plus" color="info" variant="soft" size="xs" aria-label="سلفة" @click="openLoan(c)" class="flex items-center justify-center" />
            </div>
          </div>
        </UCard>
        <UEmpty v-if="!paged.length" icon="i-lucide-notebook-text" title="لا توجد ديون مستحقة" />
      </div>
    </template>
    <div class="mt-3 flex items-center justify-between gap-2">
      <USelect v-model="currentPerPage" :items="[10, 25, 50, 100]" size="sm" class="w-24" />
      <UPagination v-model:page="currentPage" :total="filtered.length" :items-per-page="currentPerPage" :sibling-count="1" size="sm" />
    </div>

    <!-- Customer details -->
    <UiAppDialog v-model:open="detailsOpen" :title="`ديون ${selected?.name || ''}`">
      <div v-if="selected" class="max-h-[70vh] space-y-4 overflow-y-auto">
        <div>
          <p class="mb-1.5 text-xs font-bold text-gray-400">الفواتير غير المسددة</p>
          <div v-if="!selected.invoices.length" class="text-sm text-gray-400">لا يوجد</div>
          <div v-for="o in selected.invoices" :key="o.id" class="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-2 text-sm">
            <div class="min-w-0">
              <div class="truncate font-semibold">{{ formatDateOnly(o.date) }} • الإجمالي {{ formatePrice(o.total) }}</div>
              <div class="text-xs text-gray-500">مدفوع: {{ formatePrice(o.paid) }}</div>
            </div>
            <div class="shrink-0 font-bold text-red-600">{{ formatePrice(o.remaining) }}</div>
          </div>
        </div>
        <div>
          <p class="mb-1.5 text-xs font-bold text-gray-400">السلف</p>
          <div v-if="!selected.loans.length" class="text-sm text-gray-400">لا يوجد</div>
          <div v-for="o in selected.loans" :key="o.id" class="mb-1.5 rounded-lg border border-gray-200 p-2 text-sm">
            <div class="flex items-center justify-between gap-2">
              <div class="font-semibold">{{ formatDateOnly(o.date) }} • الأصل {{ formatePrice(o.total) }}</div>
              <div class="shrink-0 font-bold text-red-600">{{ formatePrice(o.remaining) }}</div>
            </div>
            <div class="mt-0.5 text-xs text-gray-500">مدفوع: {{ formatePrice(o.paid) }}{{ loanNoteOf(o) ? ` • ${loanNoteOf(o)}` : "" }}</div>
          </div>
        </div>
        <div>
          <p class="mb-1.5 text-xs font-bold text-gray-400">سجل السداد</p>
          <USkeleton v-if="paymentsLoading" class="h-12 w-full" />
          <div v-else-if="!payments.length" class="text-sm text-gray-400">لا يوجد</div>
          <div v-for="p in payments" :key="p.id" class="mb-1.5 rounded-lg border border-gray-200 p-2 text-sm">
            <div class="flex items-center justify-between gap-2">
              <div class="font-semibold">{{ formatDateOnly(p.created_at) }}</div>
              <div class="shrink-0 font-bold text-emerald-600" dir="ltr">+{{ formatePrice(p.amount) }}</div>
            </div>
            <div class="mt-0.5 text-xs text-gray-500">
              <span v-for="(a, i) in p.allocations" :key="i">{{ a.type === "invoice" ? "فاتورة" : "سلفة" }}: {{ formatePrice(a.amount) }}{{ i < p.allocations.length - 1 ? " • " : "" }}</span>
              {{ p.note ? ` • ${p.note}` : "" }}
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="success" class="min-h-11 flex-1" icon="i-lucide-hand-coins" @click="selected && openPay(selected)">تسديد دفعة</UButton>
          <UButton color="info" variant="soft" class="min-h-11 flex-1" icon="i-lucide-plus" @click="selected && openLoan(selected)">سلفة جديدة</UButton>
        </div>
      </template>
    </UiAppDialog>

    <!-- Loan dialog -->
    <UiAppDialog v-model:open="loanOpen" title="إضافة سلفة">
      <div class="space-y-3">
        <UFormField label="العميل" required>
          <USelectMenu v-model="loanCustomer" :items="customers.list" label-key="name" placeholder="اختر العميل" class="w-full" />
        </UFormField>
        <UFormField label="مبلغ السلفة" required :error="loanError">
          <UInputNumber v-model="loanAmount" :min="0" placeholder="المبلغ" size="lg" class="w-full" />
        </UFormField>
        <UFormField label="ملاحظة">
          <UInput v-model="loanNote" placeholder="اختياري" size="lg" class="w-full" />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="success" class="min-h-11 flex-1" :loading="loanBusy" icon="i-lucide-check" @click="submitLoan">تأكيد السلفة</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="loanBusy" @click="loanOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>

    <!-- Pay dialog -->
    <UiAppDialog v-model:open="payOpen" :title="`تسديد دفعة — ${payTarget?.name || ''}`">
      <div v-if="payTarget" class="space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold text-gray-400">وزّع المبلغ على الالتزامات</p>
          <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-history" @click="autoDistribute">توزيع تلقائي على الأقدم</UButton>
        </div>
        <div v-for="o in payObligations" :key="o.kind + o.id" class="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">{{ o.kind === "invoice" ? "فاتورة" : "سلفة" }} • {{ formatDateOnly(o.date) }}</div>
            <div class="text-xs text-gray-500">المتبقي: {{ formatePrice(o.remaining) }}</div>
          </div>
          <UInputNumber :model-value="payAllocs[o.kind + o.id]" :min="0" :max="o.remaining" placeholder="0" class="w-32 shrink-0" @update:model-value="(v) => (payAllocs[o.kind + o.id] = v ?? 0)" />
        </div>
        <UFormField label="ملاحظة">
          <UInput v-model="payNote" placeholder="اختياري" size="lg" class="w-full" />
        </UFormField>
        <div class="flex items-center justify-between font-bold">
          <span>الإجمالي</span>
          <span class="text-emerald-700">{{ formatePrice(payTotal) }}</span>
        </div>
        <p v-if="payError" class="text-sm font-semibold text-red-600">{{ payError }}</p>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="success" class="min-h-11 flex-1" :loading="payBusy" icon="i-lucide-check" @click="submitPay">تأكيد السداد</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="payBusy" @click="payOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Customer } from "~/types";
import type { CustomerDebt, Obligation } from "~/composables/useDebts";
import type { DebtPayment } from "~/types/finance";
import { toDateSafe } from "~/types";

definePageMeta({ title: "دفتر الديون" });
const { formatePrice } = useHelpers();
const { round2 } = useFinance();
const debts = useDebts();
const customers = useCustomersStore();
const { notify } = useAppToast();

const loading = ref(false);
const book = ref<CustomerDebt[]>([]);
const searchText = ref("");
const currentPage = ref(1);
const currentPerPage = ref(25);
watch(searchText, () => {
  currentPage.value = 1;
});

const filtered = computed(() => {
  const q = searchText.value.trim();
  if (!q) return [...book.value];
  return book.value.filter((c) => c.name?.includes(q) || String(c.phone ?? "").includes(q));
});
const paged = computed(() => {
  const s = (currentPage.value - 1) * currentPerPage.value;
  return filtered.value.slice(s, s + currentPerPage.value);
});

function formatDateOnly(v: unknown): string {
  const d = toDateSafe(v);
  return d ? d.toLocaleDateString("ar-EG") : "—";
}
function loanNoteOf(o: Obligation): string {
  const n = (o.ref as { note?: string | null }).note;
  return n || "";
}

// Details
const selected = ref<CustomerDebt | null>(null);
const detailsOpen = computed({
  get: () => selected.value !== null,
  set: (v: boolean) => {
    if (!v) selected.value = null;
  },
});
const payments = ref<DebtPayment[]>([]);
const paymentsLoading = ref(false);
async function openDetails(c: CustomerDebt): Promise<void> {
  selected.value = c;
  await openDetailsRefresh();
}
async function openDetailsRefresh(): Promise<void> {
  payments.value = [];
  if (selected.value?.customer_id) {
    paymentsLoading.value = true;
    try {
      payments.value = await debts.fetchPaymentsForCustomer(selected.value.customer_id);
    } finally {
      paymentsLoading.value = false;
    }
  }
}

// Loan
const loanOpen = ref(false);
const loanCustomer = ref<Customer | undefined>(undefined);
const loanAmount = ref<number | undefined>(undefined);
const loanNote = ref("");
const loanError = ref("");
const loanBusy = ref(false);
function openLoan(c: CustomerDebt | null): void {
  loanError.value = "";
  loanAmount.value = undefined;
  loanNote.value = "";
  loanCustomer.value = undefined;
  if (c) {
    const found = customers.list.find((x) => x.id === c.customer_id) ?? undefined;
    loanCustomer.value = found;
    if (!found) notify("أنشئ العميل في سجل العملاء أولاً لربط السلفة.", "error");
  }
  loanOpen.value = true;
}
async function submitLoan(): Promise<void> {
  loanError.value = "";
  if (!loanCustomer.value?.id) {
    loanError.value = "اختر العميل أولاً.";
    return;
  }
  loanBusy.value = true;
  try {
    const res = await debts.createLoan({
      customer_id: loanCustomer.value.id,
      customer_name: loanCustomer.value.name,
      customer_phone: loanCustomer.value.phone ?? null,
      amount: loanAmount.value ?? 0,
      note: loanNote.value.trim() || null,
    });
    if (!res.ok) {
      loanError.value = res.error;
      return;
    }
    notify("تم تسجيل السلفة وخصمها من الخزنة.", "success");
    loanOpen.value = false;
    await reload();
    if (selected.value) {
      selected.value = book.value.find((c) => c.key === selected.value?.key) ?? selected.value;
      if (selected.value.customer_id) await openDetailsRefresh();
    }
  } finally {
    loanBusy.value = false;
  }
}

// Payment
const payOpen = ref(false);
const payTarget = ref<CustomerDebt | null>(null);
const payAllocs = ref<Record<string, number>>({});
const payNote = ref("");
const payError = ref("");
const payBusy = ref(false);
const payObligations = computed<Obligation[]>(() => {
  if (!payTarget.value) return [];
  return [...payTarget.value.invoices, ...payTarget.value.loans].sort(
    (a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity),
  );
});
const payTotal = computed(() => round2(Object.values(payAllocs.value).reduce((s, v) => s + (v || 0), 0)));
function openPay(c: CustomerDebt): void {
  payTarget.value = c;
  payAllocs.value = {};
  payNote.value = "";
  payError.value = "";
  payOpen.value = true;
}
function autoDistribute(): void {
  // Oldest obligations first: spread the entered total (or full coverage
  // when nothing entered yet) across obligations by age.
  const all = payObligations.value;
  const next: Record<string, number> = {};
  let budget = payTotal.value > 0 ? payTotal.value : Infinity;
  for (const o of all) {
    const take = budget === Infinity ? o.remaining : Math.min(o.remaining, budget);
    if (take > 0) {
      next[o.kind + o.id] = round2(take);
      if (budget !== Infinity) budget = round2(budget - take);
    }
  }
  payAllocs.value = next;
}
function resolvePayCustomerId(): string | null {
  const t = payTarget.value;
  if (!t) return null;
  if (t.customer_id) return t.customer_id;
  const found = customers.list.find(
    (x) => String(x.phone ?? "") !== "" && String(x.phone ?? "") === String(t.phone ?? ""),
  );
  return found?.id ?? null;
}
async function submitPay(): Promise<void> {
  payError.value = "";
  if (!payTarget.value) return;
  const customer_id = resolvePayCustomerId();
  if (!customer_id) {
    payError.value = "تعذر تحديد العميل — أنشئه في سجل العملاء أولاً.";
    return;
  }
  const allocations = payObligations.value
    .map((o) => ({ type: o.kind, reference_id: o.id, amount: round2(payAllocs.value[o.kind + o.id] || 0) }))
    .filter((a) => a.amount > 0);
  if (!allocations.length) {
    payError.value = "أدخل مبلغاً واحداً على الأقل.";
    return;
  }
  for (const a of allocations) {
    const o = payObligations.value.find((x) => x.kind === a.type && x.id === a.reference_id);
    if (o && a.amount - o.remaining > 1e-9) {
      payError.value = "مبلغ يتجاوز المتبقي على أحد الالتزامات.";
      return;
    }
  }
  payBusy.value = true;
  try {
    const res = await debts.payDebts({ customer_id, allocations, note: payNote.value.trim() || null });
    if (!res.ok) {
      payError.value = res.error;
      return;
    }
    notify(`تم تسجيل سداد ${formatePrice(res.total)} وتحديث الخزنة.`, "success");
    payOpen.value = false;
    selected.value = null;
    await reload();
  } finally {
    payBusy.value = false;
  }
}

async function reload(): Promise<void> {
  loading.value = true;
  try {
    book.value = await debts.fetchDebtsBook();
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([reload(), customers.fetchCustomers()]);
});
</script>
