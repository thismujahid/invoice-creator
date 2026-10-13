<template>
  <div class="invoice-creator-view" dir="rtl">
    <UCard variant="outline" class="w-full">
      <UAlert v-if="editId" color="warning" variant="soft" title="تعديل فاتورة سابقة" class="mb-3" />
      <UAlert v-if="shortageCount > 0" color="warning" variant="soft" icon="i-lucide-triangle-alert" :title="'تنبيه: ' + shortageCount + ' وحدة قليلة الكمية بالمخزون'" class="mb-3" />
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UFormField label="اسم العميل" required class="min-w-0">
          <USelectMenu v-model="customer" :items="customers.list" label-key="name" by="id" v-model:search-term="customerSearch" :search-input="{ placeholder: 'بحث عن عميل...', icon: 'i-lucide-search' }" :loading="loading" placeholder="اسم العميل" size="lg" class="w-full" />
        </UFormField>
        <div class="flex items-end"><FormsCustomer v-model="customerOpen" :refresher="refreshCustomers" @done="onCustomerCreated"><UButton icon="i-lucide-user-plus" color="success" variant="soft" size="lg">إضافة عميل</UButton></FormsCustomer></div>
      </div>
      <div class="mb-2 mt-4 flex items-center justify-between border-t border-gray-100 pt-3"><p class="text-xs font-bold text-gray-400">المنتجات ({{ lines.length }})</p><UButton size="sm" icon="i-lucide-plus" color="success" variant="soft" @click="addLine">إضافة منتج آخر</UButton></div>
      <UiAppTableSkeleton v-if="loading" />
      <div v-else class="max-h-[55vh] space-y-3 overflow-y-auto p-0.5">
        <div v-for="(line, index) in lines" :key="line.key" class="rounded-lg border border-gray-200 p-3">
          <div v-if="line.productId && !line.expanded" class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate text-sm font-bold text-gray-900">{{ formatInvoiceLineName(productOf(line)?.name || '', unitOf(line)?.name, line.option) }}</div>
              <div class="mt-0.5 text-[11px] text-gray-400">المتبقي بعد الفاتورة: {{ stockLabelOf(line) }}</div>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-minus" aria-label="تقليل الكمية" @click="changeQuantity(line, -1)" />
                <UInput :model-value="String(line.quantity)" inputmode="decimal" aria-label="الكمية" size="xs" class="w-20" @update:model-value="(value) => setQuantity(line, value)" />
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" aria-label="زيادة الكمية" @click="changeQuantity(line, 1)" />
                <span>×</span><span dir="ltr">{{ formatePrice(priceOf(line)) }}</span><span>=</span><strong class="text-gray-800">{{ formatePrice(lineTotal(line)) }}</strong>
              </div>
              <p v-if="stockErrorOf(line)" class="mt-1 text-xs font-semibold text-red-600">{{ stockErrorOf(line) }}</p>
            </div>
            <div class="flex shrink-0 gap-1.5"><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-pencil" @click="line.expanded = true">تعديل</UButton><UButton v-if="lines.length > 1" size="sm" color="error" variant="soft" icon="i-lucide-trash-2" @click="removeLine(index)">حذف</UButton></div>
          </div>
          <div v-else>
            <div class="mb-2 flex items-center justify-between"><span class="text-xs font-bold text-gray-400">{{ line.productId ? formatInvoiceLineName(productOf(line)?.name || '', unitOf(line)?.name, line.option) : 'منتج #' + (index + 1) }}</span><div class="flex gap-1.5"><UButton v-if="line.productId" size="sm" color="success" variant="soft" icon="i-lucide-chevron-up" @click="line.expanded = false">إغلاق</UButton><UButton v-if="lines.length > 1" size="xs" color="error" variant="soft" icon="i-lucide-trash-2" aria-label="حذف السطر" @click="removeLine(index)" /></div></div>
            <div class="grid grid-cols-2 gap-2">
              <UFormField label="المنتج" class="col-span-2"><USelectMenu :model-value="productOf(line)" :items="products.activeProducts" label-key="name" by="id" :search-input="{ placeholder: 'بحث عن منتج...', icon: 'i-lucide-search' }" placeholder="المنتج" class="w-full" @update:model-value="(value) => selectProduct(line, value)" /></UFormField>
              <UFormField label="خيار معين"><UInput v-model="line.option" placeholder="خيار معين" class="w-full" /></UFormField>
              <UFormField v-if="unitsOf(line).length > 1" label="الوحدة"><USelectMenu :model-value="unitOf(line)" :items="unitsOf(line)" label-key="name" by="id" :search-input="false" class="w-full" @update:model-value="(value) => selectUnit(line, value)" /></UFormField>
              <UFormField :label="line.productId ? 'الكمية (المتبقي بعد الفاتورة: ' + stockLabelOf(line) + ')' : 'الكمية'" :error="stockErrorOf(line) || undefined"><UInputNumber v-model="line.quantity" :min="0.01" :step="0.01" class="w-full" /></UFormField>
              <UFormField label="سعر المنتج"><UInput :model-value="priceOf(line) === null ? 'غير محدد' : formatePrice(priceOf(line))" readonly class="w-full" /></UFormField>
              <UFormField label="الإجمالي"><UInput :model-value="formatePrice(lineTotal(line))" readonly class="w-full" /></UFormField>
            </div>
          </div>
        </div>
      </div>
      <UAlert v-if="products.syncError" color="error" variant="soft" title="تعذر تحميل المنتجات" class="mb-2"><template #actions><UButton size="xs" @click="refreshProducts">إعادة المحاولة</UButton></template></UAlert>
      <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" class="mb-2"><template #actions><UButton size="xs" @click="loadData">إعادة المحاولة</UButton></template></UAlert>
      <div class="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2">
        <UFormField :label="`الخصم (${discountPercentage ? 'نسبة مئوية' : 'مبلغ ثابت'})`" :error="discountError || undefined">
          <UInput :model-value="discount == null ? '' : String(discount)" type="number" inputmode="decimal" :min="0" :max="discountPercentage ? 100 : gross" step="0.01" placeholder="الخصم" class="w-full" @update:model-value="setDiscount">
            <template #trailing><UTooltip text="نوع الخصم"><UButton :icon="discountPercentage ? 'i-lucide-percent' : 'i-lucide-banknote'" color="neutral" variant="ghost" aria-label="نوع الخصم" @click="discountPercentage = !discountPercentage" /></UTooltip></template>
          </UInput>
        </UFormField>
        <UFormField label="الخصم متعلق بـ"><UInput v-model="discountFor" placeholder="اختياري" class="w-full" /></UFormField>
      </div>
      <div v-if="invoiceExtras" class="mt-2 text-sm text-gray-600">مبالغ أخرى محفوظة بالفاتورة: {{ formatePrice(invoiceExtras) }} ج</div>
      <div v-if="customer?.id && !editId" class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
        <div class="flex justify-between gap-2"><span>رصيد العميل المتاح</span><strong>{{ creditLoading ? 'جار التحميل...' : `${formatePrice(creditBalance)} ج` }}</strong></div>
        <UFormField v-if="creditBalance" label="استخدام من رصيد العميل" class="mt-2"><UInputNumber v-model="creditUsed" :min="0" :max="Math.min(creditBalance, total)" :step="0.01" class="w-full" /></UFormField>
        <p class="mt-1 text-xs text-emerald-800">يُستخدم كسداد، ولا يُخصم من قيمة المبيعات.</p>
      </div>
      <div class="mt-4 border-t border-gray-100 pt-3">
        <UFormField label="النقد المدفوع">
          <UInput :model-value="String(paid ?? '')" type="number" inputmode="decimal" :min="0" step="0.01" class="w-full" @update:model-value="setPaid">
            <template #trailing><UTooltip text="تم السداد بالكامل"><UButton icon="i-lucide-check" color="success" variant="ghost" size="xs" aria-label="تم السداد بالكامل" @click="payFull" /></UTooltip></template>
          </UInput>
          <template #hint><span class="text-xs text-gray-500">المتبقي: {{ formatePrice(Math.max(0, total - (paid ?? 0) - creditUsed)) }}</span></template>
        </UFormField>
      </div>
      <UAlert v-if="error" color="error" variant="soft" :title="error" class="mt-3" />
    </UCard>

    <div class="fixed inset-x-0 bottom-0 z-30 mb-[calc(3.5rem+env(safe-area-inset-bottom))] border-t border-gray-200 bg-white/95 backdrop-blur sm:mb-0">
      <div class="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-2 sm:px-4">
        <div class="min-w-0 flex-1 text-start leading-tight"><div class="truncate text-xs text-gray-500">الإجمالي</div><div class="truncate text-lg font-bold tabular-nums text-gray-900">{{ formatePrice(total) }}</div></div>
        <UButton icon="i-lucide-save" color="success" size="lg" class="min-h-11 min-w-11 justify-center" :loading="saving" :disabled="saving" :aria-label="editId ? 'حفظ التعديل' : 'حفظ وفاتورة جديدة'" @click="save(false)"><span class="hidden sm:inline">{{ editId ? 'حفظ التعديل' : 'حفظ وجديد' }}</span></UButton>
        <UButton icon="i-lucide-printer" color="neutral" variant="soft" size="lg" class="min-h-11 min-w-11 justify-center" :disabled="saving" aria-label="حفظ وطباعة" @click="save(true)"><span class="hidden sm:inline">حفظ وطباعة</span></UButton>
        <UButton icon="i-lucide-eye" color="neutral" variant="soft" size="lg" class="min-h-11 min-w-11 justify-center" :disabled="saving" aria-label="معاينة الفاتورة" @click="previewOpen = true"><span class="hidden sm:inline">معاينة</span></UButton>
        <UButton icon="i-lucide-rotate-ccw" color="error" variant="soft" size="lg" class="min-h-11 min-w-11 justify-center" :disabled="saving" aria-label="تصفير الفاتورة" @click="reset"><span class="hidden sm:inline">تصفير</span></UButton>
      </div>
      <div class="h-[env(safe-area-inset-bottom)] sm:hidden" />
    </div>
    <div aria-hidden="true" class="h-24" />
    <UiAppDialog v-model:open="previewOpen" title="معاينة الفاتورة"><Invoice :invoice-data="previewInvoice" view-mode @close="previewOpen = false" /></UiAppDialog>
    <UiAppDialog v-model:open="receiptOpen" title="تم حفظ الفاتورة">
      <Invoice v-if="savedInvoice" ref="receiptRef" :invoice-data="savedInvoice" view-mode @close="receiptOpen = false" />
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Customer, Invoice, Product, ProductUnit } from "~/types";

