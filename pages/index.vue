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
      <div class="flex flex-col gap-3">
        <UiAppPageHeader
          :title="invoiceData.id ? 'تعديل فاتورة' : 'إنشاء فاتورة'"
          description="اختر العميل ثم أضف الأصناف وراجع الإجمالي"
        />
        <div v-if="invoiceData.id" class="flex flex-wrap justify-end gap-2">
          <UButton
            color="success"
            icon="i-lucide-refresh-ccw"
            :loading="updating"
            @click="updateInvoiceData"
          >
            تحديث الفاتورة
          </UButton>
        </div>

        <InvoiceDesktopLayout>
          <template #customer>
            <div class="rounded-xl border border-slate-200 bg-white p-3">
              <div
                class="flex items-center gap-2 text-sm font-bold text-slate-700"
              >
                <UIcon name="i-lucide-user-round-search" class="size-4" />
                العميل
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
                class="w-full"
                @update:model-value="onPickCustomer"
              />
              <UAlert
                v-if="customers.fetchError"
                color="error"
                variant="soft"
                :title="customers.fetchError"
                class="mt-2"
              >
                <template #actions
                  ><UButton color="error" variant="soft" @click="loadCustomers"
                    >إعادة المحاولة</UButton
                  ></template
                >
              </UAlert>
              <UAlert
                variant="subtle"
                color="warning"
                description="جاري تحميل محفظة العميل..."
                icon="svg-spinners:ring-resize"
                class="p-1 mt-2"
                v-if="loadingDebt || creditLoading"
              >
              </UAlert>
              <div
                v-else-if="(creditBalance || customerDebt) && !balanceError"
                class="space-y-2 mt-2"
              >
                <div class="grid grid-cols-2 gap-2">
                  <div
                    class="rounded-lg border border-emerald-100 bg-white p-2.5"
                  >
                    <div class="text-xs text-slate-500">العميل له</div>
                    <div
                      class="mt-1 text-base font-bold tabular-nums text-emerald-700"
                    >
                      <UiAppMoneyDisplay :text="formatePrice(creditBalance)" />
                    </div>
                  </div>
                  <div class="rounded-lg border border-rose-100 bg-white p-2.5">
                    <div class="text-xs text-slate-500">العميل عليه</div>
                    <div
                      class="mt-1 text-base font-bold tabular-nums text-rose-700"
                    >
                      <UiAppMoneyDisplay :text="formatePrice(customerDebt)" />
                    </div>
                  </div>
                </div>
                <div
                  v-if="
                    invoiceData.customer_id &&
                    creditAvailableAfterSettlement > 0
                  "
                  class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600"
                >
                  <span v-if="creditBalance > 0 && customerDebt > 0">
                    تسوية تلقائية عند الحفظ:
                    {{ formatePrice(Math.min(creditBalance, customerDebt)) }}
                    من الرصيد مقابل الدين.
                  </span>
                  <label for="invoice-customer-credit">استخدام الرصيد:</label>
                  <UInputNumber
                    id="invoice-customer-credit"
                    :model-value="invoiceData.credit_used"
                    :min="0"
                    :max="
                      Math.min(creditAvailableAfterSettlement, totalOfInvoice)
                    "
                    :step="0.01"
                    size="xs"
                    class="w-28"
                    @update:model-value="setCreditUsed"
                  />
                </div>
              </div>
              <p
                v-else-if="invoiceData.customer_id && !balanceError"
                class="mt-2 text-xs text-slate-600"
              >
                لا دين أو رصيد متاح لهذا العميل.
              </p>
            </div>
            <FormsCustomer
              v-model="showCustomerModal"
              :refresher="loadCustomers"
              @done="onPickCustomer"
            />
            <div
              v-if="!invoiceData.id && invoiceData.customer_id"
              class="mt-2"
              aria-live="polite"
            >
              <div
                v-if="balanceError"
                class="flex mb-2 items-center justify-between gap-2 rounded-xl border border-red-200 bg-white p-3 text-sm text-red-600"
              >
                <span>تعذر تحميل الأرصدة.</span>
                <UButton
                  size="xs"
                  color="error"
                  variant="soft"
                  icon="i-lucide-refresh-cw"
                  :loading="creditLoading || loadingDebt"
                  @click="retryBalances"
                  >إعادة المحاولة</UButton
                >
              </div>
            </div>
          </template>
          <template #main>
            <section aria-label="المنتجات">
              <UAlert
                v-if="products.syncError"
                color="error"
                variant="soft"
                title="تعذر تحميل المنتجات"
                class="mb-3"
              >
                <template #actions
                  ><UButton
                    color="error"
                    variant="soft"
                    @click="retryInvoiceProducts"
                    >إعادة المحاولة</UButton
                  ></template
                >
              </UAlert>
              <div
                class="mb-2 flex md:flex-row flex-col items-center justify-between gap-2"
              >
                <USelectMenu
                  ref="headerFamilyRef"
                  v-model="headerFamily"
                  :items="headerFamilyOptions"
                  label-key="name"
                  :search-input="{
                    placeholder: 'بحث باسم المنتج...',
                    icon: 'i-lucide-search',
                  }"
                  placeholder="اختر المنتج "
                  :disabled="loadingProds"
                  @update:model-value="onPickHeaderFamily"
                  clear
                  class="w-full flex-1"
                />
                <UButton
                  v-if="shortageCount > 0"
                  color="warning"
                  variant="soft"
                  icon="i-lucide-triangle-alert"
                  class="lg:w-45 w-full h-9 justify-start"
                  @click="shortagesOpen = true"
                  >الوحدات قليلة الكمية ({{ shortageCount }})</UButton
                >
              </div>
              <div v-if="!loadingProds">
                <p
                  v-if="!hasProductContent"
                  class="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-sm text-slate-500"
                >
                  اختر منتج من الأعلى لبدء إضافة الأصناف.
                </p>
                <div v-else ref="containerRef" class="space-y-3">
                  <InvoiceProductGroup
                    v-for="(group, groupIndex) in productGroups"
                    :key="group.key"
                    :title="groupTitleOf(group)"
                    :status-text="groupStatusText(group)"
                    :total-text="formatePrice(group.total)"
                    :is-empty="group.isEmpty"
                    :hide-actions="false"
                    :can-delete="productGroups.length > 1 && groupIndex > 0"
                    :sub-line-count="group.lines.length"
                    :show-move-up="groupIndex > 0"
                    :show-move-down="groupIndex < productGroups.length - 1"
                    :default-collapsed="groupIndex > 0"
                    :family-options="productFamilyOptions"
                    :selected-family="
                      group.lines[0]
                        ? selectedFamily(group.lines[0].line)
                        : undefined
                    "
                    @pick-family="
                      (family) => onPickGroupFamily(group.key, family)
                    "
                    :wake="groupWake[group.key] ?? 0"
                    @add-subline="addSubLine(group.key)"
                    @delete="removeGroup(group.key)"
                    @move-up="moveGroupBy(group.key, -1)"
                    @move-down="moveGroupBy(group.key, 1)"
                  >
                    <template
                      v-for="(sub, subIndex) in group.lines"
                      :key="sub.line.line_id || `line-${sub.index}`"
                    >
                      <InvoiceSubLineEditor
                        v-if="isLineExpanded(sub.line)"
                        :form="sub.line"
                        :family-mode="familyModeOf(sub.line)"
                        :family-uses-variants="familyUsesVariantsOf(sub.line)"
                        :show-pack-picker="showPackPickerOf(sub.line)"
                        :variant-options="variantOptions(sub.line)"
                        :selected-variant="selectedVariantOption(sub.line)"
                        :pack-sizes="packSizeMenuItems(sub.line)"
                        :product-options="productMenuItems(sub.line)"
                        :selected-product="selectedProd(sub.line)"
                        :prod-search="getProdSearch(sub.line)"
                        :units="unitsOf(sub.line)"
                        :selected-unit="selectedUnit(sub.line)"
                        :show-unit-picker="
                          unitsOf(sub.line).length > 1 ||
                          (!!sub.line.product_id && !selectedUnit(sub.line))
                        "
                        :qty-label="
                          sub.line.product_id
                            ? `الكمية (المتاح ${stockNumberOf(sub.line) ?? '—'} ${selectedUnit(sub.line)?.name || ''})`
                            : 'الكمية'
                        "
                        :qty-value="qtyText(sub.line)"
                        :qty-error="qtyDraftError(sub.line)"
                        :stock-available-text="stockLabelOf(sub.line)"
                        :exceed-message="
                          qtyExceeds(sub.line) ? exceedText(sub.line) : null
                        "
                        :package-message="
                          packageExceeds(sub.line)?.message ?? null
                        "
                        :price-hint="priceHintOf(sub.line)"
                        :price-hint-text="
                          priceHintOf(sub.line) !== null
                            ? formatePrice(priceHintOf(sub.line))
                            : null
                        "
                        :show-cost="
                          authStore.role === 'admin' &&
                          !!sub.line.product_cost_price
                        "
                        :unit-cost-text="
                          formatePrice(
                            Number(sub.line.product_cost_price ?? 0) *
                              Number(sub.line.unit_factor),
                          )
                        "
                        :unavailable-hint="variantHintOf(sub.line)"
                        :line-total-text="
                          formatePrice(calcTotalOfForm(sub.line))
                        "
                        :cost-error="isCostGreaterThanPrice(sub.line)"
                        :can-remove="invoiceData.products.length > 1"
                        :show-done="isLineComplete(sub.line)"
                        @pick-variant="
                          (variant) => onPickVariant(sub.line, variant)
                        "
                        @pick-product="(prod) => onPickProduct(sub.line, prod)"
                        @update:prod-search="(v) => setProdSearch(sub.line, v)"
                        @pick-unit="(unit) => onPickUnit(sub.line, unit)"
                        @qty-input="(v) => setQtyText(sub.line, v)"
                        @qty-blur="qtyDrafts.delete(sub.line)"
                        @qty-step="(d) => changeQty(sub.line, d * 1)"
                        @qty-enter="focusLineField(sub.line.line_id, 'price')"
                        @price-enter="focusNextLineQty(sub.line)"
                        @price-input="
                          (event) => onUnitPriceInput(sub.line, event)
                        "
                        @price-change="
                          (v) => {
                            sub.line.product_price = v ?? 0;
                          }
                        "
                        @apply-price="applyCurrentPrice(sub.line)"
                        @done="doneEditingVariant(sub.line)"
                        @remove="removeLine(sub.line)"
                      />
                      <InvoiceVariantSummary
                        v-else
                        :serial="sub.index + 1"
                        :title="invoiceVariantLabel(sub.line)"
                        :qty-text="qtyText(sub.line)"
                        :unit-name="sub.line.unit_name || ''"
                        :price-text="formatePrice(sub.line.product_price)"
                        :total-text="formatePrice(calcTotalOfForm(sub.line))"
                        :can-move-up="subIndex > 0"
                        :can-move-down="subIndex < group.lines.length - 1"
                        :can-delete="invoiceData.products.length > 1"
                        :has-error="
                          !!qtyDraftError(sub.line) ||
                          qtyExceeds(sub.line) ||
                          !!packageExceeds(sub.line)
                        "
                        @edit="editVariantExclusive(group.key, sub.line)"
                        @up="moveSubLineBy(group.key, subIndex, -1)"
                        @down="moveSubLineBy(group.key, subIndex, 1)"
                        @delete="removeLine(sub.line)"
                      />
                    </template>
                  </InvoiceProductGroup>
                </div>
              </div>
              <div v-else class="space-y-3" aria-hidden="true">
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
            </section>
          </template>
          <template #payment>
            <section
              v-if="!loadingProds"
              id="invoice-payment-section"
              aria-label="الخصم والدفع"
              class="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div class="grid grid-cols-1 gap-3">
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
              <div class="mt-3 grid grid-cols-1 gap-3">
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
            </section>
          </template>
        </InvoiceDesktopLayout>

        <!-- Hidden save/print engine + print source (no visible preview) -->
        <ProductsLowStockDialog
          v-model:open="shortagesOpen"
          :products="products.list"
          :show-cost="authStore.role === 'admin'"
        />
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
      class="fixed inset-x-0 bottom-0 z-30 mb-[calc(3.5rem+env(safe-area-inset-bottom))] border-t border-gray-200 bg-white/95 backdrop-blur lg:mb-0 lg:pb-0"
    >
      <div
        class="mx-auto flex w-full max-w-400 items-center gap-2 px-3 py-2 sm:px-4"
      >
        <div class="min-w-0 flex-1 text-start leading-tight">
          <div class="truncate text-xs text-gray-500">الإجمالي</div>
          <div class="truncate text-lg font-bold tabular-nums text-gray-900">
            <bdi dir="ltr">{{ formatePrice(totalOfInvoice) }}</bdi>
          </div>
        </div>
        <UButton
          icon="i-lucide-save"
          color="success"
          size="lg"
          class="min-h-11 min-w-11 justify-center text-xs sm:text-sm"
          :loading="saving"
          aria-label="حفظ وفاتورة جديدة"
          @click="saveAndNew"
          >حفظ وجديد</UButton
        >
        <UButton
          icon="i-lucide-printer"
          color="neutral"
          variant="soft"
          size="lg"
          class="min-h-11 min-w-11 justify-center text-xs sm:text-sm"
          :loading="saving"
          :disabled="saving"
          aria-label="حفظ وطباعة"
          @click="saveAndPrint"
          >حفظ وطباعة</UButton
        >
        <UButton
          icon="i-lucide-eye"
          color="neutral"
          variant="soft"
          size="lg"
          class="hidden min-h-11 min-w-11 justify-center lg:inline-flex"
          aria-label="معاينة الفاتورة"
          @click="previewOpen = true"
          ><span class="hidden sm:inline">معاينة</span></UButton
        >

        <UButton
          icon="i-lucide-rotate-ccw"
          color="error"
          variant="soft"
          size="lg"
          class="hidden min-h-11 min-w-11 justify-center lg:inline-flex"
          aria-label="تصفير الفاتورة"
          @click="resetConfirmOpen = true"
          ><span class="hidden sm:inline">تصفير</span></UButton
        >
      </div>
      <div
        class="flex justify-center gap-2 border-t border-slate-100 px-3 py-1 lg:hidden"
      >
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-receipt"
          @click="mobileSummaryOpen = true"
          >الملخص والدفع</UButton
        >
        <UDropdownMenu :items="mobileInvoiceActions"
          ><UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-ellipsis"
            >إجراءات أخرى</UButton
          ></UDropdownMenu
        >
      </div>
      <div class="h-[env(safe-area-inset-bottom)] sm:hidden" />
    </div>
    <div aria-hidden="true" class="h-24" />

    <USlideover
      v-model:open="mobileSummaryOpen"
      side="bottom"
      title="ملخص الفاتورة"
      description="راجع الإجمالي وانتقل إلى الخصم والدفع"
      @after:leave="onSummaryClosed"
    >
      <template #body>
        <InvoiceSummarySidebar
          :show-heading="false"
          :gross-text="formatePrice(calcTotal(invoiceData))"
          :show-discount="true"
          :discount-label="
            invoiceData.discount_percentage ? 'نسبة مئوية' : 'مبلغ ثابت'
          "
          :discount-text="formatePrice(discountAmount)"
          :net-text="formatePrice(totalOfInvoice)"
          :show-paid="true"
          :paid-text="formatePrice(invoiceData.paid_amount)"
          :remaining-text="
            formatePrice(totalOfInvoice - Number(invoiceData.paid_amount || 0))
          "
          :show-credit-used="!!invoiceData.credit_used"
          :credit-used-text="formatePrice(invoiceData.credit_used)"
        />
        <UButton color="success" block class="mt-3" @click="goToInvoicePayment"
          >تعديل الخصم والدفع</UButton
        >
      </template>
    </USlideover>

    <UiAppDialog v-model:open="previewOpen" title="معاينة الفاتورة">
      <Invoice
        :invoice-data="invoiceData"
        :opening-balance="printOpeningBalance"
        view-mode
        @close="previewOpen = false"
      />
    </UiAppDialog>
    <UiAppDialog v-model:open="resetConfirmOpen" title="تصفير الفاتورة">
      <p class="text-sm text-gray-600">
        سيتم مسح كل الأصناف والمدفوعات المدخلة والبدء من جديد. هل أنت متأكد؟
      </p>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="error"
            class="flex-1"
            @click="
              resetConfirmOpen = false;
              resetInvoice();
            "
            >تأكيد التصفير</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="flex-1"
            @click="resetConfirmOpen = false"
            >تراجع</UButton
          >
        </div>
      </template>
    </UiAppDialog>
    <UiAppDialog
      :open="leaveConfirmOpen"
      title="مغادرة الفاتورة؟"
      @update:open="
        (open) => {
          if (!open) finishNavigation(false);
        }
      "
    >
      <p class="text-sm text-slate-600">
        لديك تعديلات لم تُحفظ. ستفقدها إذا غادرت هذه الصفحة.
      </p>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="error" class="flex-1" @click="finishNavigation(true)"
            >مغادرة دون حفظ</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="flex-1"
            @click="finishNavigation(false)"
            >متابعة التعديل</UButton
          >
        </div>
      </template>
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
  <div v-else role="status" aria-live="polite">
    <span class="sr-only">جار التحقق من الجلسة وتحميل محرر الفاتورة</span>
    <UiAppTableSkeleton aria-hidden="true" />
  </div>
