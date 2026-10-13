<template>
  <!-- `hydrated` keeps the SSR HTML and the first client render identical
    (skeleton): authStore.role is null on the server, so branching on it
    directly causes hydration node mismatch / insertBefore 500s. -->
  <template
    v-if="
      hydrated && (authStore.role === 'admin' || authStore.role === 'cashier')
    "
  >
    <div class="invoice-creator-view" id="editor-area">
      <div class="flex flex-col gap-4">
        <UCard variant="outline" class="w-full">
          <div
            v-if="invoiceData.id"
            class="mb-3 flex flex-wrap justify-end gap-2"
          >
            <UButton
              color="success"
              icon="i-lucide-refresh-ccw"
              :loading="updating"
              @click="updateInvoiceData"
            >
              تحديث الفاتورة
            </UButton>
          </div>
          <UAlert
            v-if="shortageCount > 0"
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :title="`تنبيه: ${shortageCount} وحدة قليلة الكمية بالمخزون`"
            :actions="[
              {
                label: 'عرضها في المنتجات',
                color: 'warning',
                variant: 'soft',
                onClick: () => navigateTo('/products'),
              },
            ]"
            class="mb-3"
          />

          <div
            class="rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm sm:p-4"
          >
            <div
              class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div
                class="flex items-center gap-2 text-sm font-semibold text-slate-700"
              >
                <UIcon name="i-lucide-wallet-cards" class="size-4" />
                {{ "بيانات العميل ومحفظته" }}
              </div>
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
                placeholder="اختر العميل"
                aria-label="اختيار العميل"
                :loading="loadingCustomers"
                class="w-full min-w-0 sm:w-80"
                @update:model-value="onPickCustomer"
              />
            </div>
            <FormsCustomer
              v-model="showCustomerModal"
              :refresher="loadCustomers"
              @done="onPickCustomer"
            />
            <div
              v-if="!invoiceData.id"
              class="-mt-3 border-t border-slate-200 pt-3"
              aria-live="polite"
            >
              <div
                v-if="!invoiceData.customer_id"
                class="text-sm text-slate-500"
              >
                اختر عميلًا لعرض رصيده.
              </div>
              <div
                v-else-if="loadingDebt || creditLoading"
                class="text-sm text-slate-500"
              >
                جارِ تحميل أرصدة العميل...
              </div>
              <div v-else-if="balanceError" class="text-sm text-red-600">
                تعذر تحميل الأرصدة. أعد اختيار العميل.
              </div>
              <div v-else>
                <div class="grid grid-cols-2 gap-2">
                  <div
                    class="rounded-lg border border-emerald-100 bg-white p-2.5"
                  >
                    <div class="text-xs text-slate-500">العميل له</div>
                    <div class="mt-1 text-base font-bold text-emerald-700">
                      {{ formatePrice(creditBalance) }} ج
                    </div>
                  </div>
                  <div class="rounded-lg border border-rose-100 bg-white p-2.5">
                    <div class="text-xs text-slate-500">العميل عليه</div>
                    <div class="mt-1 text-base font-bold text-rose-700">
                      {{ formatePrice(customerDebt) }} ج
                    </div>
                  </div>
                </div>
                <div
                  v-if="invoiceData.customer_id && creditBalance"
                  class="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600"
                >
                  <label for="invoice-customer-credit">استخدام الرصيد:</label>
                  <UInputNumber
                    id="invoice-customer-credit"
                    v-model="invoiceData.credit_used"
                    :min="0"
                    :max="Math.min(creditBalance, totalOfInvoice)"
                    :step="0.01"
                    size="xs"
                    class="w-28"
                  />
                </div>
              </div>
            </div>
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
                    {{
                      form.product_name
                        ? formatInvoiceLineName(
                            form.product_name,
                            form.unit_name,
                            form.option,
                          )
                        : "—"
                    }}
                  </div>
                  <div class="mt-0.5 text-[11px] text-gray-400">
                    {{
                      invoiceData.id
                        ? "المتاح بالمخزون"
                        : "المتبقي بعد الفاتورة"
                    }}: {{ stockLabelOf(form) }}
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
                        inputmode="numeric"
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
                    <span dir="ltr">{{
                      formatePrice(form.product_price)
                    }}</span>
                    <span>=</span>
                    <span class="font-bold text-gray-800">{{
                      formatePrice(calcTotalOfForm(form))
                    }}</span>
                  </div>
                  <div
                    v-if="qtyExceeds(form)"
                    class="mt-0.5 text-xs font-bold text-red-600"
                  >
                    {{ exceedText(form) }} — لن تُحفظ
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
                    {{
                      form.product_name
                        ? formatInvoiceLineName(
                            form.product_name,
                            form.unit_name,
                            form.option,
                          )
                        : `منتج #${index + 1}`
                    }}
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
                  <UFormField v-if="unitsOf(form).length > 1" label="الوحدة">
                    <USelectMenu
                      :model-value="selectedUnit(form)"
                      :items="unitsOf(form)"
                      label-key="name"
                      by="id"
                      :search-input="false"
                      class="w-full"
                      @update:model-value="(unit) => onPickUnit(form, unit)"
                    />
                  </UFormField>
                  <UFormField
                    :label="
                      form.product_id
                        ? `الكمية (${stockNumberOf(form) ?? '—'})`
                        : 'الكمية'
                    "
                  >
                    <div class="flex items-center gap-1.5">
                      <UInput
                        :model-value="qtyText(form)"
                        placeholder="0"
                        inputmode="numeric"
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
                        {{ exceedText(form) }}
                      </span>
                    </template>
                  </UFormField>
                  <UFormField label="سعر المنتج">
                    <UInputNumber
                      v-model="form.product_price"
                      :min="0"
                      :step="0.01"
                      class="w-full"
                      :color="
                        isCostGreaterThanPrice(form) ? 'error' : undefined
                      "
                    />
                    <template
                      v-if="
                        (authStore.role === 'admin' && form.product_cost_price) ||
                        priceHintOf(form) !== null
                      "
                      #hint
                    >
                      <span
                        v-if="authStore.role === 'admin' && form.product_cost_price"
                        class="block text-xs text-gray-500"
                        >{{
                          formatePrice(
                            Number(form.product_cost_price ?? 0) *
                              Number(form.unit_factor || 1),
                          )
                        }}</span
                      >
                      <span
                        v-if="priceHintOf(form) !== null"
                        class="flex items-center justify-between gap-2 text-xs text-amber-700"
                      >
                        <span
                          >سعر البيع الحالي:
                          {{ formatePrice(priceHintOf(form)) }}</span
                        >
                        <UButton
                          size="xs"
                          color="warning"
                          variant="soft"
                          @click="applyCurrentPrice(form)"
                          >تطبيق</UButton
                        >
                      </span>
                    </template>
                  </UFormField>
                  <UFormField label="الإجمالي">
                    <UInput
                      :model-value="formatePrice(calcTotalOfForm(form))"
                      readonly
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </div>
            </div>
          </div>
          <template v-if="!loadingProds">
            <div class="mt-4 space-y-3 border-t border-gray-100 pt-3">
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <UFormField
                  :label="`الخصم (${invoiceData.discount_percentage ? 'نسبة مئوية' : 'مبلغ ثابت'})`"
                >
                  <UInput
                    :model-value="discountInput"
                    type="number"
                    placeholder="الخصم"
                    :min="0"
                    step="0.01"
                    inputmode="decimal"
                    class="w-full"
                    @update:model-value="
                      (v) =>
                        (invoiceData.discount = v === '' ? null : Number(v))
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
              <div class="grid grid-cols-1 gap-3">
                <UFormField label="النقد المدفوع">
                  <UInput
                    :model-value="paidInput"
                    type="number"
                    placeholder="المبلغ المدفوع"
                    :min="0"
                    step="0.01"
                    inputmode="decimal"
                    class="w-full"
                    @update:model-value="
                      (v) => {
                        blockUpdatePaidAmount = true;
                        invoiceData.paid_amount =
                          v === ''
                            ? null
                            : Number(v) + Number(invoiceData.credit_used || 0);
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
              </div>
            </div>
          </template>
          <div v-else class="space-y-3" aria-hidden="true">
            <div class="mb-3 flex flex-wrap justify-end gap-2">
              <USkeleton class="h-9 w-32 rounded-md" />
              <USkeleton class="h-9 w-28 rounded-md" />
            </div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div v-for="i in 2" :key="i">
                <USkeleton class="h-4 w-1/3" />
                <USkeleton class="mt-1.5 h-11 w-full rounded-md" />
              </div>
            </div>
            <div
              class="mb-2 mt-4 flex items-center justify-between border-t border-gray-100 pt-3"
            >
              <USkeleton class="h-4 w-24" />
              <USkeleton class="h-7 w-28 rounded-md" />
            </div>
            <div class="space-y-3">
              <div
                v-for="i in 2"
                :key="i"
                class="rounded-lg border border-gray-200 p-3"
              >
                <USkeleton class="h-5 w-1/2" />
                <USkeleton class="mt-1.5 h-3 w-1/4" />
                <div class="mt-2 flex items-center gap-1.5">
                  <USkeleton class="h-7 w-7 rounded-md" />
                  <USkeleton class="h-7 w-20 rounded-md" />
                  <USkeleton class="h-7 w-7 rounded-md" />
                  <USkeleton class="h-4 w-24" />
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <!-- Hidden save/print engine + print source (no visible preview) -->
        <div
          v-if="authStore.role === 'admin'"
          class="hidden"
          aria-hidden="true"
        >
          <Invoice
            ref="invoiceEngine"
            :invoice-data="invoiceData"
            :opening-balance="printOpeningBalance"
            @reset="resetInvoice"
            @saved="onInvoiceSaved"
          />
        </div>
      </div>
    </div>

    <!-- Sticky action bar: icon-only actions + live total.
    Fixed above the mobile bottom nav, normal sticky bar on desktop. -->
    <div
      class="fixed inset-x-0 bottom-0 z-30 mb-[calc(3.5rem+env(safe-area-inset-bottom))] border-t border-gray-200 bg-white/95 backdrop-blur sm:mb-0 sm:pb-0"
    >
      <div
        class="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-2 sm:px-4"
      >
        <div class="min-w-0 flex-1 text-start leading-tight">
          <div class="truncate text-xs text-gray-500">الإجمالي</div>
          <div class="truncate text-lg font-bold tabular-nums text-gray-900">
            {{ formatePrice(totalOfInvoice) }}
          </div>
        </div>
        <UButton
          icon="i-lucide-save"
          color="success"
          size="lg"
          class="min-h-11 min-w-11 justify-center"
          :loading="saving"
          aria-label="حفظ وفاتورة جديدة"
          @click="saveAndNew"
          ><span class="hidden sm:inline">حفظ وجديد</span></UButton
        >
        <UButton
          icon="i-lucide-printer"
          color="neutral"
          variant="soft"
          size="lg"
          class="min-h-11 min-w-11 justify-center"
          :loading="saving"
          :disabled="saving"
          aria-label="حفظ وطباعة"
          @click="saveAndPrint"
          ><span class="hidden sm:inline">حفظ وطباعة</span></UButton
        >
        <UButton
          icon="i-lucide-eye"
          color="neutral"
          variant="soft"
          size="lg"
          class="min-h-11 min-w-11 justify-center"
          aria-label="معاينة الفاتورة"
          @click="previewOpen = true"
          ><span class="hidden sm:inline">معاينة</span></UButton
        >
        <UButton
          icon="i-lucide-rotate-ccw"
          color="error"
          variant="soft"
          size="lg"
          class="min-h-11 min-w-11 justify-center"
          aria-label="تصفير الفاتورة"
          @click="resetInvoice"
          ><span class="hidden sm:inline">تصفير</span></UButton
        >
      </div>
      <div class="h-[env(safe-area-inset-bottom)] sm:hidden" />
    </div>
    <!-- Spacer so the fixed bar never covers page content -->
    <div aria-hidden="true" class="h-24" />

    <!-- Read-only preview with its own print button -->
    <UiAppDialog v-model:open="previewOpen" title="معاينة الفاتورة">
      <Invoice
        :invoice-data="invoiceData"
        :opening-balance="printOpeningBalance"
        view-mode
        @close="previewOpen = false"
      />
    </UiAppDialog>
    <UiAppDialog
      v-model:open="cashierCostConfirmOpen"
      title="تأكيد البيع بأقل من التكلفة"
    >
      <p class="text-sm">
        سعر بيع أحد المنتجات أقل من متوسط تكلفته. هل تريد حفظ الفاتورة بهذا
        السعر؟
      </p>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="warning" class="flex-1" @click="confirmCashierCost"
            >تأكيد الحفظ</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="flex-1"
            @click="cashierCostConfirmOpen = false"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
    <UiAppDialog v-model:open="cashierReceiptOpen" title="تم حفظ الفاتورة">
      <Invoice
        v-if="cashierReceipt"
        ref="cashierReceiptRef"
        :invoice-data="cashierReceipt"
        :opening-balance="printOpeningBalance"
        view-mode
        @close="cashierReceiptOpen = false"
      />
    </UiAppDialog>
  </template>
  <UiAppTableSkeleton v-else />
</template>
<script setup lang="ts">
import type { Customer, Invoice, InvoiceProductLine, Product } from "~/types";
import { toDateSafe } from "~/types";
import type { ProductUnit } from "~/types";

definePageMeta({ title: "إنشاء فاتورة" });
const { formatePrice, calcTotal, formatInvoiceLineName } = useHelpers();
const {
  unitsForProduct,
  unitSellingPrice,
  lineBaseQuantity,
  normalizePhone,
  round2,
  round4,
  stockQuantityLabel,
} = useFinance();
const products = useProductsStore();
const shortageCount = computed(() => products.shortageUnitCount);
const invoices = useInvoicesStore();
const customers = useCustomersStore();
const authStore = useAuth();
const { notify } = useAppToast();
// False on the server and during hydration -> skeleton; true post-mount.
const hydrated = ref(false);
const updating = ref(false);
const saving = ref(false);
const previewOpen = ref(false);
const loadingDebt = ref(false);
const resetAfterSave = ref(false);
const debtsApi = useDebts();
const invoiceEngine = ref<{
  startPrint: (saveOnly?: boolean) => unknown;
} | null>(null);
const cashierReceiptRef = ref<{
  startPrint: (saveOnly?: boolean) => Promise<unknown>;
} | null>(null);
const cashierReceipt = ref<Invoice | null>(null);
const cashierReceiptOpen = ref(false);
const cashierCostConfirmOpen = ref(false);
const cashierPendingPrint = ref(false);
const cashierRequestId = ref(crypto.randomUUID());
const loadingCustomers = ref(true);
const loadingProds = ref(true);
const containerRef = ref<HTMLElement | null>(null);

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
    credit_used: 0,
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
const creditBalance = ref(0);
const creditLoading = ref(false);
const customerDebt = ref(0);
const balanceError = ref(false);
const balanceCustomerId = ref<string | null>(null);
const printOpeningBalance = computed(() =>
  !balanceError.value &&
  !creditLoading.value &&
  !loadingDebt.value &&
  invoiceData.value.customer_id === balanceCustomerId.value &&
  balanceCustomerId.value
    ? { credit: creditBalance.value, debt: customerDebt.value }
    : null,
);
let creditRequest = 0;
watch(
  () => invoiceData.value.customer_id,
  async (id) => {
    const request = ++creditRequest;
    creditBalance.value = 0;
    customerDebt.value = 0;
    balanceCustomerId.value = null;
    balanceError.value = false;
    creditLoading.value = false;
    loadingDebt.value = false;
    if (!id || invoiceData.value.id) return;
    invoiceData.value.credit_used = 0;
    creditLoading.value = true;
    loadingDebt.value = true;
    const [credit, debt] = await Promise.allSettled([
      callStaff<{ customerId: string }, { balance: number }>(
        "getCustomerCredit",
        { customerId: id },
      ),
      fetchCustomerDebt(
        id,
        String(invoiceData.value.customer_name ?? "").trim(),
        normalizePhone(invoiceData.value.customer_phone),
      ),
    ]);
    if (request !== creditRequest) return;
    if (credit.status === "fulfilled" && debt.status === "fulfilled") {
      creditBalance.value = credit.value.balance;
      customerDebt.value = debt.value;
      balanceCustomerId.value = id;
    } else {
      balanceError.value = true;
    }
    creditLoading.value = false;
    loadingDebt.value = false;
  },
);
watch(
  () => invoiceData.value.credit_used,
  (value, previous) => {
    const next = Number(value || 0);
    if (
      !Number.isFinite(next) ||
      next < 0 ||
      next > Math.min(creditBalance.value, totalOfInvoice.value)
    ) {
      invoiceData.value.credit_used = previous || 0;
      return;
    }
    if (blockUpdatePaidAmount.value)
      invoiceData.value.paid_amount = Math.min(
        totalOfInvoice.value,
        round2(
          Number(invoiceData.value.paid_amount || 0) +
            next -
            Number(previous || 0),
        ),
      );
  },
);
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
watch(totalOfInvoice, (total) => {
  if (Number(invoiceData.value.credit_used || 0) > total)
    invoiceData.value.credit_used = Math.max(0, round2(total));
});
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
  product: Pick<
    InvoiceProductLine,
    | "product_price"
    | "product_cost_price"
    | "unit_factor"
    | "base_cost_snapshot"
    | "cost_groups"
  >,
): boolean {
  // Same-unit comparison: selling price (selected unit) vs derived average
  // cost of the SAME unit (base average × factor).
  const factor =
    Number((product as { unit_factor?: unknown }).unit_factor) > 0
      ? Number((product as { unit_factor?: unknown }).unit_factor)
      : 1;
  const groups = (
    product as {
      cost_groups?: { base_quantity: unknown; unit_cost: unknown }[];
    }
  ).cost_groups;
  let baseAvg: number;
  if (Array.isArray(groups) && groups.length) {
    const qty = groups.reduce((s, g) => s + Number(g.base_quantity), 0);
    baseAvg =
      qty > 1e-9
        ? groups.reduce(
            (s, g) => s + Number(g.base_quantity) * Number(g.unit_cost),
            0,
          ) / qty
        : Number(
            (product as { base_cost_snapshot?: unknown }).base_cost_snapshot ??
              product.product_cost_price,
          );
  } else {
    baseAvg = Number(
      (product as { base_cost_snapshot?: unknown }).base_cost_snapshot ??
        product.product_cost_price,
    );
  }
  if (!Number.isFinite(baseAvg)) return false;
  return Number(product.product_price) - baseAvg * factor < -1e-9;
}
function resetInvoice(): void {
  invoiceData.value = emptyInvoice();
  originalReserved.clear();
  cashierRequestId.value = crypto.randomUUID();
}
// Adopt the saved id; when save+new requested, start a fresh invoice.
function onInvoiceSaved(id: unknown): void {
  if (typeof id === "string" && id) invoiceData.value.id = id;
  saving.value = false;
  if (resetAfterSave.value) {
    resetAfterSave.value = false;
    resetInvoice();
    notify("تم الحفظ — فاتورة جديدة جاهزة", "success");
  }
}
async function saveAndPrint(): Promise<void> {
  if (saving.value) return;
  if (
    invoiceData.value.customer_id &&
    !invoiceData.value.id &&
    !printOpeningBalance.value
  ) {
    notify("انتظر تحميل أرصدة العميل أو أعد اختياره قبل الحفظ.", "error");
    return;
  }
  if (!validateStock()) return;
  if (authStore.role === "cashier") {
    await saveCashier(true);
    return;
  }
  resetAfterSave.value = false;
  saving.value = true;
  try {
    // Resolves once the save transaction finishes (print dialog is
    // fire-and-forget after that); cost-confirm path resolves early while
    // the user decides, then saves without a page spinner.
    await invoiceEngine.value?.startPrint(false);
  } finally {
    saving.value = false;
  }
}
async function saveAndNew(): Promise<void> {
  if (saving.value) return;
  if (
    invoiceData.value.customer_id &&
    !invoiceData.value.id &&
    !printOpeningBalance.value
  ) {
    notify("انتظر تحميل أرصدة العميل أو أعد اختياره قبل الحفظ.", "error");
    return;
  }
  if (!validateStock()) return;
  if (authStore.role === "cashier") {
    await saveCashier(false);
    return;
  }
  resetAfterSave.value = true;
  saving.value = true;
  try {
    await invoiceEngine.value?.startPrint(true);
  } catch {
    resetAfterSave.value = false;
  } finally {
    saving.value = false;
    // Cleared by onInvoiceSaved on success; fallback if save never resolves
    // (validation error or dismissed confirm keeps the flag for the retry).
    setTimeout(() => {
      resetAfterSave.value = false;
    }, 8000);
  }
}
async function saveCashier(
  print: boolean,
  costConfirmed = false,
): Promise<void> {
  if (saving.value) return;
  const data = invoiceData.value;
  const lines = data.products.filter((line) => line.product_id);
  if (
    !data.customer_id ||
    !lines.length ||
    lines.some(
      (line) =>
        !line.unit_id ||
        !Number.isFinite(Number(line.product_quantity)) ||
        Number(line.product_quantity) <= 0 ||
        !Number.isFinite(Number(line.product_price)) ||
        Number(line.product_price) < 0,
    )
  ) {
    notify(
      "اختر العميل والمنتجات والوحدات وأدخل كميات وأسعارًا صحيحة.",
      "error",
    );
    return;
  }
  if (!data.id && !printOpeningBalance.value) {
    notify("انتظر تحميل أرصدة العميل أو أعد اختياره قبل الحفظ.", "error");
    return;
  }
  if (!validateStock()) return;
  if (
    lines.some(
      (line) =>
        Math.abs(
          Number(line.product_quantity) - round4(line.product_quantity),
        ) > 1e-9,
    )
  ) {
    notify("الكمية تقبل أربع منازل عشرية كحد أقصى.", "error");
    return;
  }
  const total = Number(totalOfInvoice.value);
  const paid = Number(data.paid_amount ?? 0);
  const credit = Number(data.credit_used ?? 0);
  const discount = Number(data.discount ?? 0);
  const extras = [
    data.debt,
    data.delivery_price,
    data.amount_of_animal_feeds,
    data.amount_of_mahros,
  ].map((value) => Number(value ?? 0));
  if (
    !Number.isFinite(total) ||
    total < 0 ||
    !Number.isFinite(paid) ||
    paid < 0 ||
    paid > total + 0.005 ||
    !Number.isFinite(credit) ||
    credit < 0 ||
    (!data.id && credit > creditBalance.value + 0.005) ||
    paid + 0.005 < credit ||
    !Number.isFinite(discount) ||
    discount < 0 ||
    (data.discount_percentage && discount > 100) ||
    extras.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    notify("راجع الخصم والمبالغ الإضافية والمدفوع ورصيد العميل.", "error");
    return;
  }
  if (!costConfirmed && lines.some(isCostGreaterThanPrice)) {
    cashierPendingPrint.value = print;
    cashierCostConfirmOpen.value = true;
    return;
  }
  saving.value = true;
  const payload = {
    requestId: cashierRequestId.value,
    customer_id: data.customer_id,
    paid_amount: round2(paid - credit),
    credit_used: data.id ? 0 : credit,
    debt: data.id ? extras[0] : 0,
    delivery_price: extras[1],
    amount_of_animal_feeds: extras[2],
    amount_of_mahros: extras[3],
    discount,
    discount_percentage: data.discount_percentage === true,
    discount_for: data.discount_for?.trim() || null,
    products: lines.map((line) => ({
      line_id: line.line_id,
      product_id: line.product_id,
      unit_id: line.unit_id,
      product_quantity: Number(line.product_quantity),
      product_price: Number(line.product_price),
      option: line.option,
    })),
  };
  try {
    let receipt: Invoice;
    if (data.id) {
      const result = await callStaff<
        typeof payload & { id: string; edit_revision?: string },
        { id: string; receipt: Invoice }
      >("updateStaffInvoice", {
        ...payload,
        id: data.id,
        edit_revision: data.edit_revision,
      });
      receipt = result.receipt;
    } else {
      const result = await callStaff<
        typeof payload,
        { id: string; receipt: Invoice }
      >("createStaffSale", payload);
      receipt = result.receipt;
    }
    cashierReceipt.value = receipt;
    invoiceData.value = receipt;
    cashierRequestId.value = crypto.randomUUID();
    notify("تم حفظ الفاتورة وتحديث المخزون والخزنة.", "success");
    if (print) {
      cashierReceiptOpen.value = true;
      await nextTick();
      void cashierReceiptRef.value
        ?.startPrint(false)
        .catch(() => notify("تم حفظ الفاتورة، لكن تعذرت الطباعة.", "error"));
    } else {
      resetInvoice();
    }
    void loadProds(false, true).catch(() =>
      notify("تم الحفظ، لكن تعذر تحديث المنتجات.", "error"),
    );
  } catch {
    notify(
      "تعذر حفظ الفاتورة. راجع السعر والمخزون والرصيد ثم حاول مجددًا.",
      "error",
    );
  } finally {
    saving.value = false;
  }
}
function confirmCashierCost(): void {
  cashierCostConfirmOpen.value = false;
  void saveCashier(cashierPendingPrint.value, true);
}
async function fetchCustomerDebt(
  id: string,
  name: string,
  phone: string,
): Promise<number> {
  const book =
    authStore.role === "cashier"
      ? (
          await callStaff<
            Record<string, never>,
            {
              items: {
                customer_id: string | null;
                name: string;
                phone: string | number | null;
                totalDebt: number;
              }[];
            }
          >("getCashierDebtBook", {})
        ).items
      : await debtsApi.fetchDebtsBook();
  let sum = 0;
  for (const entry of book) {
    const byId = !!entry.customer_id && entry.customer_id === id;
    const byNamePhone =
      !byId &&
      name === String(entry.name ?? "").trim() &&
      !!phone &&
      phone === normalizePhone(entry.phone);
    if (byId || byNamePhone) sum = round2(sum + entry.totalDebt);
  }
  return sum;
}
function handleCtrlPlusS(e: KeyboardEvent): void {
  if (e && (e.ctrlKey || e.metaKey) && e.code === "KeyS") {
    e.preventDefault();
    void saveAndNew();
  }
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
  // Phones must stay strings: Firestore `==` is type-strict and numeric
  // storage loses leading zeros, breaking customer invoice filters.
  const pickedPhone = String(real?.phone ?? "").trim();
  invoiceData.value.customer_phone = pickedPhone === "" ? null : pickedPhone;
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
  if (!product) return [];
  return sellableUnitsForProduct(product);
}
function selectedUnit(form: InvoiceProductLine): ProductUnit | undefined {
  const options = unitsOf(form);
  return options.find((unit) => unit.id === form.unit_id) ?? options[0];
}
function onPickUnit(form: InvoiceProductLine, unit?: ProductUnit): void {
  if (!unit) return;
  form.unit_id = unit.id;
  form.unit_name = unit.name;
  form.unit_factor = 1;
  form.base_quantity = Number(form.product_quantity || 0);
  if (!invoiceData.value.id || !form.cost_groups?.length)
    form.product_cost_price = Number(unit.average_cost ?? 0);
  const product = selectedProd(form);
  const price = product ? unitSellingPrice(product, unit) : null;
  form.product_price = price === null ? 0 : price;
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
  const inStock = products.list.filter(
    (p) =>
      p.is_active !== false &&
      sellableUnitsForProduct(p).some(
        (unit) => Number(unit.stock_quantity ?? 0) > 0,
      ),
  );
  const base = q
    ? inStock.filter((p) => p.name?.toLowerCase().includes(q))
    : [...inStock];
  return base.slice(0, 30);
}
function onPickProduct(
  form: InvoiceProductLine,
  prod: Product | null | undefined,
): void {
  if (!prod) return;
  // Canonical store object + clear the line search (same fix as customers).
  const real = products.list.find((p) => p.id === prod.id) ?? prod;
  const wanted = Number(form.product_quantity || 0);
  const availableUnits = sellableUnitsForProduct(real);
  const selected =
    availableUnits.find((unit) => Number(unit.stock_quantity ?? 0) > 0) ??
    availableUnits[0];
  if (!selected) {
    notify("لا توجد وحدات بيع لهذا المنتج. راجع إعدادات وحداته.", "error");
    return;
  }
  let need = round4(wanted);
  for (const line of invoiceData.value.products) {
    if (
      line === form ||
      line.product_id !== real.id ||
      line.unit_id !== selected.id
    )
      continue;
    need = round4(need + Number(line.product_quantity || 0));
  }
  const allowed = availableOf(real.id ?? "", selected.id);
  if (need - allowed > 1e-9) {
    notify(
      `إجمالي المطلوب (${need}) يتجاوز المتاح بالمخزون (${allowed}). خفّض الكمية أولاً.`,
      "error",
    );
    return;
  }
  form.product_price = unitSellingPrice(real, selected) ?? 0;
  form.product_id = real?.id ?? "";
  form.product_cost_price = Number(selected.average_cost ?? 0);
  form.product_name = real?.name ?? "";
  onPickUnit(form, selected);
  // Never auto-collapse: the line stays expanded until the user locks it
  // explicitly with collapseLine() (إغلاق).
  expandedLines.add(form);
  prodSearch.delete(form);
  setProdSearch(form, "");
}
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
  const unit = selectedUnit(form);
  if (
    !Number.isFinite(n) ||
    (unit?.allows_fractional !== true && !Number.isInteger(n))
  ) {
    qtyDrafts.set(form, v);
    return;
  }
  form.product_quantity = Math.max(0, n);
  form.base_quantity = form.product_quantity;
  qtyDrafts.delete(form);
}
// Expanded/collapsed state by object identity (never persisted to Firestore).
const expandedLines = reactive(new Set<InvoiceProductLine>());
const originalReserved = reactive(new Map<string, number>());
function stockKey(
  productId: string,
  unitId: string | null | undefined,
): string {
  return `${productId}||${unitId ?? ""}`;
}
function isExpanded(form: InvoiceProductLine): boolean {
  return expandedLines.has(form) || !form.product_id;
}
function expandLine(form: InvoiceProductLine): void {
  expandedLines.add(form);
}
// Live stock info per line (reactive to store + typed qty).
function stockLabelOf(form: InvoiceProductLine): string {
  const unit = selectedUnit(form);
  const quantity = stockNumberOf(form);
  if (quantity === null || !unit) return "—";
  return `${quantity} ${unit.name}`;
}
function stockNumberOf(form: InvoiceProductLine): number | null {
  const product = products.list.find((item) => item.id === form.product_id);
  const unit = selectedUnit(form);
  if (!product || !unit) return null;
  if (invoiceData.value.id)
    return round4(Number(unit.stock_quantity ?? 0));
  const key = stockKey(form.product_id ?? "", unit.id);
  const remaining = Math.max(
    0,
    round4(
      availableOf(form.product_id ?? "", unit.id) -
        (needByProduct.value.get(key) ?? 0),
    ),
  );
  return remaining;
}
const needByProduct = computed(() => {
  const need = new Map<string, number>();
  for (const line of invoiceData.value.products) {
    if (!line.product_id || !line.unit_id) continue;
    const key = stockKey(line.product_id, line.unit_id);
    need.set(
      key,
      round4((need.get(key) ?? 0) + Number(line.product_quantity || 0)),
    );
  }
  return need;
});
function availableOf(productId: string, unitId: string): number {
  const product = products.list.find((p) => p.id === productId);
  const unit = product?.units?.find((candidate) => candidate.id === unitId);
  return round4(
    Number(unit?.stock_quantity ?? product?.stock_quantity ?? 0) +
      (originalReserved.get(stockKey(productId, unitId)) ?? 0),
  );
}
function exceedsByProduct(
  productId: string,
  unitId: string | null | undefined,
): { need: number; available: number } | null {
  if (!productId || !unitId) return null;
  const need = needByProduct.value.get(stockKey(productId, unitId)) ?? 0;
  const available = availableOf(productId, unitId);
  return need - available > 1e-9 ? { need, available } : null;
}
function qtyExceeds(form: InvoiceProductLine): boolean {
  return form.product_id
    ? exceedsByProduct(form.product_id, form.unit_id) !== null
    : false;
}
function exceedText(form: InvoiceProductLine): string {
  const info = form.product_id
    ? exceedsByProduct(form.product_id, form.unit_id)
    : null;
  if (!info) return "";
  const product = products.list.find((item) => item.id === form.product_id);
  if (!product) return "الكمية المطلوبة تتجاوز المخزون المتاح.";
  const unit = selectedUnit(form);
  return `إجمالي المطلوب ${info.need} ${unit?.name ?? "وحدة"} يتجاوز المتاح ${info.available} ${unit?.name ?? "وحدة"}.`;
}
function validateStock(): boolean {
  if (
    invoiceData.value.products.some(
      (item) =>
        selectedUnit(item)?.allows_fractional !== true &&
        !Number.isInteger(Number(item.product_quantity)),
    )
  ) {
    notify("هذه الوحدة لا تقبل كميات كسرية.", "error");
    return false;
  }
  const line = invoiceData.value.products.find(
    (item) => item.product_id && qtyExceeds(item),
  );
  if (!line) return true;
  notify(
    `كمية ${line.product_name} المطلوبة تتجاوز المتاح بالمخزون. خفّض الكمية قبل الحفظ.`,
    "error",
  );
  return false;
}
function priceHintOf(form: InvoiceProductLine): number | null {
  const product = form.product_id
    ? products.list.find((p) => p.id === form.product_id)
    : undefined;
  if (!product) return null;
  const options = unitsForProduct(product);
  const unit =
    options.find((candidate) => candidate.id === form.unit_id) ??
    options.find((candidate) => candidate.is_base) ??
    options[0];
  if (!unit) return null;
  const current = unitSellingPrice(product, unit);
  if (current === null || Number(form.product_price) - current === 0)
    return null;
  return current;
}
function applyCurrentPrice(form: InvoiceProductLine): void {
  const current = priceHintOf(form);
  if (current === null) return;
  form.product_price = current;
}
function changeQty(form: InvoiceProductLine, delta: number): void {
  const next = Number(form.product_quantity || 0) + delta;
  form.product_quantity = Math.max(0, Number.isFinite(next) ? next : 0);
  form.base_quantity = form.product_quantity;
  qtyDrafts.delete(form);
}
function stepOf(form: InvoiceProductLine): number {
  return selectedUnit(form)?.allows_fractional === true ? 0.01 : 1;
}
// Explicit lock: collapse the line, then auto-append a fresh line on top
// so the entry flow continues (only when no empty line exists).
function collapseLine(form: InvoiceProductLine): void {
  if (!form.product_id) {
    notify("اختر المنتج أولًا قبل إغلاق السطر.", "error");
    return;
  }
  const duplicateLine = invoiceData.value.id
    ? undefined
    : invoiceData.value.products.find(
        (line) =>
          line !== form &&
          line.product_id === form.product_id &&
          line.unit_id === form.unit_id &&
          Number(line.unit_factor || 1) === Number(form.unit_factor || 1) &&
          Number(line.product_price) === Number(form.product_price) &&
          Number(line.product_cost_price ?? 0) ===
            Number(form.product_cost_price ?? 0) &&
          String(line.option ?? "") === String(form.option ?? "") &&
          !line.cost_groups?.length &&
          !form.cost_groups?.length,
      );
  const mergedQuantity =
    Number(form.product_quantity || 0) +
    Number(duplicateLine?.product_quantity || 0);

  let need = round4(mergedQuantity);
  for (const line of invoiceData.value.products) {
    if (
      line === form ||
      line === duplicateLine ||
      line.product_id !== form.product_id ||
      line.unit_id !== form.unit_id
    )
      continue;
    need = round4(need + Number(line.product_quantity || 0));
  }
  const allowed = availableOf(form.product_id ?? "", form.unit_id ?? "");
  if (need - allowed > 1e-9) {
    notify(
      `إجمالي المطلوب (${need}) يتجاوز المتاح بالمخزون (${allowed}) لمنتج ${form.product_name}.`,
      "error",
    );
    return;
  }

  let lineToCollapse = form;
  if (duplicateLine) {
    duplicateLine.product_quantity = mergedQuantity;
    duplicateLine.base_quantity = mergedQuantity;
    expandedLines.delete(duplicateLine);
    lineToCollapse = duplicateLine;
    const duplicateIndex = invoiceData.value.products.indexOf(form);
    if (duplicateIndex !== -1)
      invoiceData.value.products.splice(duplicateIndex, 1);
    prodSearch.delete(form);
    qtyDrafts.delete(form);
  }

  expandedLines.delete(lineToCollapse);
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

// Date/time are automatic (now at save / edit refresh) — no inputs.

// Discount uses a plain numeric UInput (for the trailing slot) — string bridge.
const discountInput = computed(() => {
  const d = invoiceData.value.discount;
  return d === null || d === undefined || d === "" ? "" : String(d);
});
// HOME delta: paid input bridge (same pattern as discount).
const paidInput = computed(() => {
  const p = invoiceData.value.paid_amount;
  return p === null || p === undefined || p === ""
    ? ""
    : String(round2(Number(p) - Number(invoiceData.value.credit_used || 0)));
});
async function loadCustomers(): Promise<void> {
  loadingCustomers.value = true;
  try {
    await customers.fetchCustomers();
  } finally {
    loadingCustomers.value = false;
  }
}
async function loadProds(updatePrices?: boolean, force = false): Promise<void> {
  loadingProds.value = true;
  try {
    await products.fetchProducts(undefined, force);
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
      const options = unitsForProduct(prod);
      const unit =
        options.find((candidate) => candidate.id === item.unit_id) ??
        options.find((candidate) => candidate.is_base) ??
        options[0];
      if (!invoiceData.value.id) {
        if (!unit) return;
        item.unit_id = unit.id;
        item.unit_name = unit.name;
        item.unit_factor = 1;
        item.product_price = unitSellingPrice(prod, unit) ?? 0;
        item.base_quantity = Number(item.product_quantity || 0);
      }
      // Never rewrite historical line costs of a persisted invoice (§1.2).
      if (!preserveHistoricalCosts) {
        item.product_cost_price = Number(unit?.average_cost ?? 0);
      }
      item.product_name = prod.name;
    }
  });
}
watch(
  () => products.list,
  (current, previous) => {
    if (invoiceData.value.id) return;
    for (const line of invoiceData.value.products) {
      const product = current.find((item) => item.id === line.product_id);
      const unit = product?.units?.find((item) => item.id === line.unit_id);
      if (!product || !unit) continue;
      const oldUnit = previous
        ?.find((item) => item.id === line.product_id)
        ?.units?.find((item) => item.id === line.unit_id);
      if (
        !oldUnit ||
        Number(line.product_price) === Number(oldUnit.selling_price)
      )
        line.product_price = Number(unit.selling_price ?? 0);
      line.product_cost_price = Number(unit.average_cost ?? 0);
      line.product_name = product.name;
      line.unit_name = unit.name;
      line.unit_factor = 1;
      line.base_quantity = Number(line.product_quantity || 0);
    }
  },
);
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
onMounted(async () => {
  hydrated.value = true;
  const authed = await useAuthReady();
  if (!authed) {
    loadingCustomers.value = false;
    loadingProds.value = false;
    return; // layout redirects to /login
  }
  if (authStore.role === "admin") products.ensureInventorySubscription();
  if (invoices.invoiceToEdit) {
    // HOME delta: don't let the autosync overwrite a stored paid_amount.
    blockUpdatePaidAmount.value = true;
    const src = invoices.invoiceToEdit;
    if (
      src.id &&
      (src as { inventory_applied?: boolean }).inventory_applied === true
    ) {
      for (const line of src.products ?? []) {
        if (!line.product_id || !line.unit_id) continue;
        const key = stockKey(line.product_id, line.unit_id);
        originalReserved.set(
          key,
          round4(
            (originalReserved.get(key) ?? 0) +
              Number(line.product_quantity || 0),
          ),
        );
      }
    }
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
  window.addEventListener("keydown", handleCtrlPlusS);
});
onUnmounted(() => {
  window.removeEventListener("keydown", handleCtrlPlusS);
});
</script>
