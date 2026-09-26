<template>
  <div class="invoice-creator-view" id="editor-area">
    <div class="flex flex-col gap-4 xl:flex-row xl:items-start">
      <UCard variant="outline" class="min-w-0 flex-1">
        <div class="mb-3 flex flex-wrap justify-end gap-2">
          <UButton
            v-if="invoiceData.id"
            color="success"
            icon="i-lucide-refresh-ccw"
            :loading="updating"
            @click="updateInvoiceData"
          >
            تحديث الفاتورة
          </UButton>
          <UButton
            v-if="isAdmin"
            color="success"
            variant="soft"
            :icon="viewCost ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            @click="handleViewCostClick"
            >{{ viewCost ? "إخفاء القيمة" : "عرض القيمة" }}</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            @click="invoiceData.time = new Date()"
            >تحديث الوقت</UButton
          >
          <FormsAuthScreen
            @close="() => (startView = false)"
            @success="(value) => (viewCost = value)"
            v-if="startView && isAdmin"
            success-text="تم عرض القيمة"
            title="برجاء تأكيد هويتك لتتمكن من عرض القيمة"
          />
        </div>
        <UAlert
          v-if="lowStockCount > 0"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="`تنبيه: ${lowStockCount} منتجات قليلة الكمية بالمخزون`"
          :actions="[{ label: 'عرضها في المنتجات', color: 'warning', variant: 'soft', onClick: () => navigateTo('/products') }]"
          class="mb-3"
        />

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <UFormField label="اسم العميل" class="min-w-0">
            <USelectMenu
              :model-value="
                (selectedCustomer() ?? null) as Customer | undefined
              "
              :items="customerMenuItems"
              label-key="name"
              by="id"
              size="lg"
              v-model:search-term="customerSearch"
              :search-input="{
                placeholder: 'بحث عن عميل...',
                icon: 'i-lucide-search',
              }"
              :ignore-filter="true"
              placeholder="اسم العميل"
              :loading="loadingCustomers"
              class="w-full"
              @update:model-value="onPickCustomer"
            />
            <FormsCustomer
              v-model="showCustomerModal"
              :refresher="loadCustomers"
              @done="onPickCustomer"
            />
          </UFormField>
          <UFormField label="رقم هاتف العميل" class="col-span-1">
            <UInput
              :model-value="String(invoiceData.customer_phone ?? '')"
              placeholder="رقم هاتف العميل"
              inputmode="tel"
              dir="ltr"
              class="w-full"
              @update:model-value="(v) => (invoiceData.customer_phone = v)"
            />
          </UFormField>
          <UFormField label="التاريخ">
            <div class="flex gap-1.5">
              <UiAppDateField
                v-model="dateModel"
                @click-trilling=""
                label="التاريخ"
                class="min-w-0 flex-1"
              />
            </div>
          </UFormField>
          <UFormField label="الوقت">
            <UInput v-model="timeInput" type="time" class="w-full" dir="ltr" />
            <template #hint>
              <span class="text-xs text-gray-500">{{
                formatTime12Hour(invoiceData.time)
              }}</span>
            </template>
          </UFormField>
          <UFormField label="القديم">
            <UInputNumber
              :model-value="numOrUndef(invoiceData.debt)"
              placeholder="القديم"
              :min="0"
              class="w-full"
              @update:model-value="(v) => (invoiceData.debt = v ?? null)"
            />
          </UFormField>
          <UFormField label="المبلغ المدفوع">
            <UInput
              :model-value="paidInput"
              type="number"
              placeholder="المبلغ المدفوع"
              :min="0"
              inputmode="decimal"
              class="w-full"
              @update:model-value="
                (v) => {
                  blockUpdatePaidAmount = true;
                  invoiceData.paid_amount = v === '' ? null : Number(v);
                }
              "
            >
              <template #trailing>
                <UTooltip text="تم السداد بالكامل">
                  <UButton
                    icon="i-lucide-check"
                    color="success"
                    variant="ghost"
                    size="xs"
                    class="flex items-center justify-center"
                    aria-label="تم السداد بالكامل"
                    @click="
                      () => {
                        invoiceData.paid_amount = totalOfInvoice;
                        blockUpdatePaidAmount = false;
                      }
                    "
                  />
                </UTooltip>
              </template>
            </UInput>
            <template #hint>
              <span class="text-xs text-gray-500"
                >المتبقي:
                {{
                  formatePrice(
                    totalOfInvoice - Number(invoiceData.paid_amount || 0),
                  )
                }}</span
              >
            </template>
          </UFormField>
          <!-- HOME delta: mahros/delivery hidden — kept in model. -->
          <UFormField label="العلف">
            <UInputNumber
              :model-value="numOrUndef(invoiceData.amount_of_animal_feeds)"
              placeholder="العلف"
              :min="0"
              class="w-full"
              @update:model-value="
                (v) => (invoiceData.amount_of_animal_feeds = v ?? null)
              "
            />
          </UFormField>
          <UFormField
            :label="`الخصم (${invoiceData.discount_percentage ? 'نسبة مئوية' : 'مبلغ ثابت'})`"
          >
            <UInput
              :model-value="discountInput"
              type="number"
              placeholder="الخصم"
              :min="0"
              inputmode="decimal"
              class="w-full"
              @update:model-value="
                (v) => (invoiceData.discount = v === '' ? null : Number(v))
              "
            >
              <template #trailing>
                <UTooltip text="نوع الخصم (نسبة مئوية % أم مبلغ ثابت)">
                  <UButton
                    :icon="
                      invoiceData.discount_percentage
                        ? 'i-lucide-percent'
                        : 'i-lucide-banknote'
                    "
                    color="neutral"
                    variant="ghost"
                    class="flex items-center justify-center"
                    aria-label="نوع الخصم"
                    @click="
                      invoiceData.discount_percentage =
                        !invoiceData.discount_percentage
                    "
                  />
                </UTooltip>
              </template>
            </UInput>
          </UFormField>
          <UFormField label="الخصم متعلق بـ">
            <UInput
              :model-value="invoiceData.discount_for ?? ''"
              placeholder="الخصم متعلق بـ"
              class="w-full"
              @update:model-value="
                (v) => (invoiceData.discount_for = String(v ?? ''))
              "
            />
          </UFormField>
        </div>

        <div
          class="mb-2 mt-4 flex items-center justify-between border-t border-gray-100 pt-3"
        >
          <p class="text-xs font-bold text-gray-400">
            المنتجات ({{ invoiceData.products.length }})
          </p>
          <UButton
            color="success"
            variant="soft"
            size="sm"
            icon="i-lucide-plus"
            @click="addNewForm"
            >إضافة منتج آخر</UButton
          >
        </div>
        <FormsProduct
          v-model="showProductModal"
          :refresher="loadProds"
          @done="onProductModalDone"
        />
        <div
          ref="containerRef"
          class="max-h-[55vh] space-y-3 overflow-y-auto p-0.5"
          v-if="!loadingProds"
        >
          <div
            v-for="(form, index) in invoiceData.products"
            :key="'product-line-' + index"
            class="rounded-lg border border-gray-200 p-3"
            :class="isCostGreaterThanPrice(form) ? 'border-red-400!' : ''"
          >
            <!-- Compact read-only view once a product is picked -->
            <div
              v-if="!isExpanded(form)"
              class="flex items-center justify-between gap-2"
            >
              <div class="min-w-0">
                <div class="truncate text-sm font-bold text-gray-900">
                  {{ form.product_name || "—" }}
                  <span v-if="form.option" class="font-normal text-gray-500"
                    >({{ form.option }})</span
                  >
                </div>
                <div class="mt-0.5 text-[11px] text-gray-400">
                  المتاح بالمخزون: {{ stockOf(form) }}
                </div>
                <div
                  class="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500"
                >
                  <span class="flex items-center gap-1">
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="soft"
                      icon="i-lucide-minus"
                      aria-label="تقليل الكمية"
                      class="flex items-center justify-center"
                      @click="changeQty(form, -stepOf(form))"
                    />
                    <UInput
                      :model-value="qtyText(form)"
                      inputmode="decimal"
                      aria-label="الكمية"
                      class="w-20"
                      size="xs"
                      @update:model-value="
                        (v) => setQtyText(form, String(v ?? ''))
                      "
                      @blur="qtyDrafts.delete(form)"
                    />
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="soft"
                      icon="i-lucide-plus"
                      aria-label="زيادة الكمية"
                      class="flex items-center justify-center"
                      @click="changeQty(form, stepOf(form))"
                    />
                  </span>
                  <span>×</span>
                  <span dir="ltr">{{ formatePrice(form.product_price) }}</span>
                  <span>=</span>
                  <span class="font-bold text-gray-800">{{
                    formatePrice(calcTotalOfForm(form))
                  }}</span>
                </div>
                <div
                  v-if="qtyExceeds(form)"
                  class="mt-0.5 text-xs font-bold text-red-600"
                >
                  تتجاوز المتاح بالمخزون ({{ stockOf(form) }}) — لن تُحفظ
                </div>
              </div>
              <div class="flex shrink-0 gap-1.5">
                <UButton
                  size="sm"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-pencil"
                  @click="expandLine(form)"
                  >تعديل</UButton
                >
                <UButton
                  v-if="invoiceData.products.length > 1"
                  size="sm"
                  color="error"
                  variant="soft"
                  icon="i-lucide-trash-2"
                  @click="removeLine(form)"
                  >حذف</UButton
                >
              </div>
            </div>
            <!-- Expanded edit mode -->
            <div v-else>
              <div class="mb-2 flex items-center justify-between">
                <span class="text-xs font-bold text-gray-400">
                  {{ form.product_name || `منتج #${index + 1}` }}
                </span>
                <div class="flex shrink-0 gap-1.5">
                  <UButton
                    size="sm"
                    color="success"
                    variant="soft"
                    icon="i-lucide-chevron-up"
                    @click="collapseLine(form)"
                    >إغلاق</UButton
                  >
                  <UButton
                    v-if="invoiceData.products.length > 1"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="soft"
                    size="xs"
                    class="flex items-center justify-center"
                    aria-label="حذف السطر"
                    @click="removeLine(form)"
                  />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <UFormField label="المنتج" class="col-span-2">
                  <USelectMenu
                    :model-value="
                      (selectedProd(form) ?? null) as Product | undefined
                    "
                    :items="productMenuItems(form)"
                    label-key="name"
                    by="id"
                    :search-term="getProdSearch(form)"
                    :search-input="{
                      placeholder: 'بحث عن منتج...',
                      icon: 'i-lucide-search',
                    }"
                    :ignore-filter="true"
                    placeholder="المنتج"
                    :loading="loadingProds"
                    class="w-full"
                    @update:search-term="(v) => setProdSearch(form, v)"
                    @update:model-value="(prod) => onPickProduct(form, prod)"
                  />
                </UFormField>
                <UFormField label="خيار معين">
                  <UInput
                    v-model="form.option"
                    placeholder="خيار معين"
                    class="w-full"
                  />
                </UFormField>
                <UFormField v-if="unitsOf(form).length > 1" label="الوحدة">
                  <USelectMenu :model-value="selectedUnit(form)" :items="unitsOf(form)" label-key="name" by="id" class="w-full" @update:model-value="(unit) => onPickUnit(form, unit)" />
                </UFormField>
                <UFormField
                  :label="
                    form.product_id
                      ? `الكمية (المتاح: ${stockOf(form)})`
                      : 'الكمية'
                  "
                >
                  <div class="flex items-center gap-1.5">
                    <UInput
                      :model-value="qtyText(form)"
                      placeholder="0"
                      inputmode="decimal"
                      class="min-w-0 flex-1 text-center"
                      :ui="{
                        base: 'text-center',
                      }"
                      @update:model-value="
                        (v) => setQtyText(form, String(v ?? ''))
                      "
                      @blur="qtyDrafts.delete(form)"
                    >
                      <template #leading>
                        <UButton
                          size="xs"
                          color="neutral"
                          variant="soft"
                          icon="i-lucide-minus"
                          aria-label="تقليل الكمية"
                          class="flex shrink-0 items-center justify-center"
                          @click="changeQty(form, -1)"
                        />
                      </template>
                      <template #trailing>
                        <UButton
                          size="xs"
                          color="neutral"
                          variant="soft"
                          icon="i-lucide-plus"
                          aria-label="زيادة الكمية"
                          class="flex shrink-0 items-center justify-center"
                          @click="changeQty(form, 1)"
                        />
                      </template>
                    </UInput>
                  </div>
                  <template #hint>
                    <span
                      v-if="form.product_id && qtyExceeds(form)"
                      class="block text-xs font-bold text-red-600"
                    >
                      الكمية تتجاوز المتاح بالمخزون!
                    </span>
                  </template>
                </UFormField>
                <UFormField label="سعر المنتج">
                  <UInputNumber
                    v-model="form.product_price"
                    :min="0"
                    class="w-full"
                    :color="isCostGreaterThanPrice(form) ? 'error' : undefined"
                  />
                  <template v-if="form.product_cost_price && viewCost" #hint>
                    <span class="text-xs text-gray-500"
                      >التكلفة ({{ form.product_cost_price }})</span
                    >
                  </template>
                </UFormField>
                <UFormField label="الإجمالي">
                  <UInput
                    :model-value="formatePrice(calcTotalOfForm(form))"
                    readonly
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="الترتيب">
                  <UInput
                    :model-value="String(index)"
                    placeholder="الترتيب"
                    inputmode="numeric"
                    dir="ltr"
                    class="w-full"
                    @update:model-value="(v) => (form.order = Number(v))"
                    @keydown.enter="
                      moveIndexToNewValue(index, form.order);
                      form.order = null;
                    "
                  />
                </UFormField>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="my-3 text-center text-gray-500">
          جاري تحميل المنتجات... الرجاء الإنتظار
        </div>
      </UCard>

      <!-- Live preview -->
      <div class="min-w-0 xl:sticky xl:top-16 xl:w-[480px] xl:shrink-0">
        <Invoice
          v-if="!loadingProds"
          :invoice-data="invoiceData"
          @reset="resetInvoice"
          @saved="(id) => (invoiceData.id = id)"
        />
        <div v-else class="my-3 text-center text-gray-500">
          جاري تحميل المنتجات... الرجاء الإنتظار
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import type { Customer, Invoice, InvoiceProductLine, Product } from "~/types";
import { toDateSafe } from "~/types";
import type { ProductUnit } from "~/types";

