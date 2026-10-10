<template>
  <div id="supplier-invoice-data" class="rounded-lg border border-gray-300 bg-white p-3 text-[13px] leading-relaxed">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-lg font-bold">فاتورة مورد</h2>
        <div><strong>المورد/ </strong>{{ invoice.supplier_name || "مورد غير مسمى" }}</div>
        <div v-if="invoice.supplier_ref || invoice.invoice_number"><strong>رقم الفاتورة/ </strong>{{ invoice.invoice_number || invoice.supplier_ref }}</div>
      </div>
      <img src="/logo.png" alt="شعار المتجر" width="110" />
    </div>
    <div class="mt-1 text-gray-500"><strong>التاريخ/ </strong>{{ formatDate(invoice.created_at) }}</div>
    <table class="supplier-invoice-table w-full">
      <thead>
        <tr><th>المنتج</th><th>الوحدة</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in invoice.items || []" :key="`${item.product_id}-${index}`">
          <td class="text-start">{{ item.product_name }}<div class="text-[11px] font-normal text-gray-500">المعامل ×{{ item.unit_factor || 1 }} · تكلفة الأساسية {{ item.base_unit_cost == null ? "—" : `${formatePrice(item.base_unit_cost)} ج` }} · الأساسية {{ item.base_quantity ?? "—" }}</div></td>
          <td>{{ item.unit_name || "وحدة" }}</td>
          <td>{{ item.quantity }}</td>
          <td>{{ formatePrice(item.unit_cost) }}</td>
          <td class="font-semibold">{{ formatePrice(item.line_total ?? item.quantity * item.unit_cost) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="supplier-invoice-footer">
      <div><strong>الإجمالي/</strong><span>{{ formatePrice(invoice.total_amount) }} ج</span></div>
      <div><strong>المدفوع/</strong><span>{{ formatePrice(invoice.paid_amount) }} ج</span></div>
      <div><strong>المتبقي/</strong><span>{{ formatePrice(invoice.remaining_amount) }} ج</span></div>
    </div>
    <div class="no-print mt-3">
      <UButton class="w-full" color="success" icon="i-lucide-printer" :loading="printing" @click="printInvoice">طباعة الفاتورة</UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PurchaseInvoice } from "~/types/finance";
import { toDateSafe } from "~/types";

const props = defineProps<{ invoice: PurchaseInvoice }>();
const { formatePrice, useDownloadPDF } = useHelpers();
const printing = ref(false);

function formatDate(value: unknown): string {
  return toDateSafe(value)?.toLocaleString("ar-EG") ?? "—";
}

async function printInvoice(): Promise<void> {
  if (printing.value) return;
  printing.value = true;
  try {
    const date = toDateSafe(props.invoice.created_at)?.toLocaleDateString("ar-EG") ?? "";
    await useDownloadPDF("supplier-invoice-data", `فاتورة مورد ${props.invoice.supplier_name || ""} ${date}`);
  } finally {
    printing.value = false;
  }
}
</script>

<style scoped>
.supplier-invoice-table { border-collapse: collapse; margin-top: 8px; }
.supplier-invoice-table th, .supplier-invoice-table td { border: 1px solid #111827; text-align: center; padding: 4px; }
.supplier-invoice-footer { border: 1px solid #111827; border-top: 0; padding: 4px 8px; }
.supplier-invoice-footer > div { display: flex; justify-content: space-between; padding-block: 4px; }
@media print { .no-print { display: none !important; } }
</style>
