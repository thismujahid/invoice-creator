<template>
  <section class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div><h3 class="font-bold">سجل المرتجعات</h3><p class="text-xs text-gray-500">يشمل المرتجعات النقدية وتسويات الديون والموردين. التصدير يشمل السجلات المحمّلة.</p></div>
      <div class="flex gap-2"><UButton size="sm" color="neutral" variant="soft" :loading="loading" @click="loadJournal">تحديث</UButton><UButton size="sm" color="info" variant="soft" icon="i-lucide-download" :disabled="!entries.length" :loading="exporting" @click="exportJournal">تصدير المرتجعات</UButton></div>
    </div>
    <UAlert v-if="error" color="error" variant="soft" :title="error" />
    <UiAppCardsSkeleton v-if="loading && !entries.length" layout="list" :count="3" />
    <div v-else class="grid gap-2">
      <UCard v-for="entry in entries" :key="`${entry.kind}-${entry.record.id}`" variant="outline">
        <div class="flex flex-wrap items-start justify-between gap-2 text-sm">
          <div><UBadge color="warning" variant="soft">{{ entry.kind === 'customer' ? 'مرتجع عميل' : 'مرتجع مورد' }}</UBadge><span class="ms-2 font-semibold">{{ entry.name }}</span><p class="mt-1 text-xs text-gray-500">{{ formatDateTime(entry.record.created_at) }} · {{ entry.invoiceId }}</p></div>
          <b>{{ formatePrice(entry.total) }} ج</b>
        </div>
        <p class="mt-2 text-xs text-gray-600">{{ entry.items }}</p>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>{{ entry.kind === 'customer' ? 'تخفيض الدين' : 'تخفيض مستحق المورد' }}: {{ formatePrice(entry.offset) }} ج</span><span>{{ entry.kind === 'customer' ? 'نقد خرج' : 'رصيد نشأ لنا' }}: {{ formatePrice(entry.other) }} ج</span><span v-if="entry.kind === 'customer'">رصيد للعميل: {{ formatePrice((entry.record.credit_issued || 0) + (entry.record.credit_restored || 0)) }} ج</span><span v-if="entry.kind === 'supplier'">نقد حُصّل لاحقًا: {{ formatePrice(entry.record.cash_received || 0) }} ج</span><span v-if="entry.kind === 'supplier' && entry.record.cost_variance !== undefined">فرق تكلفة: {{ formatePrice(entry.record.cost_variance) }} ج</span></div>
        <div class="mt-2 flex gap-2"><UButton size="xs" color="neutral" variant="link" @click="selectedEntry = entry">تفاصيل المرتجع</UButton><UButton size="xs" color="neutral" variant="link" @click="viewInvoice(entry)">عرض الفاتورة</UButton><CustomerCreditPayout v-if="entry.kind === 'customer'" :customer-id="entry.record.customer_id" :customer-name="entry.name" /></div>
      </UCard>
      <UEmpty v-if="!entries.length" title="لا توجد مرتجعات مسجلة" />
    </div>
    <UButton v-if="hasMore" size="sm" color="neutral" variant="soft" :loading="loading" @click="limit += 100; loadJournal()">تحميل المزيد</UButton>
    <UiAppDialog :open="selectedEntry !== null" title="تفاصيل المرتجع" @update:open="selectedEntry = null">
      <div v-if="selectedEntry" class="max-h-[70vh] overflow-y-auto"><p class="mb-2 text-sm">{{ selectedEntry.name }} · فاتورة {{ selectedEntry.invoiceId }}</p><ReturnHistory :customer-returns="selectedEntry.kind === 'customer' ? [selectedEntry.record] : []" :supplier-returns="selectedEntry.kind === 'supplier' ? [selectedEntry.record] : []" /></div>
    </UiAppDialog>
    <UiAppDialog v-model:open="invoiceOpen" title="فاتورة المرتجع">
      <div class="max-h-[75vh] overflow-y-auto">
        <USkeleton v-if="invoiceLoading" class="h-24 w-full" />
        <UAlert v-else-if="invoiceError" color="error" variant="soft" :title="invoiceError" />
        <Invoice v-else-if="customerInvoice" :invoice-data="customerInvoice" :returns="customerReturns" view-mode @close="invoiceOpen = false" />
        <SupplierInvoice v-else-if="supplierInvoice" :invoice="supplierInvoice" />
        <ReturnHistory v-if="supplierInvoice" class="mt-4" :supplier-returns="supplierReturns" />
      </div>
    </UiAppDialog>
  </section>