definePageMeta({ title: "إنشاء فاتورة" });
const { formatDate, formatTime12Hour, formatePrice, calcTotal } = useHelpers();
const { isLowStock, unitsForProduct, lineBaseQuantity } = useFinance();
const products = useProductsStore();
const lowStockCount = computed(() => products.list.filter((p) => isLowStock(p)).length);
const { onDocChange } = useFirebase();
const invoices = useInvoicesStore();
const customers = useCustomersStore();
const authStore = useAuth();
const { notify } = useAppToast();
const updating = ref(false);
const loadingCustomers = ref(false);
const loadingProds = ref(false);
const containerRef = ref<HTMLElement | null>(null);
const startView = ref(false);
const viewCost = ref(false);

function emptyLine(): InvoiceProductLine {
  return {
    product_name: "",
    product_price: 0,
    product_cost_price: 0,
    product_quantity: 1,
    total: 0,
    option: "",
    product_id: "",
    unit_factor: 1,
    base_quantity: 1,
  };
}
function emptyInvoice(): Invoice {
  return {
    customer_name: null,
    customer_phone: null,
    customer_id: null,
    debt: null,
    delivery_price: null,
    discount_percentage: false,
    discount: null,
    discount_for: null,
    amount_of_animal_feeds: null,
    amount_of_mahros: null,
    created_by: (authStore.currentUserKey as string) || "su",
    // HOME delta: paid/remaining (debts feature).
    paid_amount: 0,
    remaining: 0,
    products: [emptyLine()],
    date: new Date(),
    time: new Date(),
  };
}
const invoiceData = ref<Invoice>(emptyInvoice());
// HOME delta: created_by select hidden (single admin) — creatorOptions unused.

