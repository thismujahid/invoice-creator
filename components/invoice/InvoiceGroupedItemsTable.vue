<template>
  <table class="inv-table inv-ref-table" dir="rtl" aria-label="أصناف الفاتورة">
    <colgroup>
      <col style="width: 8%" />
      <col style="width: 55%" />
      <col style="width: 12%" />
      <col style="width: 12%" />
      <col style="width: 13%" />
    </colgroup>
    <thead>
      <tr>
        <th scope="col">عدد</th>
        <th scope="col">اسم الصنف</th>
        <th scope="col">تصحيح</th>
        <th scope="col">السعر</th>
        <th scope="col">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.key" class="inv-ref-row">
        <td class="tabular-nums">
          {{ formatDisplayQuantity(row.displayQuantity) }}
        </td>
        <td class="inv-ref-name">{{ row.name }}</td>
        <td class="inv-ref-correction"></td>
        <td class="tabular-nums">{{ priceText(row) }}</td>
        <td class="tabular-nums">{{ formatePrice(row.displayTotal) }}</td>
      </tr>
      <tr v-if="!rows.length">
        <td colspan="5">لا توجد أصناف</td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import type { InvoiceProductLine } from "~/types";
import {
  buildInvoiceDisplayRows,
  formatDisplayQuantity,
  type InvoiceDisplayRow,
} from "~/utils/invoiceDisplay";

const props = defineProps<{ lines: InvoiceProductLine[] }>();
const { formatePrice } = useHelpers();

/** Preview + print share this exact derivation (single source of truth). */
const rows = computed<InvoiceDisplayRow[]>(() =>
  buildInvoiceDisplayRows(props.lines ?? []),
);

function priceText(row: InvoiceDisplayRow): string {
  if (row.displayPrice !== null && row.displayPrice !== undefined)
    return formatePrice(row.displayPrice);
  if (!row.unitPrices.length) return "";
  return row.unitPrices.map((p) => formatePrice(p)).join(" / ");
}
</script>

<style scoped>
.inv-ref-table {
  width: 100%;
  background: #fff;
}
.inv-ref-table thead th {
  font-weight: 800;
  color: #000;
}
.inv-ref-row td {
  color: #000;
  vertical-align: top;
}
.inv-ref-name {
  text-align: right;
  word-break: break-word;
  white-space: normal;
}
.inv-ref-correction {
  min-width: 170px;
}
.inv-ref-correction:empty::before {
  content: "";
}
@media print {
  .inv-ref-table thead {
    display: table-header-group;
  }
  .inv-ref-row {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
</style>