</template>
<script setup lang="ts">
import type { Customer, Invoice, InvoiceProductLine, Product } from "~/types";
import { toDateSafe } from "~/types";
import type { ProductUnit } from "~/types";
import { invoiceVariantLabel } from "~/utils/invoiceGrouping";

definePageMeta({ title: "إنشاء فاتورة" });
const { formatePrice, calcTotal } = useHelpers();
import {
  groupInvoiceLines,
  moveGroup as moveGroupOrder,
  moveSubLine as moveSubLineOrder,
  ensureStableLineIds,
  findDuplicateLineIds,
  invoiceGroupTitle,
  newDraftLineId,
} from "~/utils/invoiceGrouping";
const {
  unitsForProduct,
  unitSellingPrice,
  unitStockDisplay,
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
const mobileSummaryOpen = ref(false);
let focusPaymentAfterSummary = false;
const mobileInvoiceActions = [
  {
    label: "معاينة الفاتورة",
    icon: "i-lucide-eye",
    onSelect: () => {
      previewOpen.value = true;
    },
  },
  {
    label: "تصفير الفاتورة",
    icon: "i-lucide-rotate-ccw",
    color: "error" as const,
    onSelect: () => {
      resetConfirmOpen.value = true;
    },
  },
];
function goToInvoicePayment(): void {
  focusPaymentAfterSummary = true;
  mobileSummaryOpen.value = false;
}
function onSummaryClosed(): void {
  if (!focusPaymentAfterSummary) return;
  focusPaymentAfterSummary = false;
  requestAnimationFrame(() => {
    const section = document.getElementById("invoice-payment-section");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    section
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
  });
}
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
    // Stable client id for Vue keys + reorder/edit matching. The server mints
    // the persisted id on create and honors a free client id on edit.
    line_id: newDraftLineId(),
    product_name: "",
    product_price: 0,
    product_cost_price: 0,
    product_quantity: 1,
    total: 0,
    option: "",
    product_id: "",
    family_id: null,
    family_name: null,
    variant_name: null,
    variant_key: null,
    pack_size_name: null,
    inventory_mode: "convertible",
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
function draftFingerprint(): string {
  const data = invoiceData.value;
  return JSON.stringify({
    id: data.id,
    customer_id: data.customer_id,
    customer_name: data.customer_name,
    customer_phone: data.customer_phone,
    discount: data.discount,
    discount_for: data.discount_for,
    discount_percentage: data.discount_percentage,
    debt: data.debt,
    delivery_price: data.delivery_price,
    amount_of_animal_feeds: data.amount_of_animal_feeds,
    amount_of_mahros: data.amount_of_mahros,
    paid_amount: data.paid_amount,
    credit_used: data.credit_used,
    products: data.products.map((line) => ({
      line_id: line.line_id,
      product_id: line.product_id,
      family_id: line.family_id,
      variant_key: line.variant_key,
      unit_id: line.unit_id,
      product_quantity: line.product_quantity,
      product_price: line.product_price,
      option: line.option,
    })),
  });
}
const pristineFingerprint = ref(draftFingerprint());
const hasUnsavedChanges = computed(
  () => draftFingerprint() !== pristineFingerprint.value,
);
const leaveConfirmOpen = ref(false);
let pendingNavigation: ((allow: boolean) => void) | null = null;
function markDraftSaved(): void {
  pristineFingerprint.value = draftFingerprint();
}
function finishNavigation(allow: boolean): void {
  leaveConfirmOpen.value = false;
  const resolve = pendingNavigation;
  pendingNavigation = null;
  resolve?.(allow);
}
onBeforeRouteLeave(() => {
  if (!hasUnsavedChanges.value || !hydrated.value) return true;
  if (pendingNavigation) return false;
  leaveConfirmOpen.value = true;
  return new Promise<boolean>((resolve) => {
    pendingNavigation = resolve;
  });
});
function warnBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedChanges.value) return;
  event.preventDefault();
  event.returnValue = "";
}
// HOME delta: created_by select hidden (single admin) — creatorOptions unused.