// HOME delta: paid follows invoice total until the user types manually.
const blockUpdatePaidAmount = ref(false);
const discountAmount = computed(() => {
  if (invoiceData.value.discount && invoiceData.value.discount_percentage) {
    return (
      (calcTotal(invoiceData.value) * Number(invoiceData.value.discount)) / 100
    );
  }
  return Number(invoiceData.value.discount || 0);
});
const totalOfInvoice = computed(
  () => calcTotal(invoiceData.value) - discountAmount.value,
);
watch(
  () => [
    invoiceData.value.products,
    invoiceData.value.discount,
    invoiceData.value.discount_for,
    invoiceData.value.discount_percentage,
    invoiceData.value.debt,
  ],
  () => {
    if (blockUpdatePaidAmount.value) return;
    invoiceData.value.paid_amount = totalOfInvoice.value;
  },
  { deep: true },
);

function isCostGreaterThanPrice(
  product: Pick<InvoiceProductLine, "product_price" | "product_cost_price">,
): boolean {
  return (
    isAdmin.value &&
    Number(product.product_price) < Number(product.product_cost_price)
  );
}
function resetInvoice(): void {
  invoiceData.value = emptyInvoice();
}
// FLAG [D1]: shared calc lives in useHelpers.calcLineTotal; kept local for template compat.
const calcTotalOfForm = (
  form: Pick<InvoiceProductLine, "product_price" | "product_quantity">,
): number => {
  if (form.product_price && form.product_quantity) {
    return Number(form.product_price) * Number(form.product_quantity);
  }
  return 0;
};