</template>

<script setup lang="ts">
import { collection, doc, documentId, getDoc, getDocs, limit as fsLimit, orderBy, query, where } from "firebase/firestore";
import type { Invoice } from "~/types";
import { toDateSafe } from "~/types";
import type { InvoiceReturn, PurchaseInvoice, SupplierReturn } from "~/types/finance";

type Entry =
  | { kind: "customer"; record: InvoiceReturn; invoiceId: string; name: string; total: number; offset: number; other: number; items: string }
  | { kind: "supplier"; record: SupplierReturn; invoiceId: string; name: string; total: number; offset: number; other: number; items: string };

const { db } = useFirebase();
const { formatePrice, formatInvoiceLineName } = useHelpers();
const { round2, toNum } = useFinance();
const { notify } = useAppToast();
const invoiceReturns = useInvoiceReturns();
const supplierReturnsApi = useSupplierReturns();
const entries = ref<Entry[]>([]);
const selectedEntry = ref<Entry | null>(null);
const limit = ref(100);
const hasMore = ref(false);
const loading = ref(false);
const exporting = ref(false);
const error = ref("");
const invoiceOpen = ref(false);
const invoiceLoading = ref(false);
const invoiceError = ref("");
const customerInvoice = ref<Invoice | null>(null);
const supplierInvoice = ref<PurchaseInvoice | null>(null);
const customerReturns = ref<InvoiceReturn[]>([]);
const supplierReturns = ref<SupplierReturn[]>([]);

function formatDateTime(value: unknown): string {
  const date = toDateSafe(value);
  return date ? `${date.toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo" })} ${date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" })}` : "—";
}

async function loadJournal(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const [customers, suppliers] = await Promise.all([
      getDocs(query(collection(db, "invoice_returns"), orderBy("created_at", "desc"), fsLimit(limit.value))),
      getDocs(query(collection(db, "supplier_returns"), orderBy("created_at", "desc"), fsLimit(limit.value))),
    ]);
    const customerRecords = customers.docs.map((item) => ({ id: item.id, ...(item.data() as object) }) as InvoiceReturn);
    const supplierRecords = suppliers.docs.map((item) => ({ id: item.id, ...(item.data() as object) }) as SupplierReturn);
    const supplierById = new Map(supplierRecords.map((record) => [record.id, record]));
    for (let index = 0; index < supplierRecords.length; index += 30) {
      const ids = supplierRecords.slice(index, index + 30).map((record) => record.id!);
      const cash = await getDocs(query(collection(db, "cash_transactions"), where("return_id", "in", ids)));
      for (const movement of cash.docs) {
        const data = movement.data();
        if (data.type !== "supplier_advance_refund" || data.direction !== "in") continue;
        const record = supplierById.get(data.return_id);
        if (record) record.cash_received = round2(toNum(record.cash_received) + toNum(data.amount));
      }
    }
    const names = new Map<string, string>();
    const ids = [...new Set(customerRecords.map((record) => record.invoice_id))];
    for (let index = 0; index < ids.length; index += 30) {
      const invoices = await getDocs(query(collection(db, "invoices"), where(documentId(), "in", ids.slice(index, index + 30))));
      for (const invoice of invoices.docs) names.set(invoice.id, String(invoice.data().customer_name || "عميل"));
    }
    entries.value = [
      ...customerRecords.map((record): Entry => ({ kind: "customer", record, invoiceId: record.invoice_id, name: names.get(record.invoice_id) || "عميل", total: toNum(record.total_refund), offset: toNum(record.debt_reduction), other: toNum(record.cash_refund), items: (record.items || []).map((item) => `${item.quantity} × ${formatInvoiceLineName(item.product_name, item.unit_name)}`).join("، ") })),
      ...supplierRecords.map((record): Entry => ({ kind: "supplier", record, invoiceId: record.purchase_invoice_id, name: record.supplier_name || "مورد", total: toNum(record.total_return), offset: toNum(record.payable_reduction), other: toNum(record.receivable_amount), items: (record.items || []).map((item) => `${item.quantity} × ${formatInvoiceLineName(item.product_name, item.unit_name)}`).join("، ") })),
    ].sort((a, b) => (toDateSafe(b.record.created_at)?.getTime() ?? 0) - (toDateSafe(a.record.created_at)?.getTime() ?? 0));
    hasMore.value = customers.size >= limit.value || suppliers.size >= limit.value;
  } catch (cause) {
    console.error(cause);
    error.value = "تعذر تحميل سجل المرتجعات.";
  } finally {
    loading.value = false;
  }
}