// HOME delta: paid follows invoice total until the user types manually.
const blockUpdatePaidAmount = ref(false);
const creditBalance = ref(0);
const creditLoading = ref(false);
const customerDebt = ref(0);
const creditTouched = ref(false);
const creditAvailableAfterSettlement = computed(() =>
  Math.max(0, round2(creditBalance.value - customerDebt.value)),
);
const balanceError = ref(false);
const balanceCustomerId = ref<string | null>(null);
const printOpeningBalance = computed(() =>
  !balanceError.value &&
  !creditLoading.value &&
  !loadingDebt.value &&
  invoiceData.value.customer_id === balanceCustomerId.value &&
  balanceCustomerId.value
    ? {
        credit: creditAvailableAfterSettlement.value,
        debt: Math.max(0, round2(customerDebt.value - creditBalance.value)),
      }
    : null,
);
let creditRequest = 0;
async function loadBalances(id: string): Promise<void> {
  const request = ++creditRequest;
  creditBalance.value = 0;
  customerDebt.value = 0;
  balanceCustomerId.value = null;
  balanceError.value = false;
  creditTouched.value = false;
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
}
function retryBalances(): void {
  if (invoiceData.value.customer_id)
    void loadBalances(invoiceData.value.customer_id);
}
watch(
  () => invoiceData.value.customer_id,
  async (id) => {
    if (!id) {
      creditBalance.value = 0;
      customerDebt.value = 0;
      balanceCustomerId.value = null;
      balanceError.value = false;
      creditTouched.value = false;
      return;
    }
    await loadBalances(id);
  },
);
watch(
  () => invoiceData.value.credit_used,
  (value, previous) => {
    const next = Number(value || 0);
    if (
      !Number.isFinite(next) ||
      next < 0 ||
      next >
        Math.min(creditAvailableAfterSettlement.value, totalOfInvoice.value)
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
function setCreditUsed(value: number | undefined): void {
  creditTouched.value = true;
  invoiceData.value.credit_used = value ?? 0;
}
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
  [creditAvailableAfterSettlement, totalOfInvoice, creditLoading, loadingDebt],
  ([available, total]) => {
    if (
      creditTouched.value ||
      invoiceData.value.id ||
      !invoiceData.value.customer_id ||
      balanceError.value ||
      creditLoading.value ||
      loadingDebt.value
    )
      return;
    invoiceData.value.credit_used = Math.min(
      available,
      Math.max(0, round2(total)),
    );
  },
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
  expandedLines.clear();
  prodSearch.clear();
  qtyDrafts.clear();
  headerFamily.value = null;
  cashierRequestId.value = crypto.randomUUID();
  markDraftSaved();
}
// Adopt the saved id; when save+new requested, start a fresh invoice.
function onInvoiceSaved(id: unknown): void {
  if (typeof id === "string" && id) invoiceData.value.id = id;
  markDraftSaved();
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
  if (!validateStock()) {
    focusFirstInvalid();
    return;
  }
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
  if (!validateStock()) {
    focusFirstInvalid();
    return;
  }
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
  if (!validateStock()) {
    focusFirstInvalid();
    return;
  }
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
    (!data.id && credit > creditAvailableAfterSettlement.value + 0.005) ||
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
    markDraftSaved();
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
      !entry.customer_id &&
      name === String(entry.name ?? "").trim() &&
      !!phone &&
      phone === normalizePhone(entry.phone);
    if (byId || byNamePhone) sum = round2(sum + entry.totalDebt);
  }
  return sum;
}
function anyDialogOpen(): boolean {
  return (
    previewOpen.value ||
    cashierReceiptOpen.value ||
    cashierCostConfirmOpen.value ||
    resetConfirmOpen.value ||
    showCustomerModal.value
  );
}
/** Alt pressed and released alone (no combo): clicks the open line's حفظ
 *  button, else collapses every expanded row and returns to product pick. */
let altAlone = false;
function handleAltKeyup(e: KeyboardEvent): void {
  if (e.key !== "Alt") return;
  if (!altAlone) return;
  altAlone = false;
  if (anyDialogOpen()) return;
  triggerAltAction();
}
function triggerAltAction(): void {
  const openComplete = invoiceData.value.products.find(
    (line) =>
      line.product_id && isLineComplete(line) && expandedLines.has(line),
  );
  if (openComplete) {
    doneEditingVariant(openComplete);
    return;
  }
  for (const line of [...expandedLines]) expandedLines.delete(line);
  focusHeaderFamilySelect();
}
/** The invoice line containing keyboard focus, if any. */
function focusedLine(): InvoiceProductLine | undefined {
  const active = document.activeElement as HTMLElement | null;
  const holder = active?.closest?.("[data-line-id]");
  const id = holder?.getAttribute?.("data-line-id");
  return id
    ? invoiceData.value.products.find((line) => line.line_id === id)
    : undefined;
}
/** Alt+D: delete the focused line, else the first open one. */
function deleteCurrentOpenLine(): void {
  const line =
    focusedLine() ??
    invoiceData.value.products.find(
      (item) =>
        item.product_id && isLineComplete(item) && expandedLines.has(item),
    );
  if (!line) {
    notify("لا يوجد بند مفتوح للحذف.", "error");
    return;
  }
  if (invoiceData.value.products.length <= 1) {
    notify("لا يمكن حذف آخر بند في الفاتورة.", "error");
    return;
  }
  const flat = invoiceData.value.products;
  const at = flat.indexOf(line);
  removeLine(line);
  const next = flat[at] ?? flat[at - 1];
  if (next) {
    expandedLines.add(next);
    focusLineField(next.line_id, "first");
  } else {
    focusHeaderFamilySelect();
  }
}
function handleShortcuts(e: KeyboardEvent): void {
  if (!e) return;
  // Lone Alt press (release triggers the Alt action); any other key cancels it.
  // Alt repeats while held must not clear the pending lone press.
  if (e.key === "Alt" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (!e.repeat && !anyDialogOpen()) altAlone = true;
    return;
  }
  altAlone = false;
  if (anyDialogOpen() || e.repeat) return;
  // Only Alt-based shortcuts remain (AltGr excluded via ctrlKey).
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.code === "KeyS") {
    e.preventDefault();
    void saveAndNew();
    return;
  }
  if (e.code === "KeyD") {
    e.preventDefault();
    deleteCurrentOpenLine();
  }
}
const resetConfirmOpen = ref(false);
const shortagesOpen = ref(false);

