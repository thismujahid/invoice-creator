<template>
  <section class="space-y-3" dir="rtl">
    <div class="flex flex-wrap items-center justify-between gap-2"><div><h2 class="font-bold">سجل المرتجعات</h2><p class="text-xs text-gray-500">مرتجعات العملاء وتسوية كل عملية</p></div><div class="flex gap-2"><UButton size="sm" color="info" variant="soft" icon="i-lucide-download" :loading="exporting" @click="exportJournal">تصدير</UButton><UButton size="sm" color="neutral" variant="soft" :loading="loading" @click="refresh">تحديث</UButton></div></div>
    <UAlert v-if="error" color="error" variant="soft" :title="error" />
    <UiAppCardsSkeleton v-if="loading && !items.length" layout="list" :count="3" />
    <div v-else class="grid gap-2">
      <UCard v-for="item in items" :key="item.id" variant="outline">
        <div class="flex flex-wrap justify-between gap-2"><div><strong>{{ item.customer_name }}</strong><div class="text-xs text-gray-500">{{ formatDate(item.created_at) }} · فاتورة {{ item.invoice_id }}</div></div><b class="text-amber-700">{{ formatePrice(item.total_refund) }}</b></div>
        <div class="mt-2 text-sm text-gray-600">{{ item.items.map((line) => `${line.quantity} × ${formatInvoiceLineName(line.product_name, line.unit_name)}`).join('، ') }}</div>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>تخفيض الدين: {{ formatePrice(item.debt_reduction) }}</span><span>نقد مردود: {{ formatePrice(item.cash_refund) }}</span><span>رصيد للعميل: {{ formatePrice((item.credit_issued || 0) + (item.credit_restored || 0)) }}</span></div>
        <div class="mt-2 flex gap-2"><UButton size="xs" color="neutral" variant="link" @click="selected = item">التفاصيل</UButton><CustomerCreditPayout :customer-id="item.customer_id" :customer-name="item.customer_name" /></div>
      </UCard>
      <UEmpty v-if="!items.length" title="لا توجد مرتجعات" />
    </div>
    <UButton v-if="cursor" size="sm" color="neutral" variant="soft" :loading="loading" @click="loadMore">تحميل المزيد</UButton>
    <UiAppDialog :open="!!selected" title="تفاصيل المرتجع" @update:open="selected = null"><ReturnHistory v-if="selected" :customer-returns="[selected]" /></UiAppDialog>
  </section>
</template>

<script setup lang="ts">
import type { InvoiceReturn } from "~/types/finance";
import { toDateSafe } from "~/types";

type JournalItem = InvoiceReturn & { id: string; customer_name: string };
const { formatePrice, formatInvoiceLineName } = useHelpers();
const items = ref<JournalItem[]>([]);
const selected = ref<JournalItem | null>(null);
const cursor = ref<string | null>(null);
const loading = ref(false);
const exporting = ref(false);
const error = ref("");
function formatDate(value: unknown): string { return toDateSafe(value)?.toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }) ?? "—"; }
async function load(reset = false): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const result = await callStaff<{ cursor: string | null }, { items: JournalItem[]; nextCursor: string | null }>("getCashierReturnJournal", { cursor: reset ? null : cursor.value });
    items.value = reset ? result.items : [...items.value, ...result.items];
    cursor.value = result.nextCursor;
  } catch { error.value = "تعذر تحميل سجل المرتجعات."; }
  finally { loading.value = false; }
}
function refresh(): void { void load(true); }
function loadMore(): void { void load(); }
async function exportJournal(): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  error.value = "";
  try {
    const all: JournalItem[] = [];
    let next: string | null = null;
    do {
      const page: { items: JournalItem[]; nextCursor: string | null } = await callStaff<{ cursor: string | null }, { items: JournalItem[]; nextCursor: string | null }>("getCashierReturnJournal", { cursor: next });
      all.push(...page.items);
      next = page.nextCursor;
    } while (next);
    if (!all.length) return;
    const XLSX = await import("xlsx/dist/xlsx.full.min.js");
    const rows = all.flatMap((record) => record.items.map((line, index) => ({
      "رقم الفاتورة": record.invoice_id, "رقم المرتجع": record.id, التاريخ: formatDate(record.created_at), العميل: record.customer_name,
      المنتج: line.product_name, الكمية: line.quantity, الوحدة: line.unit_name || "وحدة", "قيمة الصنف": line.refund_amount,
      "إجمالي المرتجع": index === 0 ? record.total_refund : "", "تخفيض الدين": index === 0 ? record.debt_reduction : "",
      "نقد مردود": index === 0 ? record.cash_refund : "", "رصيد محفوظ للعميل": index === 0 ? Number(record.credit_issued || 0) + Number(record.credit_restored || 0) : "",
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "المرتجعات");
    XLSX.writeFile(workbook, `المرتجعات_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch { error.value = "تعذر تصدير سجل المرتجعات."; }
  finally { exporting.value = false; }
}
onMounted(() => { void load(true); });
</script>
