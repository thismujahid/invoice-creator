<template>
  <!-- Printable debts-book statement: one block per customer with their
    invoices, product lines, and totals. Cloned into #printableArea by
    useDownloadPDF, same mechanism as invoice printing. -->
  <div id="debts-statement" dir="rtl" style="direction: rtl; text-align: right;">
    <div class="ds-head" dir="rtl">
      <h2>كشف حساب الديون</h2>
      <p>
        التاريخ: {{ today }} · عدد العملاء: {{ book.length }} ·
        إجمالي الديون: {{ fmt(grandTotal) }} ج
      </p>
    </div>
    <section v-for="c in book" :key="c.key" class="ds-customer" dir="rtl">
      <div class="ds-customer-head">
        <b>{{ c.name }}</b>
        <span v-if="c.phone"> · {{ c.phone }}</span>
        <span>
          · فواتير: {{ c.unpaidCount }} · ديون الفواتير:
          {{ fmt(c.invoiceDebt) }} ج · السلف: {{ fmt(c.loanDebt) }} ج ·
          الإجمالي: {{ fmt(c.totalDebt) }} ج
        </span>
      </div>
      <table class="ds-table">
        <thead>
          <tr>
            <th>الفاتورة / التاريخ</th>
            <th>المنتج</th>
            <th>الكمية</th>
            <th>السعر</th>
            <th>إجمالي السطر</th>
            <th>مدفوع الفاتورة</th>
            <th>متبقي الفاتورة</th>
          </tr>
        </thead>
        <tbody>
          <template
            v-for="inv in customerInvoices(c.key)"
            :key="inv.id || inv.key"
          >
            <tr
              v-for="(line, li) in inv.lines"
              :key="`${inv.id}-${li}`"
            >
              <td v-if="li === 0" :rowspan="Math.max(inv.lines.length, 1)">
                {{ shortId(inv.id) }}<br />{{ inv.date }}
              </td>
              <td>{{ line.name }}</td>
              <td>{{ line.qty }}{{ line.unit ? ` ${line.unit}` : "" }}</td>
              <td>{{ fmt(line.price) }}</td>
              <td>{{ fmt(line.total) }}</td>
              <td v-if="li === 0" :rowspan="Math.max(inv.lines.length, 1)">
                {{ fmt(inv.paid) }}
              </td>
              <td v-if="li === 0" :rowspan="Math.max(inv.lines.length, 1)">
                {{ fmt(inv.remaining) }}
              </td>
            </tr>
            <tr v-if="!inv.lines.length">
              <td>{{ shortId(inv.id) }}<br />{{ inv.date }}</td>
              <td colspan="3">بدون أصناف</td>
              <td>{{ fmt(inv.paid) }}</td>
              <td>{{ fmt(inv.remaining) }}</td>
            </tr>
          </template>
          <tr v-if="!customerInvoices(c.key).length">
            <td colspan="7">
              {{
                c.loans.length
                  ? "لا توجد فواتير مفصلة (الدين من سلف فقط)"
                  : "تعذر جلب تفاصيل الفواتير"
              }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="c.loans.length" class="ds-loans">
        السلف:
        <span v-for="loan in c.loans" :key="loan.id">
          {{ loan.label }} — الإجمالي {{ fmt(loan.total) }} · المدفوع
          {{ fmt(loan.paid) }} · المتبقي {{ fmt(loan.remaining) }}؛
        </span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { Invoice } from "~/types";
import { toDateSafe } from "~/types";
import type { CustomerDebt } from "~/composables/useDebts";
import { summarizeInvoice } from "~/composables/debtSummaries";

interface StatementLine {
  name: string;
  qty: number;
  unit: string;
  price: number;
  total: number;
}
interface StatementInvoice {
  id?: string;
  key: string;
  date: string;
  lines: StatementLine[];
  total: number;
  paid: number;
  remaining: number;
}

const props = defineProps<{
  book: CustomerDebt[];
  invoicesByKey: Record<string, Invoice[]>;
}>();
const { formatePrice } = useHelpers();

function fmt(v: unknown): string {
  const n = Number(v);
  return formatePrice(Number.isFinite(n) ? n : 0);
}
function shortId(id: unknown): string {
  const s = String(id ?? "");
  return s ? `#${s.slice(0, 6)}` : "—";
}
function formatDay(v: unknown): string {
  return toDateSafe(v)?.toLocaleDateString("ar-EG") ?? "—";
}
const today = new Date().toLocaleDateString("ar-EG");

function statementInvoices(key: string): StatementInvoice[] {
  return (props.invoicesByKey[key] ?? []).map((inv, i) => {
    const totals = summarizeInvoice(inv);
    const products = Array.isArray(inv.products) ? inv.products : [];
    return {
      id: inv.id,
      key: String(inv.id ?? `${key}-${i}`),
      date: formatDay(inv.date),
      lines: products.map((l) => {
        const qty = Number(l.product_quantity) || 0;
        const price = Number(l.product_price) || 0;
        return {
          name: String(l.product_name || "غير محدد"),
          qty,
          unit: String(l.unit_name || ""),
          price,
          total: qty * price,
        };
      }),
      total: totals.total,
      paid: totals.paid,
      remaining: totals.remaining,
    };
  });
}
// Recomputed reactively from props on every render pass — never cached
// across prints, otherwise a reprint would keep serving stale rows.
const statementsByKey = computed<Record<string, StatementInvoice[]>>(() => {
  const out: Record<string, StatementInvoice[]> = {};
  for (const c of props.book) out[c.key] = statementInvoices(c.key);
  return out;
});
function customerInvoices(key: string): StatementInvoice[] {
  return statementsByKey.value[key] ?? [];
}
const grandTotal = computed(() =>
  props.book.reduce((s, c) => s + Number(c.totalDebt || 0), 0),
);
</script>

<style scoped>
#debts-statement {
  color: #000;
  font-size: 12px;
}
.ds-head {
  text-align: center;
  margin-bottom: 12px;
}
.ds-head h2 {
  font-size: 20px;
  font-weight: 800;
  margin: 0 0 4px;
}
.ds-head p {
  margin: 0;
  color: #333;
}
.ds-customer {
  margin-bottom: 14px;
  break-inside: avoid;
}
.ds-customer-head {
  font-size: 14px;
  margin-bottom: 6px;
  border-bottom: 2px solid #000;
  padding-bottom: 4px;
}
.ds-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 4px;
}
.ds-table th,
.ds-table td {
  border: 1px solid #555;
  padding: 4px 6px;
  text-align: start;
  vertical-align: top;
}
.ds-table thead th {
  font-weight: 700;
}
.ds-loans {
  font-size: 11px;
  color: #222;
}
</style>
