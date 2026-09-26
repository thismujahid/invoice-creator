<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div><h1 class="text-xl font-bold">فواتير الموردين</h1><p class="text-sm text-gray-500">مشتريات ومستحقات الموردين مستقلة عن دفتر ديون العملاء.</p></div>
      <UButton color="success" icon="i-lucide-plus" @click="startDraft()">فاتورة مورد جديدة</UButton>
    </header>
    <div class="grid gap-3 sm:grid-cols-3"><UCard variant="outline"><p class="text-xs text-gray-500">فواتير الموردين</p><b class="text-xl">{{ visibleInvoices.length }}</b></UCard><UCard variant="outline"><p class="text-xs text-gray-500">إجمالي المشتريات</p><b class="text-xl">{{ formatePrice(totalPurchases) }} ج</b></UCard><UCard variant="outline"><p class="text-xs text-gray-500">إجمالي المستحق</p><b class="text-xl text-red-600">{{ formatePrice(totalPayable) }} ج</b></UCard></div>
    <div class="flex flex-wrap gap-2"><UInput v-model="search" icon="i-lucide-search" placeholder="بحث بالمورد أو رقم الفاتورة" class="w-full sm:max-w-sm" /><USelect v-model="statusFilter" :items="[{ label: 'كل الحالات', value: 'all' }, { label: 'غير مسددة', value: 'unpaid' }, { label: 'مسددة جزئيًا', value: 'partial' }, { label: 'مسددة', value: 'paid' }]" value-key="value" label-key="label" class="w-full sm:w-44" /></div>
    <USkeleton v-if="loading" class="h-24 w-full" />
    <div v-else class="space-y-3">
      <UCard v-for="invoice in visibleInvoices" :key="invoice.id" variant="outline">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h2 class="font-bold">{{ invoice.invoice_number || invoice.supplier_ref || `فاتورة ${invoice.id?.slice(0, 6)}` }}</h2><UBadge :color="statusColor(invoice)" variant="soft">{{ statusLabel(invoice) }}</UBadge><UBadge v-if="invoice.pinned" color="warning" variant="soft">مثبتة</UBadge></div><p class="text-sm text-gray-500">{{ invoice.supplier_name || 'مورد غير مسمى' }} · {{ sourceLabel(invoice.source) }} · {{ formatDateOnly(invoice.created_at) }} · {{ invoice.items.length }} أصناف</p><div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm"><span>الإجمالي <b>{{ formatePrice(invoice.total_amount) }} ج</b></span><span>مدفوع {{ formatePrice(invoice.paid_amount) }} ج</span><span class="font-bold text-red-600">باقٍ {{ formatePrice(invoice.remaining_amount) }} ج</span></div></div>
          <div class="flex flex-wrap gap-1"><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-eye" @click="openDetails(invoice)">عرض</UButton><UButton size="sm" color="neutral" variant="soft" :icon="invoice.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'" @click="togglePin(invoice)">{{ invoice.pinned ? 'إلغاء التثبيت' : 'تثبيت' }}</UButton><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-copy-plus" @click="startDraft(invoice)">فاتورة جديدة من هذه</UButton><UButton size="sm" v-if="invoice.remaining_amount > 0" color="success" icon="i-lucide-hand-coins" @click="openPayment(invoice)">تسديد</UButton></div>
        </div>
      </UCard>
      <UEmpty v-if="!visibleInvoices.length" icon="i-lucide-receipt" title="لا توجد فواتير موردين" />
    </div>

    <UiAppDialog v-model:open="draftOpen" :title="draftSource ? 'مسودة فاتورة جديدة من فاتورة سابقة' : 'فاتورة مورد جديدة'">
      <div class="max-h-[65vh] space-y-4 overflow-y-auto pe-1">
        <UFormField label="المورد" required><USelectMenu v-model="draftSupplier" :items="suppliers.list" label-key="name" by="id" placeholder="اختر المورد" class="w-full" /></UFormField>
        <UFormField v-if="draftSource && !draftSupplier" label="اسم المورد في الفاتورة السابقة" required><UInput v-model="supplierName" placeholder="اسم المورد" class="w-full" /></UFormField>
        <UFormField label="رقم فاتورة المورد"><UInput v-model="supplierRef" dir="ltr" class="w-full" /></UFormField>
        <div v-for="(line, index) in draftLines" :key="line.key" class="space-y-2 rounded-xl border border-gray-200 p-3">
          <div class="flex items-center justify-between"><b class="text-sm">صنف {{ index + 1 }}</b><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" aria-label="حذف الصنف" :disabled="draftLines.length <= 1" @click="draftLines.splice(index, 1)" /></div>
          <UFormField label="المنتج"><USelectMenu :model-value="line.product" :items="productOptions(line)" label-key="name" by="id" placeholder="اختر المنتج" class="w-full" @update:model-value="(product) => pickProduct(line, product)" /></UFormField>
          <div v-if="line.product" class="grid grid-cols-2 gap-2">
            <UFormField label="وحدة الشراء"><USelectMenu :model-value="selectedUnit(line)" :items="unitOptions(line)" label-key="name" by="id" class="w-full" @update:model-value="(unit) => pickUnit(line, unit)" /></UFormField>
            <UFormField label="الكمية"><UInputNumber v-model="line.quantity" :min="0.001" :step="1" class="w-full" /></UFormField>
            <UFormField label="تكلفة الوحدة المحددة"><UInputNumber v-model="line.unit_cost" :min="0" :step="0.01" class="w-full" /></UFormField>
            <UFormField label="تأثير سعر البيع"><USelect :model-value="line.priceMode" :items="priceModeItems" value-key="value" label-key="label" class="w-full" @update:model-value="(mode) => setPriceMode(line, mode)" /></UFormField>
            <div class="col-span-full rounded-lg bg-amber-50 p-2 text-xs text-gray-700">سعر البيع الحالي: <b>{{ formatePrice(line.product.price) }} ج</b> · متوسط التكلفة المتوقع: <b>{{ formatePrice(previewLine(line).avg) }} ج</b> · السعر المقترح: <b>{{ previewLine(line).proposed === null ? 'أدخل سعرًا يدويًا' : `${formatePrice(previewLine(line).proposed)} ج` }}</b></div>
            <UFormField v-if="line.priceMode === 'proposed' && previewLine(line).proposed !== null" label="السعر المقترح (قابل للتعديل)"><UInputNumber v-model="line.approvedProposal" :min="0" :step="0.01" class="w-full" /></UFormField>
            <UFormField v-if="line.priceMode === 'custom'" label="سعر البيع المخصص"><UInputNumber v-model="line.customPrice" :min="0" :step="0.01" class="w-full" /></UFormField>
            <UAlert v-if="line.priceMode === 'proposed' && previewLine(line).proposed === null" class="col-span-full" color="warning" variant="soft" title="لا يمكن اشتقاق هامش ربح قديم لهذا المنتج؛ اختر سعرًا مخصصًا." />
            <div class="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">الكمية الأساسية: <b>{{ (line.quantity || 0) * (line.unit_factor || 1) }}</b> {{ line.product.base_unit_name || 'وحدة' }}<br>إجمالي السطر: <b>{{ formatePrice((line.quantity || 0) * (line.unit_cost || 0)) }} ج</b></div>
          </div>
        </div>
        <UButton color="neutral" variant="soft" icon="i-lucide-plus" @click="addDraftLine()">إضافة صنف</UButton>
        <div class="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 text-sm"><span>إجمالي الفاتورة</span><b class="text-end">{{ formatePrice(draftTotal) }} ج</b><span>رصيد الخزنة</span><b class="text-end">{{ formatePrice(cashbox.balance) }} ج</b><span>المدفوع الآن</span><UInputNumber v-model="paidNow" :min="0" :max="draftTotal" :step="0.01" class="w-full" /><span>المتبقي للمورد</span><b class="text-end text-red-600">{{ formatePrice(Math.max(0, draftTotal - (paidNow || 0))) }} ج</b></div>
        <UAlert v-if="draftError" color="error" variant="soft" :title="draftError" />
      </div>
      <template #footer><div class="flex w-full gap-2"><UButton color="success" class="flex-1" icon="i-lucide-check" :loading="savingDraft" :disabled="!draftReady" @click="confirmDraft">تأكيد وحفظ الفاتورة</UButton><UButton color="neutral" variant="soft" class="flex-1" :disabled="savingDraft" @click="draftOpen = false">إلغاء</UButton></div></template>
    </UiAppDialog>

    <UiAppDialog v-model:open="detailsOpen" :title="`فاتورة ${selectedInvoice?.supplier_name || 'المورد'}`">
      <div v-if="selectedInvoice" class="space-y-3"><div class="grid grid-cols-2 gap-2 text-sm"><span>الرقم</span><b>{{ selectedInvoice.invoice_number || selectedInvoice.supplier_ref || selectedInvoice.id }}</b><span>التاريخ</span><b>{{ formatDateOnly(selectedInvoice.created_at) }}</b><span>الإجمالي</span><b>{{ formatePrice(selectedInvoice.total_amount) }} ج</b><span>المدفوع</span><b>{{ formatePrice(selectedInvoice.paid_amount) }} ج</b><span>الباقي</span><b class="text-red-600">{{ formatePrice(selectedInvoice.remaining_amount) }} ج</b></div><div class="max-h-[40vh] space-y-2 overflow-y-auto"><UCard v-for="(item, index) in selectedInvoice.items" :key="`${item.product_id}-${index}`" variant="outline"><div class="flex justify-between gap-2 text-sm"><b>{{ item.product_name }}</b><span>{{ item.quantity }} {{ item.unit_name || 'وحدة' }}</span></div><div class="mt-1 flex justify-between text-xs text-gray-500"><span>{{ formatePrice(item.unit_cost) }} ج / وحدة</span><b>{{ formatePrice(item.line_total) }} ج</b></div></UCard></div><div class="no-print flex flex-wrap gap-2"><UButton color="neutral" variant="soft" icon="i-lucide-printer" @click="printInvoice">طباعة الفاتورة</UButton><UButton color="neutral" variant="soft" icon="i-lucide-history" :disabled="!selectedInvoice.payment_ids?.length" @click="loadPayments(selectedInvoice)">سجل السداد</UButton></div></div>
    </UiAppDialog>
    <UiAppDialog v-model:open="paymentOpen" :title="`سداد فاتورة ${paymentTarget?.supplier_name || 'المورد'}`">
      <div v-if="paymentTarget" class="space-y-3"><div class="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm"><span>الباقي</span><b>{{ formatePrice(paymentTarget.remaining_amount) }} ج</b><span>رصيد الخزنة</span><b>{{ formatePrice(cashbox.balance) }} ج</b></div><UFormField label="مبلغ الدفعة" :error="paymentError || undefined"><UInputNumber v-model="paymentAmount" :min="0" :max="Math.min(paymentTarget.remaining_amount, cashbox.balance)" :step="0.01" class="w-full" /></UFormField><UFormField label="ملاحظة"><UInput v-model="paymentNote" class="w-full" /></UFormField><UAlert v-if="paymentError" color="warning" variant="soft" :title="paymentError" /></div>
      <template #footer><div class="flex w-full gap-2"><UButton color="success" class="flex-1" :loading="paying" :disabled="!!paymentError" @click="submitPayment">تأكيد السداد</UButton><UButton color="neutral" variant="soft" class="flex-1" :disabled="paying" @click="paymentOpen = false">إلغاء</UButton></div></template>
    </UiAppDialog>
    <UiAppDialog v-model:open="paymentsOpen" title="سجل سداد المورد"><div class="max-h-[60vh] space-y-2 overflow-y-auto"><UCard v-for="payment in payments" :key="payment.id" variant="outline"><div class="flex justify-between"><span>{{ formatDateOnly(payment.created_at) }}</span><b>{{ formatePrice(payment.amount) }} ج</b></div><p v-if="payment.note" class="text-xs text-gray-500">{{ payment.note }}</p></UCard><UEmpty v-if="!payments.length" icon="i-lucide-history" title="لا توجد دفعات مسجلة" /></div></UiAppDialog>
    <div v-if="selectedInvoice" class="print-sheet" dir="rtl"><h1>فاتورة مورد</h1><p>{{ selectedInvoice.supplier_name }} · {{ selectedInvoice.invoice_number || selectedInvoice.supplier_ref || '' }}</p><p>{{ formatDateOnly(selectedInvoice.created_at) }}</p><table><thead><tr><th>المنتج</th><th>الوحدة</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead><tbody><tr v-for="(item, index) in selectedInvoice.items" :key="`${item.product_id}-print-${index}`"><td>{{ item.product_name }}</td><td>{{ item.unit_name || 'وحدة' }}</td><td>{{ item.quantity }}</td><td>{{ formatePrice(item.unit_cost) }}</td><td>{{ formatePrice(item.line_total) }}</td></tr></tbody></table><p>الإجمالي: {{ formatePrice(selectedInvoice.total_amount) }} ج</p><p>المدفوع: {{ formatePrice(selectedInvoice.paid_amount) }} ج · الباقي: {{ formatePrice(selectedInvoice.remaining_amount) }} ج</p></div>
  </div>