// USelectMenu bridges (object pickers replace return-object autocompletes)
const CREATE_CUSTOMER_ID = "__create__";
const CREATE_PRODUCT_ID = "__create__";
const customerSearch = ref("");
const showCustomerModal = ref(false);
const customerMenuItems = computed<Customer[]>(() => {
  const q = customerSearch.value.trim();
  const base = q
    ? customers.list.filter(
        (c) => c.name?.includes(q) || String(c.phone ?? "").includes(q),
      )
    : [...customers.list];
  return [
    {
      id: CREATE_CUSTOMER_ID,
      name: "+ إضافة عميل جديد",
      phone: null,
    } as Customer,
    ...base.slice(0, 30),
  ];
});
function selectedCustomer(): Customer | undefined {
  // Prefer the exact unique id link; fall back to phone for legacy drafts.
  if (invoiceData.value.customer_id) {
    return customers.list.find((c) => c.id === invoiceData.value.customer_id);
  }
  if (!invoiceData.value.customer_phone) return undefined;
  return customers.list.find(
    (c) =>
      String(c.phone ?? "") === String(invoiceData.value.customer_phone ?? ""),
  );
}
function onPickCustomer(cus: Customer | null | undefined): void {
  if (!cus) return;
  // First dropdown item opens the create modal instead of selecting.
  if (cus.id === CREATE_CUSTOMER_ID) {
    showCustomerModal.value = true;
    return;
  }
  // Re-resolve against the store so display/model always use the canonical
  // object (never a stale dropdown copy).
  const real = customers.list.find((c) => c.id === cus.id) ?? cus;
  invoiceData.value.customer_phone = real?.phone ?? null;
  invoiceData.value.customer_name = real?.name ?? null;
  // F16: reliable link for debt aggregation (snapshots preserved).
  invoiceData.value.customer_id = real?.id ?? null;
  customerSearch.value = "";
}
function selectedProd(form: InvoiceProductLine): Product | undefined {
  if (!form.product_id) return undefined;
  return products.list.find((p) => p.id === form.product_id);
}
function unitsOf(form: InvoiceProductLine): ProductUnit[] {
  const product = selectedProd(form);
  return product ? unitsForProduct(product) : [];
}
function selectedUnit(form: InvoiceProductLine): ProductUnit | undefined {
  const options = unitsOf(form);
  return options.find((unit) => unit.id === form.unit_id) ?? options.find((unit) => unit.is_base) ?? options[0];
}
function onPickUnit(form: InvoiceProductLine, unit?: ProductUnit): void {
  if (!unit) return;
  form.unit_id = unit.id;
  form.unit_name = unit.name;
  form.unit_factor = unit.factor;
  form.base_quantity = Number(form.product_quantity || 0) * unit.factor;
  form.product_price = Number(unit.selling_price ?? selectedProd(form)?.price ?? 0);
}
// Per-line dropdown search (object identity survives unshift/splice/move).
const prodSearch = reactive(new Map<InvoiceProductLine, string>());
function getProdSearch(form: InvoiceProductLine): string {
  return prodSearch.get(form) ?? "";
}
function setProdSearch(form: InvoiceProductLine, v: string): void {
  prodSearch.set(form, v);
}
function productMenuItems(form: InvoiceProductLine): Product[] {
  const q = (prodSearch.get(form) ?? "").trim().toLowerCase();
  // Only sellable products: stock_quantity > 0 (unset/null counts as 0).
  const inStock = products.list.filter((p) => (p.stock_quantity ?? 0) > 0);
  const base = q
    ? inStock.filter((p) => p.name?.toLowerCase().includes(q))
    : [...inStock];
  return [
    {
      id: CREATE_PRODUCT_ID,
      name: "+ إضافة منتج جديد",
      price: null,
      cost_price: null,
    } as Product,
    ...base.slice(0, 30),
  ];
}
const showProductModal = ref(false);
const productModalLine = ref<InvoiceProductLine | null>(null);
function onPickProduct(
  form: InvoiceProductLine,
  prod: Product | null | undefined,
): void {
  if (!prod) return;
  // First dropdown item opens the create modal instead of selecting.
  if (prod.id === CREATE_PRODUCT_ID) {
    productModalLine.value = form;
    showProductModal.value = true;
    return;
  }
  // Canonical store object + clear the line search (same fix as customers).
  const real = products.list.find((p) => p.id === prod.id) ?? prod;
  // Stock validation at pick time: refuse out-of-stock or insufficient stock.
  const available = real?.stock_quantity ?? 0;
  const wanted = Number(form.product_quantity || 0);
  if (!(available > 0)) {
    notify(`المنتج "${real?.name || ""}" غير متوفر بالمخزون حالياً.`, "error");
    return;
  }
  const baseUnit = unitsForProduct(real).find((unit) => unit.is_base) ?? unitsForProduct(real)[0];
  if (wanted * Number(baseUnit?.factor || 1) - available > 1e-9) {
    notify(
      `الكمية المطلوبة (${wanted}) تتجاوز المتاح بالمخزون (${available}). خفّض الكمية أولاً.`,
      "error",
    );
    return;
  }
  form.product_price = Number(baseUnit?.selling_price ?? real?.price ?? 0);
  form.product_id = real?.id ?? "";
  form.product_cost_price = Number(real?.cost_price ?? 0);
  form.product_name = real?.name ?? "";
  onPickUnit(form, baseUnit);
  // No auto-collapse: the user locks the line explicitly with collapseLine().
  prodSearch.delete(form);
  setProdSearch(form, "");
}
function onProductModalDone(prod: Product | null | undefined): void {
  if (productModalLine.value) onPickProduct(productModalLine.value, prod);
  productModalLine.value = null;
}
// Free-typed quantity drafts (object identity, never persisted).
// Allows intermediate states like "." or ".5" while typing; valid numbers
// commit to the line immediately so totals update live.
const qtyDrafts = reactive(new Map<InvoiceProductLine, string>());
function qtyText(form: InvoiceProductLine): string {
  const d = qtyDrafts.get(form);
  if (d !== undefined) return d;
  return String(form.product_quantity ?? "");
}
function setQtyText(form: InvoiceProductLine, v: string): void {
  const t = v.trim();
  if (t === "") {
    qtyDrafts.set(form, "");
    form.product_quantity = 0;
    form.base_quantity = 0;
    return;
  }
  const n = Number(t);
  if (!Number.isFinite(n)) {
    qtyDrafts.set(form, v); // garbage: keep visible, don't commit
    return;
  }
  form.product_quantity = Math.max(0, n);
  form.base_quantity = form.product_quantity * Number(form.unit_factor || 1);
  qtyDrafts.delete(form);
}
// Expanded/collapsed state by object identity (never persisted to Firestore).
const expandedLines = reactive(new Set<InvoiceProductLine>());
function isExpanded(form: InvoiceProductLine): boolean {
  return expandedLines.has(form) || !form.product_id;
}
function expandLine(form: InvoiceProductLine): void {
  expandedLines.add(form);
}
// Live stock info per line (reactive to store + typed qty).
function stockOf(form: InvoiceProductLine): number {
  if (!form.product_id) return 0;
  return (
    (products.list.find((p) => p.id === form.product_id)?.stock_quantity ?? 0) / Number(form.unit_factor || 1)
  );
}
function qtyExceeds(form: InvoiceProductLine): boolean {
  return lineBaseQuantity(form) - Number(products.list.find((p) => p.id === form.product_id)?.stock_quantity ?? 0) > 1e-9;
}
// Quick +/- steppers in compact view (floor at 0; precise halves via edit mode).
function changeQty(form: InvoiceProductLine, delta: number): void {
  const next = Number(form.product_quantity || 0) + delta;
  form.product_quantity = Math.max(0, Number.isFinite(next) ? next : 0);
  form.base_quantity = form.product_quantity * Number(form.unit_factor || 1);
}
// Step matches the quantity shape: whole numbers step by 1,
// fractional (KG) quantities step by 0.5.
function stepOf(form: InvoiceProductLine): number {
  return Number.isInteger(Number(form.product_quantity || 0)) ? 1 : 0.5;
}
// Explicit lock: collapse the line, then auto-append a fresh line on top
// so the entry flow continues (only when no empty line exists).
function collapseLine(form: InvoiceProductLine): void {
  if (!form.product_id) {
    notify("اختر المنتج أولًا قبل إغلاق السطر.", "error");
    return;
  }
  // Stock validation at lock time: quantity must fit current stock.
  const prod = products.list.find((p) => p.id === form.product_id);
  const available = prod?.stock_quantity ?? 0;
  const wanted = Number(form.product_quantity || 0);
  if (wanted * Number(form.unit_factor || 1) - available > 1e-9) {
    notify(
      `الكمية المطلوبة (${wanted}) تتجاوز المتاح بالمخزون (${available}) لمنتج ${form.product_name}.`,
      "error",
    );
    return;
  }
  expandedLines.delete(form);
  if (!invoiceData.value.products.some((l) => !l.product_id)) {
    const line = emptyLine();
    invoiceData.value.products.unshift(line);
    expandedLines.add(line);
    nextTick(scrollToTop);
  }
}
function removeLine(form: InvoiceProductLine): void {
  if (invoiceData.value.products.length <= 1) return;
  const index = invoiceData.value.products.indexOf(form);
  if (index === -1) return;
  expandedLines.delete(form);
  prodSearch.delete(form);
  qtyDrafts.delete(form);
  invoiceData.value.products.splice(index, 1);
}

