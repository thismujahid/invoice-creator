<template>
  <table class="inv-table w-full">
    <thead>
      <tr>
        <th class="w-10">عدد</th>
        <th>البيان</th>
        <th class="w-12">تصحيح</th>
        <th class="w-20">سعر الوحدة</th>
        <th class="w-20">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="group in groups" :key="group.key" class="inv-group-row">
        <td>{{ group.lines.length }}</td>
        <td class="text-start inv-group-cell">
          <div class="inv-group-title">{{ titleOf(group) }}</div>
          <div
            v-for="{ line } in group.lines"
            :key="lineKey(line)"
            class="inv-sub-line"
          >
            <span class="inv-sub-label">{{ subLabel(line) }}</span>
            <span class="inv-sub-math">
              {{ qtyGlyph(line) }} {{ line.unit_name || "" }} ×
              {{ formatePrice(line.product_price || 0) }} =
              {{ formatePrice(lineTotal(line)) }}
            </span>
          </div>
        </td>
        <td />
        <td class="inv-group-cell">
          <div
            v-for="{ line } in group.lines"
            :key="`p-${lineKey(line)}`"
            class="inv-sub-line"
          >
            {{ formatePrice(line.product_price || 0) }}
          </div>
        </td>
        <td class="inv-group-cell font-semibold">
          <div
            v-for="{ line } in group.lines"
            :key="`t-${lineKey(line)}`"
            class="inv-sub-line"
          >
            {{ formatePrice(lineTotal(line)) }}
          </div>
          <div class="inv-group-sum">
            المجموعة: {{ formatePrice(group.total) }}
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import type { InvoiceProductLine } from "~/types";
import { groupInvoiceLines, invoiceGroupTitle, type InvoiceLineGroup } from "~/utils/invoiceGrouping";

const props = defineProps<{ lines: InvoiceProductLine[] }>();
const { formatePrice } = useHelpers();

const groups = computed<InvoiceLineGroup[]>(() =>
  groupInvoiceLines((props.lines ?? []).filter((line) => line.product_id)),
);

function titleOf(group: InvoiceLineGroup): string {
  return invoiceGroupTitle(group);
}

function lineKey(line: InvoiceProductLine): string {
  return String(line.line_id || `${line.product_id}-${line.unit_id}-${line.product_quantity}-${line.product_price}`);
}

/** Sub-line label from the line snapshot — never the live catalog. */
function subLabel(line: InvoiceProductLine): string {
  const parts = [line.variant_name, line.pack_size_name].map((part) => String(part ?? "").trim()).filter(Boolean);
  if (parts.length) return parts.join(" — ");
  return String(line.product_name || "صنف");
}

function qtyGlyph(line: InvoiceProductLine): string | number {
  if (line.product_quantity === 0.5) return "1/2";
  if (line.product_quantity === 0.25) return "1/4";
  if (line.product_quantity === 0.75) return "3/4";
  return line.product_quantity || "";
}

function lineTotal(line: InvoiceProductLine): number {
  return Number(line.product_price || 0) * Number(line.product_quantity || 0);
}
</script>

<style scoped>
.inv-group-cell {
  white-space: normal;
  word-break: break-word;
  vertical-align: top;
}
.inv-group-title {
  font-weight: 800;
  margin-bottom: 2px;
}
.inv-sub-line {
  line-height: 1.7;
}
.inv-sub-label {
  font-weight: 600;
}
.inv-sub-math {
  display: block;
}
.inv-group-sum {
  margin-top: 2px;
  border-top: 1px dashed rgba(128, 128, 128, 0.4);
  padding-top: 2px;
}
@media print {
  .inv-sub-line {
    break-inside: avoid;
  }
}
</style>
