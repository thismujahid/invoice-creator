<template>
  <section class="space-y-3" dir="rtl">
    <h3 class="font-bold">سجل المرتجعات</h3>
    <USkeleton v-if="loading" class="h-24 w-full" />
    <UAlert v-else-if="error" color="error" variant="soft" :title="error" />
    <UEmpty v-else-if="!customerReturns.length && !supplierReturns.length" title="لا توجد مرتجعات" />
    <UCard v-for="item in customerReturns" :key="item.id" variant="outline">
      <div class="flex flex-wrap items-start justify-between gap-2 text-sm">
        <div><b>مرتجع عميل</b><p class="text-xs text-gray-500">{{ formatDate(item.created_at) }}</p></div>
        <b class="text-amber-700">{{ formatePrice(item.total_refund) }} ج</b>
      </div>
      <div v-for="(line, index) in item.items || []" :key="index" class="mt-2 flex flex-wrap justify-between gap-2 border-t pt-2 text-sm">
        <span>{{ line.quantity }} × {{ formatInvoiceLineName(line.product_name, line.unit_name) }}</span>
        <b>{{ formatePrice(line.refund_amount) }} ج</b>
      </div>
      <div class="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2 text-xs">
        <span>تخفيض دين العميل</span><b>{{ formatePrice(item.debt_reduction || 0) }} ج</b>
        <span>مبلغ رُد نقدًا</span><b>{{ formatePrice(item.cash_refund || 0) }} ج</b>
        <template v-if="item.credit_restored"><span>رصيد شراء أُعيد للعميل</span><b>{{ formatePrice(item.credit_restored) }} ج</b></template>
        <template v-if="item.credit_issued"><span>رصيد جديد محفوظ للعميل</span><b>{{ formatePrice(item.credit_issued) }} ج</b></template>
      </div>
      <p v-if="item.note" class="mt-2 text-xs text-gray-500">{{ item.note }}</p>
    </UCard>
    <UCard v-for="item in supplierReturns" :key="item.id" variant="outline">
      <div class="flex flex-wrap items-start justify-between gap-2 text-sm">
        <div><b>مرتجع مورد</b><p class="text-xs text-gray-500">{{ formatDate(item.created_at) }}</p></div>
        <b class="text-amber-700">{{ formatePrice(item.total_return) }} ج</b>
      </div>
      <div v-for="(line, index) in item.items || []" :key="index" class="mt-2 flex flex-wrap justify-between gap-2 border-t pt-2 text-sm">
        <span>{{ line.quantity }} × {{ formatInvoiceLineName(line.product_name, line.unit_name) }}</span>
        <b>{{ formatePrice(line.amount) }} ج</b>
      </div>
      <div class="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2 text-xs">
        <span>تخفيض المستحق للمورد</span><b>{{ formatePrice(item.payable_reduction) }} ج</b>
        <span>رصيد مستحق لنا</span><b>{{ formatePrice(item.receivable_amount) }} ج</b>
        <span>نقد حُصّل لاحقًا</span><b>{{ formatePrice(item.cash_received || 0) }} ج</b>
      </div>
      <p v-if="item.note" class="mt-2 text-xs text-gray-500">{{ item.note }}</p>
    </UCard>
  </section>
</template>

<script setup lang="ts">
import type { InvoiceReturn, SupplierReturn } from "~/types/finance";
import { toDateSafe } from "~/types";

withDefaults(defineProps<{
  customerReturns?: InvoiceReturn[];
  supplierReturns?: SupplierReturn[];
  loading?: boolean;
  error?: string;
}>(), { customerReturns: () => [], supplierReturns: () => [], loading: false, error: "" });

const { formatePrice, formatInvoiceLineName } = useHelpers();
function formatDate(value: unknown): string {
  return toDateSafe(value)?.toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }) ?? "—";
}
</script>
