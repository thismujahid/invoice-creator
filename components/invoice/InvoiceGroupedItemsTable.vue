<template>
  <table class="inv-table w-full" aria-label="أصناف الفاتورة">
    <thead>
      <tr>
        <th scope="col" class="w-10">م</th>
        <th scope="col">الصنف</th>
        <th scope="col" class="w-24">الكمية</th>
        <th scope="col" class="w-20">سعر الوحدة</th>
        <th scope="col" class="w-24">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      <template v-for="group in groups" :key="group.key">
        <tr class="inv-group-head">
          <td :colspan="5" class="text-start">
            <span class="inv-group-name">{{ titleOf(group) }}</span>
            <span class="inv-group-count">{{ group.lines.length }} {{ group.lines.length === 1 ? "بند" : "بنود" }}</span>
          </td>
        </tr>
        <tr v-for="row in group.rows" :key="row.key" class="inv-sub-row">
          <td class="tabular-nums">{{ row.serial }}</td>
          <td class="text-start inv-cell-wrap">{{ row.label }}</td>
          <td class="inv-cell-wrap">{{ row.qtyText }}</td>
          <td class="tabular-nums">{{ formatePrice(row.price) }}</td>
          <td class="tabular-nums font-semibold">{{ formatePrice(row.total) }}</td>
        </tr>
        <tr v-if="group.lines.length > 1" class="inv-group-sum-row">
          <td :colspan="4" class="text-start">إجمالي {{ titleOf(group) }}</td>
          <td class="tabular-nums font-extrabold">{{ formatePrice(group.total) }}</td>
        </tr>
      </template>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import type { InvoiceProductLine } from "~/types";
import { groupInvoiceLines, invoiceGroupTitle, invoiceVariantLabel, type InvoiceLineGroup } from "~/utils/invoiceGrouping";

const props = defineProps<{ lines: InvoiceProductLine[] }>();
const { formatePrice } = useHelpers();

interface GroupRow {
  key: string;
  serial: number;
  label: string;
  qtyText: string;
  price: number;
  total: number;
}

interface GroupView extends InvoiceLineGroup {
  rows: GroupRow[];
}

const groups = computed<GroupView[]>(() => {
  const filled = (props.lines ?? []).filter((line) => line.product_id);
  let serial = 0;
  return groupInvoiceLines(filled).map((group) => ({
    ...group,
    rows: group.lines.map(({ line }) => {
      serial += 1;
      const qty = qtyGlyph(line);
      return {
        key: lineKey(line),
        serial,
        label: invoiceVariantLabel(line),
        qtyText: `${qty} ${String(line.unit_name || "").trim()}`.trim(),
        price: Number(line.product_price || 0),
        total: Number(line.product_price || 0) * Number(line.product_quantity || 0),
      };
    }),
  }));
});

function titleOf(group: InvoiceLineGroup): string {
  return invoiceGroupTitle(group);
}

function lineKey(line: InvoiceProductLine): string {
  return String(line.line_id || `${line.product_id}-${line.unit_id}-${line.product_quantity}-${line.product_price}`);
}

function qtyGlyph(line: InvoiceProductLine): string | number {
  if (line.product_quantity === 0.5) return "1/2";
  if (line.product_quantity === 0.25) return "1/4";
  if (line.product_quantity === 0.75) return "3/4";
  return line.product_quantity || "";
}
</script>

<style scoped>
.inv-group-head td {
  background: rgba(148, 163, 184, 0.14);
  font-weight: 800;
  padding-block: 4px;
}
.inv-group-name {
  font-size: 1.02em;
}
.inv-group-count {
  margin-inline-start: 8px;
  font-size: 0.82em;
  font-weight: 600;
  color: #475569;
}
.inv-sub-row td {
  vertical-align: top;
  line-height: 1.7;
}
.inv-cell-wrap {
  white-space: normal;
  word-break: break-word;
}
.inv-group-sum-row td {
  border-top: 2px solid #000;
  background: rgba(148, 163, 184, 0.08);
  padding-block: 3px;
}
@media print {
  .inv-sub-row {
    break-inside: avoid;
  }
}
</style>