// Date/time bridges for native inputs
const dateModel = computed<Date | null>({
  get: () => toDateSafe(invoiceData.value.date),
  set: (v) => {
    invoiceData.value.date = v;
  },
});
const timeInput = computed<string>({
  get: () => {
    const t = invoiceData.value.time;
    if (t instanceof Date && !isNaN(t.getTime())) {
      return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    }
    if (typeof t === "string" && /^\d{1,2}:\d{2}/.test(t)) return t.slice(0, 5);
    return "";
  },
  set: (v: string) => {
    invoiceData.value.time = v;
  },
});

// Coerce nullable/string numerics for UInputNumber (number-only model).
function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
// Discount uses a plain numeric UInput (for the trailing slot) — string bridge.
const discountInput = computed(() => {
  const d = invoiceData.value.discount;
  return d === null || d === undefined || d === "" ? "" : String(d);
});
// HOME delta: paid input bridge (same pattern as discount).
const paidInput = computed(() => {
  const p = invoiceData.value.paid_amount;
  return p === null || p === undefined || p === "" ? "" : String(p);
});
async function loadCustomers(): Promise<void> {
  loadingCustomers.value = true;
  try {
    await customers.fetchCustomers();
  } finally {
    loadingCustomers.value = false;
  }
}
async function loadProds(updatePrices?: boolean): Promise<void> {
  loadingProds.value = true;
  try {
    await products.fetchProducts();
    if (updatePrices) updateProdsPrices();
  } finally {
    loadingProds.value = false;
  }
}
const scrollToTop = (): void => {
  if (containerRef.value)
    containerRef.value.scrollTo({ top: 0, behavior: "smooth" });
};
watch(
  () => invoiceData.value.products.length,
  (n, o) => (o > n ? null : nextTick(scrollToTop)),
  { flush: "post" },
);
function moveIndexToNewValue(from: number, to: unknown): void {
  if (typeof from !== "number" || !to) return;
  const target = Number(to);
  if (
    !Number.isInteger(target) ||
    target < 0 ||
    target >= invoiceData.value.products.length
  )
    return;
  const [product] = invoiceData.value.products.splice(from, 1);
  if (product) invoiceData.value.products.splice(target, 0, product);
}
function addNewForm(): void {
  // New lines go on TOP; refuse while any line is still empty.
  if (invoiceData.value.products.some((l) => !l.product_id)) {
    // P4: toast instead of blocking alert().
    notify(
      "عذرًا، يجب أن تُضيف منتجًا في السطر الفارغ أولًا حتى تتمكّن من إضافة منتج جديد للفاتورة.",
      "error",
    );
    return;
  }
  const line = emptyLine();
  invoiceData.value.products.unshift(line);
  expandedLines.add(line);
  nextTick(scrollToTop);
}
function updateProdsPrices(preserveHistoricalCosts = false): void {
  const productMap = new Map(products.list.map((p) => [p.id, p]));
  invoiceData.value.products.forEach((item) => {
    const prod = item.product_id ? productMap.get(item.product_id) : undefined;
    if (prod) {
      const unit = unitsForProduct(prod).find((candidate) => candidate.id === item.unit_id) ?? unitsForProduct(prod).find((candidate) => candidate.is_base) ?? unitsForProduct(prod)[0]!;
      if (!invoiceData.value.id) {
        item.unit_id = unit.id;
        item.unit_name = unit.name;
        item.unit_factor = unit.factor;
        item.product_price = Number(unit.selling_price ?? prod.price ?? 0);
        item.base_quantity = Number(item.product_quantity || 0) * unit.factor;
      }
      // Never rewrite historical line costs of a persisted invoice (§1.2).
      if (!preserveHistoricalCosts) {
        item.product_cost_price = Number(prod.cost_price ?? 0);
      }
      item.product_name = prod.name;
    }
  });
}
function handleViewCostClick(): void {
  if (viewCost.value) {
    startView.value = false;
    viewCost.value = false;
  } else {
    startView.value = true;
  }
}
async function updateInvoiceData(): Promise<void> {
  updating.value = true;
  try {
    await loadProds();
    invoiceData.value.date = new Date();
    invoiceData.value.time = new Date();
    // Editing a persisted invoice: refresh prices/names but keep line costs.
    updateProdsPrices(!!invoiceData.value.id);
  } finally {
    updating.value = false;
  }
}
const unSubCustomers = ref<(() => void) | undefined>();
const usSubProds = ref<(() => void) | undefined>();
onMounted(async () => {
  if (invoices.invoiceToEdit) {
    // HOME delta: don't let the autosync overwrite a stored paid_amount.
    blockUpdatePaidAmount.value = true;
    const src = invoices.invoiceToEdit;
    const d = toDateSafe(src.date) ?? new Date();
    invoiceData.value = {
      ...emptyInvoice(),
      ...src,
      date: new Date(d),
      time: new Date(d),
      products: src.products?.length ? src.products : [emptyLine()],
    };
    invoices.invoiceToEdit = undefined;
    setTimeout(() => {
      if (totalOfInvoice.value != invoiceData.value.paid_amount) {
        blockUpdatePaidAmount.value = true;
      } else {
        blockUpdatePaidAmount.value = false;
      }
    }, 100);
  }
  await Promise.all([loadCustomers(), loadProds()]);
  unSubCustomers.value = await onDocChange("customers", loadCustomers);
  usSubProds.value = await onDocChange("products", () => loadProds());
});
onUnmounted(() => {
  unSubCustomers.value?.();
  usSubProds.value?.();
});
</script>