interface SaleLine { key: string; productId: string; unitId: string; quantity: number; option: string; expanded: boolean; lineId?: string; lockedPrice?: number }
const customers = useCustomersStore();
const products = useProductsStore();
const invoices = useInvoicesStore();
const { formatePrice, formatInvoiceLineName } = useHelpers();
const { sellableUnitsForProduct, stockQuantityLabel, round2 } = useFinance();
const { notify } = useAppToast();
const customer = ref<Customer>();
const customerSearch = ref("");
const customerOpen = ref(false);
const loading = ref(true);
const loadError = ref("");
const saving = ref(false);
const error = ref("");
const paid = ref<number>(0);
const paidTouched = ref(false);
const discount = ref<number | null>(null);
const discountPercentage = ref(false);
const discountFor = ref("");
const creditBalance = ref(0);
const creditUsed = ref(0);
const creditLoading = ref(false);
let creditRequest = 0;
const editId = ref<string | null>(null);
const editRevision = ref<string | null>(null);
const originalExtras = ref({ debt: 0, delivery: 0, feeds: 0, mahros: 0 });
const lines = ref<SaleLine[]>([]);
const originalReserved = new Map<string, number>();
const savedInvoice = ref<Invoice | null>(null);
const receiptOpen = ref(false);
const previewOpen = ref(false);
const receiptRef = ref<{ startPrint: () => Promise<unknown> } | null>(null);
const requestId = ref(crypto.randomUUID());
const shortageCount = computed(() => products.shortageUnitCount);