/** Focus the first control of a line editor and bring it into view. */
function focusLineField(
  lineId: string | undefined,
  field: "qty" | "price" | "unit" | "first" = "first",
): void {
  if (!lineId) return;
  const line = invoiceData.value.products.find((l) => l.line_id === lineId);
  if (line) {
    expandedLines.add(line);
    const group = productGroups.value.find((entry) =>
      entry.lines.some((item) => item.line === line),
    );
    if (group) groupWake[group.key] = (groupWake[group.key] ?? 0) + 1;
  }
  nextTick(() => {
    nextTick(() => {
      const root = containerRef.value?.querySelector(
        `[data-line-id="${lineId}"]`,
      );
      if (!root) return;
      (root as HTMLElement).scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
      // "first" targets the fields grid — never the header move/delete buttons.
      // Product-less lines render no qty/price fields (progressive
      // disclosure) — fall back to the first control instead of silence.
      const target =
        field === "first"
          ? root.querySelector(".grid button, .grid input")
          : (root.querySelector(
              `[data-field="${field}"] input, [data-field="${field}"] button`,
            ) ?? root.querySelector(".grid button, .grid input"));
      const targetEl = target as HTMLElement | null;
      targetEl?.focus?.();
      // USelectMenu hands focus back to its own trigger on close, which can
      // steal ours right after a pick — retry once if focus didn't stick.
      setTimeout(() => {
        if (
          targetEl &&
          document.activeElement !== targetEl &&
          !root.contains(document.activeElement)
        ) {
          targetEl.focus?.();
        }
      }, 150);
    });
  });
}
/** After a failed validation, jump to the first offending line. */
function focusFirstInvalid(): void {
  const info = firstInvalidLine();
  if (info) {
    expandedLines.add(info.line);
    focusLineField(info.line.line_id, info.field);
  }
}
/** Focus the qty of the line after `line`, or do nothing when last. */
function focusNextLineQty(line: InvoiceProductLine): void {
  const flat = invoiceData.value.products;
  const next = flat[flat.indexOf(line) + 1];
  if (next) {
    expandedLines.add(next);
    focusLineField(next.line_id, "qty");
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

// Customer picker (USelect + search; balances load on demand after pick).
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
  return products.productsById.get(form.product_id);
}
const activeProductsByFamily = computed(() => {
  const groups = new Map<string, Product[]>();
  for (const product of products.list) {
    if (product.is_active === false || !product.family_id) continue;
    const family = groups.get(product.family_id) ?? [];
    family.push(product);
    groups.set(product.family_id, family);
  }
  return groups;
});
function activeFamilyProducts(id: string | null): Product[] {
  return id ? (activeProductsByFamily.value.get(id) ?? []) : [];
}
const productFamilyOptions = computed(() =>
  [
    ...new Map(
      products.list
        .filter(
          (product) =>
            product.is_active !== false &&
            product.family_id &&
            product.family_name,
        )
        .map((product) => [
          product.family_id as string,
          {
            id: product.family_id as string,
            name: product.family_name as string,
            uses_variants: product.uses_variants !== false,
            inventory_mode:
              product.inventory_mode === "independent"
                ? ("independent" as const)
                : ("convertible" as const),
          },
        ]),
    ),
  ]
    .map(([, family]) => family)
    .sort((left, right) => left.name.localeCompare(right.name, "ar")),
);
function selectedFamilyId(form: InvoiceProductLine): string | null {
  return form.family_id || selectedProd(form)?.family_id || null;
}
function selectedFamily(form: InvoiceProductLine):
  | {
      id: string;
      name: string;
      uses_variants: boolean;
      inventory_mode: "convertible" | "independent";
    }
  | undefined {
  const id = selectedFamilyId(form);
  return id
    ? productFamilyOptions.value.find((family) => family.id === id)
    : undefined;
}
function clearSelectedProduct(form: InvoiceProductLine): void {
  form.product_id = "";
  form.product_name = "";
  form.product_price = 0;
  form.product_cost_price = 0;
  form.variant_name = null;
  form.variant_key = null;
  form.pack_size_name = null;
  form.inventory_mode = "convertible";
  form.unit_id = undefined;
  form.unit_name = undefined;
  form.unit_factor = 1;
  form.stock_kind = undefined;
  form.allows_fractional = false;
  form.base_quantity = 0;
  form.cost_groups = undefined;
  form.component_deltas = undefined;
  form.opened_packages = undefined;
}
function onPickFamily(
  form: InvoiceProductLine,
  family: { id: string; name: string } | null | undefined,
): void {
  if (!family) {
    form.family_id = null;
    form.family_name = null;
    clearSelectedProduct(form);
    return;
  }
  form.family_id = family.id;
  form.family_name = family.name;
  if (selectedProd(form)?.family_id !== family.id) clearSelectedProduct(form);
  const options = activeFamilyProducts(family.id);
  const selected = selectedFamily(form);
  if (selected?.inventory_mode === "independent") {
    form.inventory_mode = "independent";
    if (selected.uses_variants === false) form.variant_key = "default";
    const variants = variantOptions(form);
    if (selected.uses_variants !== false && variants.length === 1)
      onPickVariant(form, variants[0]);
    const sizes = packSizeMenuItems(form);
    if (sizes.length === 1) onPickProduct(form, sizes[0]);
  } else if (options.length === 1 && options[0]?.uses_variants === false)
    onPickProduct(form, options[0]);
}
type VariantOption = { key: string; name: string };
function variantOptions(form: InvoiceProductLine): VariantOption[] {
  const options = new Map<string, VariantOption & { order: number }>();
  for (const product of activeFamilyProducts(selectedFamilyId(form))) {
    if (product.inventory_mode !== "independent") continue;
    const key = product.variant_key || "default";
    if (!options.has(key))
      options.set(key, {
        key,
        name: product.variant_name || "",
        order: Number(product.variant_order || 0),
      });
  }
  return [...options.values()].sort((left, right) => left.order - right.order);
}
function selectedVariantOption(
  form: InvoiceProductLine,
): VariantOption | undefined {
  return variantOptions(form).find((option) => option.key === form.variant_key);
}
function onPickVariant(
  form: InvoiceProductLine,
  variant?: VariantOption | null,
): void {
  clearSelectedProduct(form);
  form.inventory_mode = "independent";
  form.variant_key = variant?.key || null;
  form.variant_name = variant?.name || null;
  const sizes = packSizeMenuItems(form);
  if (sizes.length === 1) onPickProduct(form, sizes[0]);
}
function packSizeMenuItems(form: InvoiceProductLine): Product[] {
  return activeFamilyProducts(selectedFamilyId(form))
    .filter(
      (product) =>
        product.inventory_mode === "independent" &&
        (product.variant_key || "default") ===
          (form.variant_key || "default") &&
        sellableUnitsForProduct(product).length > 0 &&
        Number(product.stock_quantity ?? 0) > 0,
    )
    .sort(
      (left, right) =>
        (left.pack_size_order ?? 0) - (right.pack_size_order ?? 0),
    );
}
function unitsOf(form: InvoiceProductLine): ProductUnit[] {
  const product = selectedProd(form);
  if (!product) return [];
  return sellableUnitsForProduct(product);
}
function selectedUnit(form: InvoiceProductLine): ProductUnit | undefined {
  const options = unitsOf(form);
  return options.find((unit) => unit.id === form.unit_id);
}
function onUnitPriceInput(form: InvoiceProductLine, event: Event): void {
  const target = event.target as HTMLInputElement | null;
  if (!target || typeof target.value !== "string") return;
  const text = target.value.replace(/,/g, "").trim();
  const price = text === "" ? 0 : Number(text);
  if (Number.isFinite(price) && price >= 0) form.product_price = price;
}
function onPickUnit(form: InvoiceProductLine, unit?: ProductUnit): void {
  if (!unit) return;
  const factor = Number(unit.factor);
  if (!Number.isFinite(factor) || factor <= 0) {
    notify(
      "عدد الوحدة الأساسية في الوحدة غير صالح. راجع إعدادات النوع.",
      "error",
    );
    return;
  }
  form.unit_id = unit.id;
  form.unit_name = unit.name;
  form.unit_factor = factor;
  form.stock_kind = unit.stock_kind;
  form.allows_fractional = unit.allows_fractional === true;
  form.base_quantity = round4(Number(form.product_quantity || 0) * factor);
  const product = selectedProd(form);
  if (!invoiceData.value.id || !form.cost_groups?.length)
    form.product_cost_price = Number(product?.cost_price ?? 0);
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
      sellableUnitsForProduct(p).length > 0 &&
      p.family_id === selectedFamilyId(form) &&
      Number(p.stock_quantity ?? 0) > 0,
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
  if (real.family_id !== selectedFamilyId(form)) {
    notify("اختر النوع من المجموعة المحددة.", "error");
    return;
  }
  const wanted = Number(form.product_quantity || 0);
  const availableUnits = sellableUnitsForProduct(real);
  const selected =
    availableUnits.find((unit) => {
      const f = Number(unit.factor);
      return Number(real.stock_quantity ?? 0) / f > 0;
    }) ?? availableUnits[0];
  if (!selected) {
    notify("لا توجد وحدات بيع لهذا المنتج. راجع إعدادات وحداته.", "error");
    return;
  }
  const selFactor = Number(selected.factor);
  let needBase = round4(wanted * selFactor);
  for (const line of invoiceData.value.products) {
    if (line === form || line.product_id !== real.id) continue;
    const lf = Number(line.unit_factor);
    if (!Number.isFinite(lf) || lf <= 0) {
      notify(
        "عدد الوحدة الأساسية في وحدة أحد الأسطر غير صالح. أعد اختيار النوع والوحدة.",
        "error",
      );
      return;
    }
    needBase = round4(needBase + Number(line.product_quantity || 0) * lf);
  }
  const allowedBase = availableBaseOf(real.id ?? "");
  if (needBase - allowedBase > 1e-9) {
    notify(
      `إجمالي المطلوب يتجاوز المتاح بالمخزون. خفّض الكمية أولاً.`,
      "error",
    );
    return;
  }
  // Same product + same unit picked twice (with a real quantity): merge the
  // quantities into the existing line instead of repeating it.
  const duplicate =
    wanted > 0
      ? invoiceData.value.products.find(
          (line) =>
            line !== form &&
            line.product_id === real.id &&
            line.unit_id === selected.id,
        )
      : undefined;
  if (duplicate) {
    duplicate.product_quantity = round4(
      Number(duplicate.product_quantity || 0) + wanted,
    );
    const mergedFactor = Number(duplicate.unit_factor);
    if (Number.isFinite(mergedFactor) && mergedFactor > 0)
      duplicate.base_quantity = round4(
        duplicate.product_quantity * mergedFactor,
      );
    cleanupLineState(form);
    const at = invoiceData.value.products.indexOf(form);
    if (at !== -1) invoiceData.value.products.splice(at, 1);
    const owner = productGroups.value.find((entry) =>
      entry.lines.some(({ line }) => line === duplicate),
    );
    if (owner) editVariantExclusive(owner.key, duplicate);
    else {
      expandedLines.add(duplicate);
      focusLineField(duplicate.line_id);
    }
    notify(
      "هذا النوع مضاف بالفعل — تم دمج الكمية مع السطر الموجود.",
      "success",
    );
    return;
  }
  form.product_price = unitSellingPrice(real, selected) ?? 0;
  form.product_id = real?.id ?? "";
  form.product_cost_price = Number(real?.cost_price ?? 0);
  form.product_name = real?.name ?? "";
  form.family_id = real.family_id ?? null;
  form.family_name = real.family_name ?? null;
  form.variant_name = real.variant_name ?? real.name;
  form.variant_key = real.variant_key ?? null;
  form.pack_size_name = real.pack_size_name ?? null;
  form.inventory_mode = real.inventory_mode ?? "convertible";
  onPickUnit(form, selected);
  // Never auto-collapse: the line stays editable until the user removes it.
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
  const f = unit ? Number(unit.factor) : Number(form.unit_factor);
  if (!Number.isFinite(f) || f <= 0) {
    qtyDrafts.set(form, v);
    return;
  }
  form.base_quantity = round4(Math.max(0, n) * f);
  qtyDrafts.delete(form);
}
// Expanded/collapsed state by object identity (never persisted to Firestore).
const expandedLines = reactive(new Set<InvoiceProductLine>());
// Reserved base quantities for editing persisted invoices (product → base qty).
const originalReserved = reactive(new Map<string, number>());
const originalReservedBase = originalReserved;
function familyModeOf(
  form: InvoiceProductLine,
): "convertible" | "independent" | null {
  return selectedFamily(form)?.inventory_mode ?? form.inventory_mode ?? null;
}
function familyUsesVariantsOf(form: InvoiceProductLine): boolean {
  return selectedFamily(form)?.uses_variants ?? true;
}
function showPackPickerOf(form: InvoiceProductLine): boolean {
  if (familyModeOf(form) !== "independent") return false;
  return familyUsesVariantsOf(form) === false || !!form.variant_key;
}
function onPickGroupFamily(
  groupKey: string,
  family: { id: string; name: string } | null | undefined,
): void {
  const group = productGroups.value.find((entry) => entry.key === groupKey);
  const target = group?.lines[0]?.line;
  if (!target || !family) {
    if (target) onPickFamily(target, family);
    return;
  }
  // Retargeting an empty draft to an already-added family: join that group
  // instead of duplicating it.
  const isDraft = !target.product_id;
  const existing = productGroups.value.find(
    (entry) =>
      entry.key !== groupKey &&
      entry.familyId === family.id &&
      entry.lines.some(({ line }) => line.product_id),
  );
  if (isDraft && existing) {
    notify("هذا المنتج مضاف بالفعل — تم الانتقال إليه.", "info");
    scrollToGroupAndExpand(existing.key);
    return;
  }
  onPickFamily(target, family);
}
/** One-line hint for sellable variants hidden only by zero stock (H6). */
function hiddenVariantHintOf(form: InvoiceProductLine): string | null {
  const count = hiddenVariantCountOf(form);
  return count > 0 ? `${count} نوع غير ظاهر لنفاد مخزونه` : null;
}
function hiddenVariantCountOf(form: InvoiceProductLine): number {
  const familyId = selectedFamilyId(form);
  if (!familyId) return 0;
  if (familyModeOf(form) === "independent") {
    if (familyUsesVariantsOf(form) !== false && !form.variant_key) return 0;
    const key = form.variant_key || "default";
    const all = products.list.filter(
      (p) =>
        p.is_active !== false &&
        p.family_id === familyId &&
        p.inventory_mode === "independent" &&
        (p.variant_key || "default") === key &&
        sellableUnitsForProduct(p).length > 0,
    );
    return all.filter((p) => !(Number(p.stock_quantity ?? 0) > 0)).length;
  }
  if (familyUsesVariantsOf(form) === false) return 0;
  const all = products.list.filter(
    (p) =>
      p.is_active !== false &&
      p.family_id === familyId &&
      sellableUnitsForProduct(p).length > 0,
  );
  return all.filter((p) => !(Number(p.stock_quantity ?? 0) > 0)).length;
}
/** A variant is complete when it has a product, a valid unit and a usable
 *  quantity with no pending draft — same rules as validateStock, per line. */
function isLineComplete(line: InvoiceProductLine): boolean {
  if (!line.product_id) return false;
  if (qtyDrafts.has(line)) return false;
  if (
    !Number.isFinite(Number(line.product_quantity)) ||
    Number(line.product_quantity) <= 0
  )
    return false;
  if (
    !selectedUnit(line) ||
    !Number.isFinite(Number(line.unit_factor)) ||
    Number(line.unit_factor) <= 0
  )
    return false;
  return true;
}
function isLineExpanded(line: InvoiceProductLine): boolean {
  if (!line.product_id && !line.family_id) return true;
  if (!isLineComplete(line)) return true;
  return expandedLines.has(line);
}
/** Open one completed variant, collapse the other completed ones in the
 *  same group — inputs are never lost, only hidden to summaries. */
function editVariantExclusive(
  groupKey: string,
  line: InvoiceProductLine,
): void {
  const group = productGroups.value.find((entry) => entry.key === groupKey);
  if (group) {
    for (const { line: other } of group.lines) {
      if (other !== line && isLineComplete(other)) expandedLines.delete(other);
    }
  }
  expandedLines.add(line);
  focusLineField(line.line_id);
}
/** «تم»: collapse a finished variant, keep it open with an error otherwise. */
function doneEditingVariant(line: InvoiceProductLine): void {
  if (!isLineComplete(line)) {
    notify("أكمل النوع والوحدة والكمية قبل طي البند.", "error");
    focusLineField(line.line_id);
    return;
  }
  expandedLines.delete(line);
  addSubLine(`family:${line.family_id || ""}`);
}
/** Short group status for the header (counts only, amounts stay in badge). */
function groupStatusText(group: {
  lines: { line: InvoiceProductLine }[];
  isEmpty: boolean;
}): string | null {
  if (group.isEmpty) return "اختر المنتج الرئيسي";
  const total = group.lines.length;
  const done = group.lines.filter(({ line }) => isLineComplete(line)).length;
  if (done === total)
    return total === 1 ? "بند واحد مكتمل" : `${total} بنود مكتملة`;
  return `${done} من ${total} مكتملة`;
}
/** Combined hint: hidden-by-stock notice or empty-search notice. */
function variantHintOf(line: InvoiceProductLine): string | null {
  const hidden = hiddenVariantHintOf(line);
  if (hidden) return hidden;
  const q = getProdSearch(line).trim();
  if (q && line.family_id && productMenuItems(line).length === 0)
    return "لا توجد نتائج مطابقة للبحث.";
  return null;
}
// Live stock info per line (reactive to store + typed qty).
// Canonical: one base balance per product; needs aggregate across ALL units.
function stockLabelOf(form: InvoiceProductLine): string {
  const product = products.list.find((item) => item.id === form.product_id);
  if (!product) return "—";
  return stockQuantityLabel(product);
}
function stockNumberOf(form: InvoiceProductLine): number | null {
  const product = selectedProd(form);
  const unit = selectedUnit(form);
  if (!product?.inventory || !unit) return null;
  return unitStockDisplay(product, unit);
}
const needBaseByProduct = computed(() => {
  const need = new Map<string, number>();
  for (const line of invoiceData.value.products) {
    if (!line.product_id) continue;
    const f = Number(line.unit_factor);
    if (!Number.isFinite(f) || f <= 0) {
      need.set(line.product_id, Number.POSITIVE_INFINITY);
      continue;
    }
    need.set(
      line.product_id,
      round4(
        (need.get(line.product_id) ?? 0) +
          Number(line.product_quantity || 0) * f,
      ),
    );
  }
  return need;
});
function availableBaseOf(productId: string): number {
  const product = products.list.find((p) => p.id === productId);
  return round4(
    Number(product?.stock_quantity ?? 0) +
      (originalReservedBase.get(productId) ?? 0),
  );
}
function exceedsByProduct(
  productId: string,
  _unitId: string | null | undefined,
): { need: number; available: number } | null {
  if (!productId) return null;
  const need = needBaseByProduct.value.get(productId) ?? 0;
  const available = availableBaseOf(productId);
  return need - available > 1e-9 ? { need, available } : null;
}
function qtyExceeds(form: InvoiceProductLine): boolean {
  return form.product_id
    ? exceedsByProduct(form.product_id, form.unit_id) !== null
    : false;
}
function packageExceeds(form: InvoiceProductLine): { message: string } | null {
  const unit = selectedUnit(form);
  if (!form.product_id || !unit || unit.stock_kind !== "package") return null;
  const product = selectedProd(form);
  if (!product?.inventory)
    return { message: "رصيد العبوات غير متاح؛ حدّث بيانات النوع قبل الحفظ." };
  const current = Number(product.inventory.closed_packages[unit.id] ?? 0);
  const reversed = Number(
    invoiceData.value.inventory_effects?.[form.product_id]?.closed_packages?.[
      unit.id
    ] ?? 0,
  );
  const available = Math.max(0, current - reversed);
  const requested = invoiceData.value.products.reduce((sum, line) => {
    if (line.product_id !== form.product_id || line.unit_id !== unit.id)
      return sum;
    return sum + Number(line.product_quantity || 0);
  }, 0);
  return requested - available > 1e-9
    ? {
        message: `المتاح ${available} ${unit.name} مغلقة للبيع، والمطلوب ${requested}.`,
      }
    : null;
}
/** Visible error for a quantity draft that never parsed (empty/invalid). */
function qtyDraftError(form: InvoiceProductLine): string | null {
  if (!qtyDrafts.has(form)) return null;
  const text = String(qtyDrafts.get(form) ?? "").trim();
  if (text === "") return "أدخل الكمية قبل الحفظ.";
  return "الكمية المدخلة غير صالحة. صحّحها قبل الحفظ.";
}
function exceedText(form: InvoiceProductLine): string {
  const info = form.product_id
    ? exceedsByProduct(form.product_id, form.unit_id)
    : null;
  if (!info) return "";
  const product = products.list.find((item) => item.id === form.product_id);
  if (!product) return "الكمية المطلوبة تتجاوز المخزون المتاح.";
  return `إجمالي المطلوب ${info.need} ${product.base_unit_name || "وحدة أساسية"} يتجاوز المتاح ${info.available} ${product.base_unit_name || "وحدة أساسية"}.`;
}
function firstInvalidLine(): {
  line: InvoiceProductLine;
  field: "qty" | "unit";
} | null {
  const lines = invoiceData.value.products;
  const hit =
    lines.find((item) => item.product_id && qtyDrafts.has(item)) ??
    lines.find(
      (item) =>
        item.product_id &&
        (!Number.isFinite(Number(item.product_quantity)) ||
          Number(item.product_quantity) <= 0),
    ) ??
    lines.find((item) => item.product_id && packageExceeds(item) !== null) ??
    lines.find(
      (item) =>
        item.product_id &&
        selectedUnit(item)?.allows_fractional !== true &&
        !Number.isInteger(Number(item.product_quantity)),
    ) ??
    lines.find((item) => item.product_id && qtyExceeds(item));
  if (hit) return { line: hit, field: "qty" };
  const unitHit = lines.find(
    (item) =>
      item.product_id &&
      (!selectedUnit(item) ||
        !Number.isFinite(Number(item.unit_factor)) ||
        Number(item.unit_factor) <= 0),
  );
  return unitHit ? { line: unitHit, field: "unit" } : null;
}
function validateStock(): boolean {
  // A visible draft that never became a valid quantity must block the save —
  // never persist the stale valid value while the user sees another one.
  const pendingDraft = invoiceData.value.products.find(
    (item) => item.product_id && qtyDrafts.has(item),
  );
  if (pendingDraft) {
    notify("إحدى الكميات المدخلة غير صالحة. صحّحها قبل الحفظ.", "error");
    return false;
  }
  const duplicates = findDuplicateLineIds(invoiceData.value.products);
  if (duplicates.length) {
    notify(
      "تكرار في هوية بنود الفاتورة. أعد تحميل الفاتورة وحاول مجددًا.",
      "error",
    );
    return false;
  }
  const nonPositive = invoiceData.value.products.find(
    (item) =>
      item.product_id &&
      (!Number.isFinite(Number(item.product_quantity)) ||
        Number(item.product_quantity) <= 0),
  );
  if (nonPositive) {
    notify("أدخل كمية أكبر من صفر لكل صنف قبل الحفظ.", "error");
    return false;
  }
  const invalidUnitLine = invoiceData.value.products.find(
    (item) =>
      item.product_id &&
      (!selectedUnit(item) ||
        !Number.isFinite(Number(item.unit_factor)) ||
        Number(item.unit_factor) <= 0),
  );
  if (invalidUnitLine) {
    notify("اختر وحدة صالحة لكل نوع قبل الحفظ.", "error");
    return false;
  }
  const packageLine = invoiceData.value.products.find(
    (item) => packageExceeds(item) !== null,
  );
  if (packageLine) {
    notify(
      packageExceeds(packageLine)?.message ||
        "العبوات المغلقة المتاحة لا تكفي للبيع.",
      "error",
    );
    return false;
  }
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
  const f = Number(form.unit_factor);
  if (!Number.isFinite(f) || f <= 0) return;
  form.base_quantity = round4(form.product_quantity * f);
  qtyDrafts.delete(form);
}
function stepOf(form: InvoiceProductLine): number {
  return selectedUnit(form)?.allows_fractional === true ? 0.01 : 1;
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

// ---- Product-group view (derived; the flat list stays the source of truth)
const productGroups = computed(() =>
  groupInvoiceLines(invoiceData.value.products),
);
// Section-title product entry: picking creates a group or revisits one.
type HeaderFamilyOption = {
  id: string;
  name: string;
  uses_variants: boolean;
  inventory_mode: "convertible" | "independent";
};
const headerFamily = ref<HeaderFamilyOption | null>(null);
const headerFamilyRef = ref<unknown>(null);
/** The product body stays hidden until a main product is chosen. */
const hasProductContent = computed(() =>
  invoiceData.value.products.some((l) => !!l.family_id || !!l.product_id),
);
/** Focus the section-title product picker (the single entry for products). */
function focusHeaderFamilySelect(): void {
  nextTick(() => {
    const root = (
      headerFamilyRef.value as { $el?: HTMLElement } | null | undefined
    )?.$el;
    root?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    const target = root?.querySelector?.("button, input") as HTMLElement | null;
    target?.focus?.();
  });
}
/** Families already on the invoice (header «مضاف بالفعل» tag). */
function isFamilyAdded(familyId: string): boolean {
  return invoiceData.value.products.some((l) => l.family_id === familyId);
}
/** Header dropdown items: already-added families carry a warning tag. */
const headerFamilyOptions = computed(() =>
  productFamilyOptions.value.map((family) => ({
    ...family,
    name: isFamilyAdded(family.id)
      ? `${family.name} — مضاف بالفعل`
      : family.name,
  })),
);
/** Wake signal per group: parent forces an existing group open on revisit. */
const groupWake = reactive<Record<string, number>>({});
/** Scroll to an existing group, open it and its first line for editing. */
function scrollToGroupAndExpand(groupKey: string): void {
  groupWake[groupKey] = (groupWake[groupKey] ?? 0) + 1;
  const group = productGroups.value.find((entry) => entry.key === groupKey);
  const first =
    group?.lines.find(({ line }) => line.product_id)?.line ??
    group?.lines[0]?.line;
  if (first) {
    expandedLines.add(first);
    focusLineField(first.line_id);
  }
}
/** Section-title pick: assign to the fresh draft or prepend a new group. */
function onPickHeaderFamily(
  family: { id: string; name: string } | null | undefined,
): void {
  if (!family) return;
  headerFamily.value = null;
  const canonical =
    productFamilyOptions.value.find((f) => f.id === family.id) ?? family;
  // Draft already started for this family: continue it.
  const sameDraft = invoiceData.value.products.find(
    (l) => !l.product_id && l.family_id === canonical.id,
  );
  if (sameDraft) {
    expandedLines.add(sameDraft);
    focusLineField(sameDraft.line_id);
    return;
  }
  // Family already added: scroll to it and expand instead of duplicating.
  const existing = productGroups.value.find(
    (g) =>
      g.familyId === canonical.id &&
      g.lines.some(({ line }) => line.product_id),
  );
  if (existing) {
    notify("هذا المنتج مضاف بالفعل — تم الانتقال إليه.", "info");
    scrollToGroupAndExpand(existing.key);
    return;
  }
  const blank = invoiceData.value.products.find(
    (l) => !l.product_id && !l.family_id,
  );
  if (blank) {
    for (const line of invoiceData.value.products) {
      if (isLineComplete(line)) expandedLines.delete(line);
    }
    onPickFamily(blank, canonical);
    expandedLines.add(blank);
    focusLineField(blank.line_id);
    return;
  }
  const prods = invoiceData.value.products;
  const stuck = prods.findIndex((l) => !l.product_id);
  if (stuck > -1) {
    invoiceData.value.products.splice(stuck, 1);
  }
  for (const line of invoiceData.value.products) {
    if (isLineComplete(line)) expandedLines.delete(line);
  }
  const line = emptyLine();
  invoiceData.value.products.unshift(line);
  expandedLines.add(line);
  onPickFamily(line, canonical);
  focusLineField(line.line_id);
}

function groupTitleOf(group: {
  familyName: string | null;
  lines: { line: InvoiceProductLine }[];
}): string {
  return invoiceGroupTitle(group as never);
}

function cleanupLineState(form: InvoiceProductLine): void {
  expandedLines.delete(form);
  prodSearch.delete(form);
  qtyDrafts.delete(form);
}

/** Add a «نوع / وحدة» sub-line inside an existing family group. */
function addSubLine(groupKey: string): void {
  const group = productGroups.value.find((entry) => entry.key === groupKey);
  if (!group) return;
  const first = group.lines[0]?.line;
  const existingEmpty = group.lines.find(({ line }) => !line.product_id)?.line;
  if (existingEmpty) {
    editVariantExclusive(groupKey, existingEmpty);
    return;
  }
  // Collapse finished variants so a single open editor stays on top.
  for (const { line } of group.lines) {
    if (isLineComplete(line)) expandedLines.delete(line);
  }
  const line = emptyLine();
  line.family_id = first?.family_id ?? null;
  line.family_name = first?.family_name ?? null;
  line.inventory_mode = first?.inventory_mode ?? "convertible";
  // Prepend at the TOP of this group's variants (never the bottom).
  const firstIndex = group.lines[0]?.index ?? invoiceData.value.products.length;
  invoiceData.value.products.splice(firstIndex, 0, line);
  expandedLines.add(line);
  focusLineField(line.line_id);
}

/** Delete a whole family group (two-step confirm lives in the component). */
function removeGroup(groupKey: string): void {
  const group = productGroups.value.find((entry) => entry.key === groupKey);
  if (!group) return;
  const doomed = new Set(group.lines.map(({ line }) => line));
  for (const line of doomed) cleanupLineState(line);
  invoiceData.value.products = invoiceData.value.products.filter(
    (line) => !doomed.has(line),
  );
  if (!invoiceData.value.products.length) {
    const line = emptyLine();
    invoiceData.value.products = [line];
    expandedLines.add(line);
  }
}

function moveGroupBy(groupKey: string, delta: number): void {
  const groups = productGroups.value;
  const from = groups.findIndex((entry) => entry.key === groupKey);
  if (from < 0) return;
  invoiceData.value.products = moveGroupOrder(
    invoiceData.value.products,
    from,
    from + delta,
  );
}

function moveSubLineBy(groupKey: string, from: number, delta: number): void {
  invoiceData.value.products = moveSubLineOrder(
    invoiceData.value.products,
    groupKey,
    from,
    from + delta,
  );
}

/** Legacy lines without line_id get position-based ids matching the server
 *  `legacy-N` fallback; new drafts keep their stable `draft-*` ids. */
function backfillLineIds(lines: InvoiceProductLine[]): InvoiceProductLine[] {
  lines.forEach((line, index) => {
    if (!line.line_id) line.line_id = `legacy-${index}`;
  });
  return ensureStableLineIds(lines);
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
    const loaded = await products.fetchProducts(undefined, force);
    if (loaded && updatePrices) updateProdsPrices();
  } finally {
    loadingProds.value = false;
  }
}
async function retryInvoiceProducts(): Promise<void> {
  if (authStore.role === "admin") {
    products.stopInventorySubscription();
    products.ensureInventorySubscription();
  }
  await loadProds(false, true);
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
        const uf = Number(unit.factor);
        if (!Number.isFinite(uf) || uf <= 0) return;
        item.unit_factor = uf;
        item.stock_kind = unit.stock_kind;
        item.allows_fractional = unit.allows_fractional === true;
        item.product_price = unitSellingPrice(prod, unit) ?? 0;
        item.base_quantity = round4(Number(item.product_quantity || 0) * uf);
      }
      // Never rewrite historical line costs of a persisted invoice (§1.2).
      if (!preserveHistoricalCosts) {
        item.product_cost_price = Number(prod.cost_price ?? 0);
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
      line.product_cost_price = Number(product.cost_price ?? 0);
      line.product_name = product.name;
      line.unit_name = unit.name;
      const uf = Number(unit.factor);
      if (!Number.isFinite(uf) || uf <= 0) continue;
      line.unit_factor = uf;
      line.stock_kind = unit.stock_kind;
      line.allows_fractional = unit.allows_fractional === true;
      line.base_quantity = round4(Number(line.product_quantity || 0) * uf);
      line.family_id = product.family_id ?? null;
      line.family_name = product.family_name ?? null;
      line.variant_name = product.variant_name ?? product.name;
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
        if (!line.product_id) continue;
        const f = Number(line.unit_factor);
        if (!Number.isFinite(f) || f <= 0) continue;
        originalReserved.set(
          line.product_id,
          round4(
            (originalReserved.get(line.product_id) ?? 0) +
              Number(line.product_quantity || 0) * f,
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
      products: backfillLineIds(
        src.products?.length ? src.products : [emptyLine()],
      ),
    };
    invoices.invoiceToEdit = undefined;
    markDraftSaved();
    setTimeout(() => {
      if (totalOfInvoice.value != invoiceData.value.paid_amount) {
        blockUpdatePaidAmount.value = true;
      } else {
        blockUpdatePaidAmount.value = false;
      }
    }, 100);
  }
  /** A mouse press or window blur cancels a pending lone-Alt press. */

  // Listeners first: shortcuts must work (and unmount cleanly) even while
  // the initial loads are still pending.
  window.addEventListener("keydown", handleShortcuts);
  window.addEventListener("keyup", handleAltKeyup);
  window.addEventListener("pointerdown", cancelAltAlone);
  window.addEventListener("blur", cancelAltAlone);
  window.addEventListener("beforeunload", warnBeforeUnload);
  await Promise.allSettled([loadCustomers(), loadProds()]);
});
function cancelAltAlone(): void {
  altAlone = false;
}
onUnmounted(() => {
  window.removeEventListener("keydown", handleShortcuts);
  window.removeEventListener("keyup", handleAltKeyup);
  window.removeEventListener("pointerdown", cancelAltAlone);
  window.removeEventListener("blur", cancelAltAlone);
  window.removeEventListener("beforeunload", warnBeforeUnload);
});
</script>
