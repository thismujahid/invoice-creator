<template>
  <UiAppDialog v-model:open="open" :title="`تطور سعر الشراء — ${unitName || 'الوحدة'}`" :z-index="80">
    <div v-if="!records.length" class="py-4 text-center text-sm text-gray-500">
      لا يوجد سجل بعد — يُبنى تلقائيًا من المشتريات القادمة.
    </div>
    <div v-else class="max-h-[60vh] space-y-2 overflow-y-auto">
      <div
        v-for="(record, index) in records"
        :key="`${record.at}-${index}`"
        class="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2 text-sm"
      >
        <b>{{ formatePrice(record.price) }}</b>
        <span class="text-xs text-gray-500">{{ formatDate(record.at) }}</span>
      </div>
      <p class="text-xs text-gray-400">الأحدث أولاً · يُحفظ آخر {{ cap }} سعرًا للمرجعية.</p>
    </div>
  </UiAppDialog>
</template>

<script setup lang="ts">
import { MAX_PURCHASE_PRICE_HISTORY, parsePurchasePriceHistory } from "~/composables/finance";

const props = defineProps<{ unitName?: string | null; history?: string | null }>();
const open = defineModel<boolean>("open", { required: true });
const { formatePrice } = useHelpers();
const cap = MAX_PURCHASE_PRICE_HISTORY;
const records = computed(() => parsePurchasePriceHistory(props.history));
function formatDate(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString("ar-EG")} · ${date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}`;
}
</script>