function addLine(): void { lines.value.push({ key: crypto.randomUUID(), productId: "", unitId: "", quantity: 1, option: "", expanded: true }); }
function removeLine(index: number): void { lines.value.splice(index, 1); if (!lines.value.length) addLine(); }
function productOf(line: SaleLine): Product | undefined { return products.productsById.get(line.productId); }
function unitsOf(line: SaleLine): ProductUnit[] { const product = productOf(line); return product ? sellableUnitsForProduct(product).filter((unit) => unit.selling_price !== null && unit.selling_price !== undefined) : []; }
function unitOf(line: SaleLine): ProductUnit | undefined { return unitsOf(line).find((unit) => unit.id === line.unitId); }
function priceOf(line: SaleLine): number | null { return line.lockedPrice ?? unitOf(line)?.selling_price ?? null; }
function lineTotal(line: SaleLine): number { return round2((priceOf(line) ?? 0) * line.quantity); }
function stockLabelOf(line: SaleLine): string {
  const product = productOf(line);
  if (!product) return "—";
  const selected = lines.value.reduce((sum, item) => item.productId === line.productId ? sum + item.quantity * Number(unitOf(item)?.factor || 1) : sum, 0);
  return stockQuantityLabel(product, Math.max(0, round2(availableStock(line.productId) - selected)));
}
function availableStock(productId: string): number {
  return round2(Number(products.productsById.get(productId)?.stock_quantity || 0) + (originalReserved.get(productId) || 0));
}
const stockErrors = computed(() => {
  const selected = new Map<string, number>();
  for (const line of lines.value) {
    if (!line.productId || !unitOf(line)) continue;
    selected.set(line.productId, round2((selected.get(line.productId) || 0) + line.quantity * Number(unitOf(line)!.factor || 1)));
  }
  const errors = new Map<string, string>();
  for (const [productId, quantity] of selected) {
    const available = availableStock(productId);
    if (quantity - available > 1e-9) errors.set(productId, `إجمالي المطلوب ${stockQuantityLabel(products.productsById.get(productId)!, quantity)} يتجاوز المتاح ${stockQuantityLabel(products.productsById.get(productId)!, available)}.`);
  }
  return errors;
});
function stockErrorOf(line: SaleLine): string { return stockErrors.value.get(line.productId) || ""; }
const subtotal = computed(() => round2(lines.value.reduce((sum, line) => sum + lineTotal(line), 0)));
const invoiceExtras = computed(() => round2(Object.values(originalExtras.value).reduce((sum, value) => sum + value, 0)));
const gross = computed(() => round2(subtotal.value + invoiceExtras.value));
const discountValue = computed(() => discountPercentage.value ? round2(gross.value * (discount.value ?? 0) / 100) : round2(discount.value ?? 0));
const discountError = computed(() => discount.value != null && (!Number.isFinite(discount.value) || discount.value < 0 || (discountPercentage.value ? discount.value > 100 : discount.value > gross.value)) ? "الخصم يتجاوز الحد المسموح." : "");
const total = computed(() => round2(gross.value - discountValue.value));
watch(total, (value) => { if (creditUsed.value > value) creditUsed.value = Math.max(0, value); });
const previewInvoice = computed<Invoice>(() => ({
  customer_name: customer.value?.name ?? null,
  customer_phone: customer.value?.phone ?? null,
  products: lines.value.filter((line) => productOf(line) && unitOf(line)).map((line) => ({
    product_id: line.productId,
    product_name: productOf(line)!.name,
    product_quantity: line.quantity,
    product_price: priceOf(line) ?? 0,
    unit_name: unitOf(line)!.name,
    option: line.option,
  })),
  paid_amount: round2(paid.value + creditUsed.value),
  credit_used: creditUsed.value,
  discount: discount.value,
  discount_percentage: discountPercentage.value,
  discount_for: discountFor.value.trim() || null,
  debt: originalExtras.value.debt,
  delivery_price: originalExtras.value.delivery,
  amount_of_animal_feeds: originalExtras.value.feeds,
  amount_of_mahros: originalExtras.value.mahros,
  date: new Date(),
  time: new Date(),
}));
watch([total, creditUsed], () => { if (!paidTouched.value) paid.value = Math.max(0, round2(total.value - creditUsed.value)); });
watch(() => customer.value?.id, async (id) => {
  const request = ++creditRequest;
  creditBalance.value = 0;
  creditUsed.value = 0;
  if (!id || editId.value) return;
  creditLoading.value = true;
  try {
    const result = await callStaff<{ customerId: string }, { balance: number }>("getCustomerCredit", { customerId: id });
    if (request === creditRequest) creditBalance.value = result.balance;
  } catch { if (request === creditRequest) loadError.value = "تعذر تحميل رصيد العميل."; }
  finally { if (request === creditRequest) creditLoading.value = false; }
});
function selectProduct(line: SaleLine, product: Product | null | undefined): void {
  line.productId = product?.id ?? "";
  line.unitId = product ? (sellableUnitsForProduct(product).find((unit) => unit.selling_price !== null)?.id ?? "") : "";
  line.lineId = undefined;
  line.lockedPrice = undefined;
  line.expanded = !line.unitId;
}
function selectUnit(line: SaleLine, unit: ProductUnit | null | undefined): void { line.unitId = unit?.id ?? ""; line.lockedPrice = undefined; }
function setQuantity(line: SaleLine, value: unknown): void { const quantity = Number(value); line.quantity = Number.isFinite(quantity) ? quantity : 0; }
function changeQuantity(line: SaleLine, delta: number): void { line.quantity = Math.max(0.01, round2(line.quantity + delta)); }
function setPaid(value: unknown): void { paidTouched.value = true; const amount = Number(value); paid.value = Number.isFinite(amount) ? amount : 0; }
function setDiscount(value: unknown): void { discount.value = value === "" || value == null ? null : Number(value); }
function payFull(): void { paid.value = Math.max(0, round2(total.value - creditUsed.value)); paidTouched.value = false; }
async function refreshCustomers(): Promise<void> { await customers.fetchCustomers(undefined, true); }
async function refreshProducts(): Promise<void> { await products.fetchProducts(undefined, true); }
async function loadData(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  const results = await Promise.allSettled([refreshCustomers(), refreshProducts()]);
  if (results.some((result) => result.status === "rejected")) loadError.value = "تعذر تحميل العملاء أو المنتجات. حاول مرة أخرى.";
  loading.value = false;
}
function onCustomerCreated(created: Customer): void { customer.value = customers.list.find((item) => item.id === created.id) ?? created; }
function reset(): void { lines.value = []; originalReserved.clear(); paidTouched.value = false; addLine(); paid.value = 0; creditUsed.value = 0; creditBalance.value = 0; discount.value = null; discountPercentage.value = false; discountFor.value = ""; editId.value = null; editRevision.value = null; originalExtras.value = { debt: 0, delivery: 0, feeds: 0, mahros: 0 }; error.value = ""; customer.value = undefined; requestId.value = crypto.randomUUID(); }