async function exportJournal(): Promise<void> {
  if (!entries.value.length || exporting.value) return;
  exporting.value = true;
  try {
    const XLSX = await import("xlsx/dist/xlsx.full.min.js");
    const rows = entries.value.flatMap((entry) => entry.record.items.map((item, index) => ({
      النوع: entry.kind === "customer" ? "مرتجع عميل" : "مرتجع مورد",
      التاريخ: formatDateTime(entry.record.created_at),
      "رقم الفاتورة": entry.invoiceId,
      "رقم المرتجع": entry.record.id || "",
      الطرف: entry.name,
      المنتج: item.product_name,
      الكمية: item.quantity,
      الوحدة: item.unit_name || "وحدة",
      "قيمة الصنف": entry.kind === "customer" ? (item as InvoiceReturn["items"][number]).refund_amount : (item as SupplierReturn["items"][number]).amount,
      "إجمالي المرتجع": index === 0 ? entry.total : "",
      "تخفيض دين أو مستحق": index === 0 ? entry.offset : "",
      "نقد مردود للعميل أو رصيد لنا": index === 0 ? entry.other : "",
      "رصيد محفوظ للعميل": index === 0 && entry.kind === "customer" ? (entry.record.credit_issued || 0) + (entry.record.credit_restored || 0) : "",
      "نقد حُصّل من المورد لاحقًا": index === 0 && entry.kind === "supplier" ? entry.record.cash_received || 0 : "",
      "قيمة المخزون الخارج": index === 0 && entry.kind === "supplier" ? entry.record.inventory_amount ?? "" : "",
      "فرق تكلفة المرتجع": index === 0 && entry.kind === "supplier" ? entry.record.cost_variance ?? "" : "",
      ملاحظة: entry.record.note || "",
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "المرتجعات");
    XLSX.writeFile(workbook, `المرتجعات_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (cause) {
    console.error(cause);
    notify("تعذر تصدير المرتجعات.", "error");
  } finally {
    exporting.value = false;
  }
}

async function viewInvoice(entry: Entry): Promise<void> {
  invoiceOpen.value = true;
  invoiceLoading.value = true;
  invoiceError.value = "";
  customerInvoice.value = null;
  supplierInvoice.value = null;
  customerReturns.value = [];
  supplierReturns.value = [];
  try {
    const snapshot = await getDoc(doc(db, entry.kind === "customer" ? "invoices" : "purchase_invoices", entry.invoiceId));
    if (!snapshot.exists()) throw new Error("missing invoice");
    if (entry.kind === "customer") {
      const data = snapshot.data() as Invoice;
      const date = toDateSafe(data.date);
      customerInvoice.value = { id: snapshot.id, ...data, date: date ?? data.date, time: date ?? data.time } as Invoice;
      customerReturns.value = await invoiceReturns.fetchForInvoices([entry.invoiceId]);
    } else {
      supplierInvoice.value = { id: snapshot.id, ...(snapshot.data() as object) } as PurchaseInvoice;
      supplierReturns.value = await supplierReturnsApi.fetchForInvoice(entry.invoiceId);
    }
  } catch (cause) {
    console.error(cause);
    invoiceError.value = "تعذر تحميل فاتورة المرتجع.";
  } finally {
    invoiceLoading.value = false;
  }
}

onMounted(() => { void loadJournal(); });
</script>
