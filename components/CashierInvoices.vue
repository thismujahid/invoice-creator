<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4" dir="rtl">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">فواتير البيع</h2>
      <UButton icon="i-lucide-refresh-cw" color="neutral" variant="soft" :loading="loading" @click="loadPage">تحديث</UButton>
    </div>
    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-3">
      <template #actions><UButton size="xs" color="error" variant="soft" @click="loadPage">إعادة المحاولة</UButton></template>
    </UAlert>
    <UiAppTableSkeleton v-if="loading" />
    <template v-else>
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead><tr class="border-b text-gray-500">
            <th class="p-2 text-start">العميل</th><th class="p-2 text-start">التاريخ</th>
            <th class="p-2 text-start">المنتجات</th><th class="p-2 text-start">الإجمالي</th>
            <th class="p-2 text-start">المدفوع</th><th class="p-2 text-start">المتبقي</th>
            <th class="p-2 text-start">الفاتورة</th>
          </tr></thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" class="border-b last:border-0">
              <td class="p-2">{{ item.customer_name }}</td><td class="p-2">{{ formatDate(item.date) }}</td>
              <td class="p-2">{{ item.product_count }}</td><td class="p-2">{{ formatePrice(item.total) }} ج</td>
              <td class="p-2">{{ formatePrice(item.paid) }} ج</td><td class="p-2">{{ formatePrice(item.remaining) }} ج</td>
              <td class="p-2"><UButton size="xs" variant="soft" :loading="viewingId === item.id" @click="viewInvoice(item.id)">عرض وطباعة</UButton></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="space-y-2 md:hidden">
        <UCard v-for="item in items" :key="item.id" variant="outline">
          <div class="flex items-start justify-between gap-2"><div><div class="font-bold">{{ item.customer_name }}</div><div class="text-xs text-gray-500">{{ formatDate(item.date) }} · {{ item.product_count }} منتجات</div></div><UButton size="xs" variant="soft" :loading="viewingId === item.id" @click="viewInvoice(item.id)">عرض وطباعة</UButton></div>
          <div class="mt-2 text-sm">الإجمالي: {{ formatePrice(item.total) }} ج · المدفوع: {{ formatePrice(item.paid) }} ج · المتبقي: {{ formatePrice(item.remaining) }} ج</div>
        </UCard>
      </div>
      <UEmpty v-if="!items.length && !error" icon="i-lucide-files" title="لا توجد فواتير" />
      <div class="mt-3 flex items-center justify-between gap-2">
        <span class="text-sm text-gray-500">صفحة {{ page }}</span>
        <div class="flex gap-2">
          <UButton color="neutral" variant="soft" :disabled="page <= 1" @click="previousPage">السابق</UButton>
          <UButton color="neutral" variant="soft" :disabled="!nextCursor" @click="nextPage">التالي</UButton>
        </div>
      </div>
    </template>
    <UiAppDialog v-model:open="invoiceOpen" title="عرض الفاتورة">
      <div class="max-h-[80vh] overflow-auto"><Invoice v-if="selectedInvoice" :invoice-data="selectedInvoice" view-mode @close="invoiceOpen = false" /></div>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Invoice, InvoiceDate } from "~/types";

interface CashierInvoiceSummary {
  id: string;
  customer_name: string;
  date: InvoiceDate;
  product_count: number;
  total: number;
  paid: number;
  remaining: number;
}

const { formatePrice, formatDate } = useHelpers();
const items = ref<CashierInvoiceSummary[]>([]);
const page = ref(1);
const cursors = ref<(string | null)[]>([null]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const error = ref("");
const viewingId = ref<string | null>(null);
const selectedInvoice = ref<Invoice | null>(null);
const invoiceOpen = ref(false);

async function loadPage(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const result = await callStaff<{ cursor: string | null }, { items: CashierInvoiceSummary[]; nextCursor: string | null }>("getCashierInvoices", { cursor: cursors.value[page.value - 1] ?? null });
    items.value = result.items;
    nextCursor.value = result.nextCursor;
  } catch {
    error.value = "تعذر تحميل الفواتير. حاول مرة أخرى.";
  } finally {
    loading.value = false;
  }
}

async function nextPage(): Promise<void> {
  if (!nextCursor.value || loading.value) return;
  cursors.value[page.value] = nextCursor.value;
  page.value += 1;
  await loadPage();
}

async function previousPage(): Promise<void> {
  if (page.value <= 1 || loading.value) return;
  page.value -= 1;
  await loadPage();
}

async function viewInvoice(id: string): Promise<void> {
  if (viewingId.value) return;
  viewingId.value = id;
  error.value = "";
  try {
    selectedInvoice.value = await callStaff<{ id: string }, Invoice>("getCashierInvoice", { id });
    invoiceOpen.value = true;
  } catch {
    error.value = "تعذر فتح الفاتورة. حاول مرة أخرى.";
  } finally {
    viewingId.value = null;
  }
}

onMounted(async () => {
  if (await useAuthReady()) await loadPage();
  else loading.value = false;
});
</script>