async function save(print: boolean): Promise<void> {
  if (saving.value) return;
  error.value = "";
  if (!customer.value?.id || !lines.value.length || lines.value.some((line) => !productOf(line) || !unitOf(line) || !Number.isFinite(line.quantity) || line.quantity <= 0)) { error.value = "اختر العميل والمنتجات والوحدات وأدخل كميات صحيحة."; return; }
  if (stockErrors.value.size) { error.value = "كمية المنتجات المطلوبة تتجاوز المتاح بالمخزون. خفّض الكمية قبل الحفظ."; return; }
  if (discountError.value) { error.value = discountError.value; return; }
  if (!Number.isFinite(paid.value) || paid.value < 0 || !Number.isFinite(creditUsed.value) || creditUsed.value < 0 || creditUsed.value > creditBalance.value || paid.value + creditUsed.value > total.value + 0.005) { error.value = "راجع النقد ورصيد العميل؛ مجموع السداد لا يجوز أن يتجاوز الفاتورة."; return; }
  saving.value = true;
  let receipt: Invoice | null = null;
  try {
    const payload = {
      requestId: requestId.value, customer_id: customer.value.id, paid_amount: paid.value, credit_used: editId.value ? 0 : creditUsed.value,
      discount: discount.value ?? 0, discount_percentage: discountPercentage.value, discount_for: discountFor.value.trim() || null,
      products: lines.value.map((line) => ({ line_id: line.lineId, product_id: line.productId, unit_id: line.unitId, product_quantity: line.quantity, product_price: priceOf(line), option: line.option })),
    };
    if (editId.value) {
      await callStaff("updateStaffInvoice", { ...payload, id: editId.value, edit_revision: editRevision.value });
      receipt = await callStaff<{ id: string }, Invoice>("getCashierInvoice", { id: editId.value });
    } else {
      const result = await callStaff<typeof payload, { id: string; receipt: Invoice }>("createStaffSale", payload);
      receipt = result.receipt;
    }
  } catch {
    error.value = editId.value
      ? "تعذر تعديل الفاتورة. قد تكون الفاتورة أو المخزون تغيرا؛ أعد فتح الفاتورة وحاول مرة أخرى."
      : "تعذر حفظ الفاتورة. قد يكون السعر أو المخزون تغير؛ حدّث المنتجات وحاول مرة أخرى.";
    saving.value = false;
    return;
  }
  const wasEdit = !!editId.value;
  savedInvoice.value = receipt;
  reset();
  notify(wasEdit ? "تم تعديل الفاتورة وتحديث المخزون والخزنة." : "تم حفظ الفاتورة وتحديث المخزون والخزنة.", "success");
  saving.value = false;
  if (print && receipt) {
    receiptOpen.value = true;
    await nextTick();
    void receiptRef.value?.startPrint().catch(() => notify("تم حفظ الفاتورة، لكن تعذرت الطباعة.", "error"));
  }
  void refreshProducts().catch(() => { loadError.value = "تم حفظ الفاتورة، لكن تعذر تحديث المنتجات. أعد المحاولة."; });
}