</template>

<script setup lang="ts">
import type { Product, ProductUnit } from "~/types";
import type { PurchaseInvoice, PurchaseInvoiceItem, Supplier, SupplierPayment } from "~/types/finance";
import { supplierInvoiceStatus } from "~/types/finance";
import { proposedSellingPrice, round2, toNum, unitsForProduct } from "~/composables/finance";
import { toDateSafe } from "~/types";
import { useSuppliersStore } from "~/stores/suppliers";

interface DraftLine { key: string; product?: Product; unit_id: string; unit_name: string; unit_factor: number; quantity: number; unit_cost: number; priceMode: "keep" | "proposed" | "custom"; approvedProposal?: number | null; customPrice?: number }
definePageMeta({ title: "فواتير الموردين" });
const { formatePrice } = useHelpers();
const { notify } = useAppToast();
const route = useRoute();
const productsStore = useProductsStore();
const suppliers = useSuppliersStore();
const purchasing = usePurchasing();
const cashbox = useCashbox();
const invoices = ref<PurchaseInvoice[]>([]);
const loading = ref(true);
const search = ref("");
const statusFilter = ref("all");
const draftOpen = ref(false);
const draftSource = ref<PurchaseInvoice | null>(null);
const draftLines = ref<DraftLine[]>([]);
const draftSupplier = ref<Supplier | undefined>();
const supplierName = ref("");
const supplierRef = ref("");
const paidNow = ref<number | undefined>(0);
const savingDraft = ref(false);
const draftError = ref("");
const requestKey = ref("");
const priceModeItems = [{ label: "الإبقاء على السعر الحالي", value: "keep" }, { label: "اعتماد السعر المقترح", value: "proposed" }, { label: "سعر مخصص", value: "custom" }];
const draftTotal = computed(() => round2(draftLines.value.reduce((sum, line) => sum + toNum(line.quantity) * toNum(line.unit_cost), 0)));
const draftReady = computed(() => !savingDraft.value && !!(draftSupplier.value?.id || (draftSource.value && supplierName.value.trim())) && draftLines.value.length > 0 && draftLines.value.every((line) => line.product?.id && line.quantity > 0 && line.unit_cost >= 0 && (!pricePolicyApplies(line) || line.priceMode !== "keep") && (line.priceMode !== "proposed" || previewLine(line).proposed !== null && Number(line.approvedProposal) >= 0) && (line.priceMode !== "custom" || Number(line.customPrice) >= 0)) && toNum(paidNow.value) >= 0 && toNum(paidNow.value) <= draftTotal.value && toNum(paidNow.value) <= cashbox.balance);
const draftMessage = computed(() => draftError.value);
const visibleInvoices = computed(() => invoices.value.filter((invoice) => {
  const query = search.value.trim().toLocaleLowerCase();
  const matchesSearch = !query || `${invoice.supplier_name ?? ""} ${invoice.invoice_number ?? ""} ${invoice.supplier_ref ?? ""}`.toLocaleLowerCase().includes(query);
  const matchesSupplier = !route.query.supplier || invoice.supplier_id === String(route.query.supplier);
  const status = supplierInvoiceStatus(invoice);
  return matchesSearch && matchesSupplier && (statusFilter.value === "all" || status === statusFilter.value);
}));
const totalPurchases = computed(() => round2(visibleInvoices.value.reduce((sum, invoice) => sum + toNum(invoice.total_amount), 0)));
const totalPayable = computed(() => round2(visibleInvoices.value.reduce((sum, invoice) => sum + toNum(invoice.remaining_amount), 0)));
const detailsOpen = ref(false);
const selectedInvoice = ref<PurchaseInvoice | null>(null);
const paymentOpen = ref(false);
const paymentTarget = ref<PurchaseInvoice | null>(null);
const paymentAmount = ref<number | undefined>();
const paymentNote = ref("");
const paymentKey = ref("");
const paying = ref(false);
const paymentsOpen = ref(false);
const payments = ref<SupplierPayment[]>([]);
const paymentError = computed(() => {
  if (!paymentTarget.value || !(Number(paymentAmount.value) > 0)) return "أدخل مبلغًا أكبر من صفر.";
  if (Number(paymentAmount.value) > paymentTarget.value.remaining_amount) return "المبلغ يتجاوز باقي الفاتورة.";
  if (Number(paymentAmount.value) > cashbox.balance) return "المبلغ يتجاوز رصيد الخزنة.";
  return "";
});
function id(): string { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function statusLabel(invoice: PurchaseInvoice): string { return { paid: "مسددة", partial: "مسددة جزئيًا", unpaid: "غير مسددة" }[supplierInvoiceStatus(invoice)]; }
function statusColor(invoice: PurchaseInvoice): "success" | "warning" | "error" { return supplierInvoiceStatus(invoice) === "paid" ? "success" : supplierInvoiceStatus(invoice) === "partial" ? "warning" : "error"; }
function sourceLabel(source?: string): string { return source === "excel_import" ? "استيراد Excel" : source === "repeat" ? "من فاتورة سابقة" : "يدوية"; }
function formatDateOnly(value: unknown): string { const date = toDateSafe(value); return date?.toLocaleDateString("ar-EG") ?? "—"; }
function unitOptions(line: DraftLine): ProductUnit[] { return line.product ? unitsForProduct(line.product) : []; }
function selectedUnit(line: DraftLine): ProductUnit | undefined { return unitOptions(line).find((unit) => unit.id === line.unit_id) ?? unitOptions(line)[0]; }
function newLine(): DraftLine { return { key: id(), unit_id: "", unit_name: "", unit_factor: 1, quantity: 1, unit_cost: 0, priceMode: "keep" }; }
function addDraftLine(): void { draftLines.value.push(newLine()); }
function productOptions(line: DraftLine): Product[] { return productsStore.list.filter((product) => !draftLines.value.some((other) => other !== line && other.product?.id === product.id)); }
function pickUnit(line: DraftLine, unit?: ProductUnit): void { if (!unit) return; line.unit_id = unit.id; line.unit_name = unit.name; line.unit_factor = unit.factor; }
function pickProduct(line: DraftLine, product?: Product): void {
  if (!product) { line.product = undefined; return; }
  line.product = product;
  const base = unitsForProduct(product).find((unit) => unit.is_base) ?? unitsForProduct(product)[0]!;
  line.unit_id = base.id; line.unit_name = base.name; line.unit_factor = base.factor;
  line.unit_cost = toNum(product.cost_price);
  line.approvedProposal = previewLine(line).proposed;
}
function openUnitFromSnapshot(productId: string, name: string, unitId?: string | null, unitName?: string | null, factor?: number | null): DraftLine {
  const line = newLine();
  line.product = productsStore.list.find((product) => product.id === productId);
  line.unit_id = unitId || line.product?.base_unit_id || "legacy-base";
  line.unit_name = unitName || line.product?.base_unit_name || "وحدة";
  line.unit_factor = Number(factor) > 0 ? Number(factor) : 1;
  return line;
}
function startDraft(source?: PurchaseInvoice): void {
  draftSource.value = source ?? null;
  const querySupplierId = !source && route.query.supplier ? String(route.query.supplier) : null;
  draftSupplier.value = source?.supplier_id
    ? suppliers.list.find((supplier) => supplier.id === source.supplier_id)
    : querySupplierId
      ? suppliers.list.find((supplier) => supplier.id === querySupplierId)
      : undefined;
  supplierName.value = source?.supplier_name ?? "";
  supplierRef.value = "";
  draftLines.value = source?.items?.length ? source.items.map((item: PurchaseInvoiceItem) => {
    const line = openUnitFromSnapshot(item.product_id, item.product_name, item.unit_id, item.unit_name, item.unit_factor);
    line.quantity = item.quantity; line.unit_cost = item.unit_cost; return line;
  }) : [newLine()];
  paidNow.value = 0;
  draftError.value = "";
  requestKey.value = id();
  void cashbox.fetchCashbox();
  draftOpen.value = true;
}
function priceDecision(line: DraftLine): { mode: "keep" } | { mode: "proposed"; approvedProposed: number; price?: number } | { mode: "custom"; price: number; approvedProposed?: number | null } {
  const proposal = previewLine(line).proposed;
  if (line.priceMode === "custom") return { mode: "custom", price: toNum(line.customPrice), approvedProposed: proposal };
  if (!line.product || line.priceMode === "keep") return { mode: "keep" };
  return proposal === null ? { mode: "keep" } : { mode: "proposed", approvedProposed: proposal, price: toNum(line.approvedProposal ?? proposal) };
}
function previewLine(line: DraftLine): { avg: number; proposed: number | null } {
  if (!line.product) return { avg: 0, proposed: null };
  const stock = toNum(line.product.stock_quantity);
  const added = toNum(line.quantity) * Number(line.unit_factor || 1);
  const baseCost = toNum(line.unit_cost) / Number(line.unit_factor || 1);
  const avg = stock <= 0 ? baseCost : (stock * toNum(line.product.cost_price) + added * baseCost) / (stock + added);
  return { avg: round2(avg), proposed: proposedSellingPrice(line.product.cost_price, line.product.price, avg).proposed };
}
function pricePolicyApplies(line: DraftLine): boolean { return !!line.product && previewLine(line).avg - toNum(line.product.price) > 1e-9; }
function setPriceMode(line: DraftLine, mode: string): void {
  if (mode !== "keep" && mode !== "proposed" && mode !== "custom") return;
  line.priceMode = mode;
  line.approvedProposal = previewLine(line).proposed;
}
watch(() => draftLines.value.map((line) => `${line.key}:${line.quantity}:${line.unit_cost}:${line.unit_factor}:${line.product?.stock_quantity}:${line.product?.cost_price}:${line.product?.price}`).join("|"), () => {
  for (const line of draftLines.value) line.approvedProposal = previewLine(line).proposed;
});
async function confirmDraft(): Promise<void> {
  if (!draftReady.value || savingDraft.value) return;
  savingDraft.value = true;
  draftError.value = "";
  try {
    const result = await purchasing.executePurchase({ idempotencyKey: requestKey.value, supplier_id: draftSupplier.value?.id ?? null, supplier_name: draftSupplier.value?.name ?? supplierName.value.trim(), supplier_ref: supplierRef.value.trim() || null, source: draftSource.value ? "repeat" : "manual", items: draftLines.value.map((line) => ({ product_id: line.product?.id, quantity: line.quantity, unit_cost: line.unit_cost, unit_id: line.unit_id, unit_name: line.unit_name, unit_factor: line.unit_factor, pricing: priceDecision(line) })), paidNow: toNum(paidNow.value) });
    if (!result.ok) { draftError.value = result.error || "تعذر حفظ الفاتورة."; return; }
    notify(result.remaining ? `فاتورة الشراء سُجلت، والمتبقي للمورد ${formatePrice(result.remaining)} ج.` : "تم تسجيل فاتورة الشراء مدفوعة بالكامل.", "success");
    draftOpen.value = false;
    await reload();
  } finally { savingDraft.value = false; }
}
function openDetails(invoice: PurchaseInvoice): void { selectedInvoice.value = invoice; detailsOpen.value = true; }
function printInvoice(): void { if (import.meta.client) window.print(); }
async function togglePin(invoice: PurchaseInvoice): Promise<void> { if (!invoice.id) return; await purchasing.setPurchaseInvoicePinned(invoice.id, !invoice.pinned); await reload(); }
function openPayment(invoice: PurchaseInvoice): void { paymentTarget.value = invoice; paymentAmount.value = undefined; paymentNote.value = ""; paymentKey.value = id(); void cashbox.fetchCashbox(); paymentOpen.value = true; }
async function submitPayment(): Promise<void> { if (!paymentTarget.value?.id || paymentError.value || paying.value) return; paying.value = true; try { const result = await purchasing.paySupplierInvoice(paymentTarget.value.id, Number(paymentAmount.value), paymentNote.value.trim() || null, paymentKey.value); if (!result.ok) { notify(result.error, "error"); return; } notify(result.remaining ? `تم تسجيل السداد، والمتبقي ${formatePrice(result.remaining)} ج.` : "تم سداد فاتورة المورد بالكامل.", "success"); paymentOpen.value = false; await reload(); } finally { paying.value = false; } }
async function loadPayments(invoice: PurchaseInvoice): Promise<void> { if (!invoice.id) return; paymentsOpen.value = true; payments.value = await purchasing.fetchSupplierPayments(invoice.id); }
async function reload(): Promise<void> { loading.value = true; try { const [items] = await Promise.all([purchasing.fetchPurchaseInvoices(), productsStore.fetchProducts(), suppliers.fetchSuppliers(), cashbox.fetchCashbox()]); invoices.value = items.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)); } finally { loading.value = false; } }
onMounted(async () => { await reload(); if (route.query.new === "1") startDraft(); else if (route.query.invoice) { const target = invoices.value.find((invoice) => invoice.id === String(route.query.invoice)); if (target) openDetails(target); } });
</script>

<style scoped>
.print-sheet { display: none; }
@media print {
  body * { visibility: hidden !important; }
  .print-sheet, .print-sheet * { visibility: visible !important; }
  .print-sheet { display: block !important; position: fixed; inset: 0; padding: 24px; color: #111827; background: #fff; }
  .print-sheet table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  .print-sheet th, .print-sheet td { border: 1px solid #d1d5db; padding: 8px; text-align: right; }
}
</style>
