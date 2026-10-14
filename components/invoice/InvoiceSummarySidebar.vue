<template>
  <!-- Read-only mirror of the invoice financial summary. All numbers arrive
    pre-formatted from the page — no calculations or state live here. -->
  <aside class="rounded-xl border border-slate-200 bg-white p-3" aria-label="ملخص الفاتورة">
    <h2 class="mb-2 text-sm font-extrabold text-slate-800">ملخص الفاتورة</h2>
    <div class="space-y-1.5 text-sm">
      <div class="flex items-center justify-between gap-2">
        <span class="text-slate-500">الإجمالي قبل الخصم</span>
        <span class="font-semibold tabular-nums">{{ grossText }} ج</span>
      </div>
      <div v-if="showDiscount" class="flex items-center justify-between gap-2">
        <span class="text-slate-500">الخصم ({{ discountLabel }})</span>
        <span class="font-semibold tabular-nums">{{ discountText }} ج</span>
      </div>
      <div class="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-base font-extrabold">
        <span>الصافي</span>
        <span class="tabular-nums">{{ netText }} ج</span>
      </div>
      <div v-if="showPaid" class="flex items-center justify-between gap-2">
        <span class="text-slate-500">المدفوع</span>
        <span class="font-semibold tabular-nums">{{ paidText }} ج</span>
      </div>
      <div v-if="showCreditUsed" class="flex items-center justify-between gap-2">
        <span class="text-slate-500">من رصيد العميل</span>
        <span class="font-semibold tabular-nums">{{ creditUsedText }} ج</span>
      </div>
      <div v-if="showPaid" class="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 font-extrabold">
        <span>المتبقي</span>
        <span class="tabular-nums">{{ remainingText }} ج</span>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  grossText: string;
  showDiscount: boolean;
  discountLabel: string;
  discountText: string;
  netText: string;
  showPaid: boolean;
  paidText: string;
  remainingText: string;
  showCreditUsed: boolean;
  creditUsedText: string;
}>();
</script>