onMounted(async () => {
  if (!(await useAuthReady())) { loading.value = false; return; }
  addLine();
  await loadData();
  const draft = invoices.invoiceToEdit;
  if (!draft) return;
  invoices.invoiceToEdit = undefined;
  if (draft.id && draft.inventory_applied === true) {
    for (const item of draft.products || []) {
      if (item.product_id) originalReserved.set(item.product_id, round2((originalReserved.get(item.product_id) || 0) + Number(item.base_quantity ?? Number(item.product_quantity) * Number(item.unit_factor || 1))));
    }
  }
  editId.value = draft.id || null;
  editRevision.value = draft.id ? draft.edit_revision ?? null : null;
  customer.value = customers.list.find((item) => item.id === draft.customer_id)
    ?? customers.list.find((item) => item.name === draft.customer_name && String(item.phone ?? "").replace(/\D/g, "") === String(draft.customer_phone ?? "").replace(/\D/g, ""));
  originalExtras.value = draft.id
    ? { debt: Number(draft.debt) || 0, delivery: Number(draft.delivery_price) || 0,
        feeds: Number(draft.amount_of_animal_feeds) || 0, mahros: Number(draft.amount_of_mahros) || 0 }
    : { debt: 0, delivery: 0, feeds: 0, mahros: 0 };
  lines.value = (draft.products ?? []).map((item) => {
    const product = products.productsById.get(item.product_id || "");
    const unit = product ? sellableUnitsForProduct(product).find((entry) => entry.id === (item.unit_id ?? product.base_unit_id ?? "legacy-base")) : undefined;
    return { key: crypto.randomUUID(), productId: product?.id ?? "", unitId: unit?.id ?? "", quantity: Number(item.product_quantity) || 1,
      option: item.option ?? "", expanded: !unit, lineId: draft.id ? item.line_id : undefined,
      lockedPrice: draft.id ? Number(item.product_price) : undefined };
  });
  if (!lines.value.length) addLine();
  discount.value = draft.discount == null ? null : Number(draft.discount);
  discountPercentage.value = draft.discount_percentage === true;
  discountFor.value = draft.discount_for ?? "";
  paid.value = draft.id && draft.paid_amount != null ? Number(draft.paid_amount) : total.value;
  paidTouched.value = !!draft.id;
});
</script>
