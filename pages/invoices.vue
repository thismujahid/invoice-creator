<template>
  <ClientOnly>
  <CashierInvoices v-if="authStore.role === 'cashier'" />
  <div v-else class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">الفواتير</h2>
      <!-- HOME delta: debts actions (pay-all + totals gate) + export. -->
      <div v-if="activeTab === 'sales'" class="flex flex-wrap gap-2">
        <UButton
          v-if="isFilteredInvoicesContainsDebts"
          icon="i-lucide-hand-coins"
          color="success"
          :disabled="loading"
          :loading="isPayingFull"
          @click="payFull(isFilteredInvoicesContainsDebts)"
          >سداد جميع الفواتير المعروضة</UButton
        >
        <UButton
          icon="i-lucide-download"
          color="info"
          variant="soft"
          :loading="exporting"
          :disabled="loading"
          @click="() => handleSuccess(true)"
          >تصدير البيانات</UButton
        >
      </div>
    </div>
    <div class="mb-4 flex gap-2 border-b border-gray-200 pb-2" role="tablist" aria-label="أقسام الفواتير">
      <UButton role="tab" :aria-selected="activeTab === 'sales'" :color="activeTab === 'sales' ? 'success' : 'neutral'" :variant="activeTab === 'sales' ? 'solid' : 'soft'" @click="activeTab = 'sales'">فواتير البيع</UButton>
      <UButton role="tab" :aria-selected="activeTab === 'returns'" :color="activeTab === 'returns' ? 'success' : 'neutral'" :variant="activeTab === 'returns' ? 'solid' : 'soft'" @click="activeTab = 'returns'">سجل المرتجعات</UButton>
    </div>
    <div v-show="activeTab === 'sales'">
    <div class="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <UInput
        v-model="searchText"
        placeholder="بحث في كل الفواتير بالاسم أو الهاتف"
        icon="i-lucide-search"
        size="lg"
        class="w-full"
      />
      <USelect
        v-model="paid_amount_filter"
        :items="debtsFilterOptions"
        value-key="value"
        placeholder="الديون"
        size="lg"
        class="w-full"
      />
      <div class="flex gap-2">
        <UiAppDateField
          v-model="selectedDate"
          label="تاريخ الفاتورة"
          class="flex-1"
        />
        <UButton
          v-if="selectedDate"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="flex shrink-0 items-center justify-center"
          aria-label="مسح التاريخ"
          @click="selectedDate = null"
        />
      </div>
    </div>
    <UiAppStatsSkeleton v-if="statsLoading" />
    <UAlert v-else-if="statsError" color="error" variant="soft" class="mb-3" title="تعذر تحميل مؤشرات المبيعات.">
      <template #actions><UButton size="xs" color="error" variant="soft" @click="loadInvoiceStats">إعادة المحاولة</UButton></template>
    </UAlert>
    <UAlert v-else-if="!statsReady" color="warning" variant="soft" class="mb-3" title="إجماليات الفواتير تحتاج تهيئة من أدوات المدير في صفحة الخزنة." />
    <div v-else class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ formatePrice(netSalesOf(invoiceStats)) }}
            </div>
            <div class="text-xs text-gray-500">صافي المبيعات بعد المرتجعات{{ selectedDate ? " في اليوم المحدد" : "" }}</div>
            <div v-if="invoiceStats.returns_total" class="text-xs text-gray-400">الأصلي {{ formatePrice(invoiceStats.total_sales) }} ج · المرتجعات {{ formatePrice(invoiceStats.returns_total) }} ج</div>
          </div>
          <UIcon
            name="i-lucide-banknote"
            class="size-8 shrink-0 text-blue-500"
          />
        </div>
      </UCard>
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg" :class="invoiceStats.total_profit < 0 ? 'text-red-700' : ''">
              {{ formatePrice(Math.abs(invoiceStats.total_profit)) }}
            </div>
            <div class="text-xs text-gray-500">{{ invoiceStats.total_profit < 0 ? 'مجمل خسارة البضاعة' : 'مجمل ربح البضاعة' }}</div>
          </div>
          <UIcon
            :name="invoiceStats.total_profit < 0 ? 'i-lucide-trending-down' : 'i-lucide-trending-up'"
            class="size-8 shrink-0"
            :class="invoiceStats.total_profit < 0 ? 'text-red-500' : 'text-emerald-500'"
          />
        </div>
      </UCard>
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ formatePrice(invoiceStats.outstanding_customer_debt) }}
            </div>
            <div class="text-xs text-gray-500">إجمالي المديونية</div>
          </div>
          <UIcon
            name="i-lucide-trending-down"
            class="size-8 shrink-0 text-red-500"
          />
        </div>
      </UCard>
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ invoiceStats.invoice_count }}
            </div>
            <div class="text-xs text-gray-500">عدد الفواتير</div>
          </div>
          <UIcon
            name="i-lucide-files"
            class="size-8 shrink-0 text-emerald-600"
          />
        </div>
      </UCard>
      <UCard variant="outline">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-base font-bold sm:text-lg">
              {{ formatePrice(netCollectedOf(invoiceStats.total_paid, cashRefundTotal)) }}
            </div>
            <div class="text-xs text-gray-500">صافي المدفوع بعد رد النقد</div>
          </div>
          <UIcon name="i-lucide-wallet" class="size-8 shrink-0 text-blue-500" />
        </div>
      </UCard>
    </div>
    <div
      v-if="hasCustomerFilter"
      class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2"
    >
      <UIcon name="i-lucide-user" class="size-4 shrink-0 text-blue-600" />
      <span class="min-w-0 flex-1 truncate text-sm font-semibold text-blue-900">
        فواتير: {{ customerFilter.name || customerFilter.id }}
        <span v-if="customerFilter.phone" class="font-normal text-blue-600" dir="ltr">
          ({{ customerFilter.phone }})
        </span>
      </span>
      <UButton
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-lucide-x"
        @click="resetCustomerFilter"
      >
        مسح الفلتر وعرض الكل
      </UButton>
    </div>
    <UAlert v-if="loadError" color="error" variant="soft" class="mb-3" :title="loadError">
      <template #actions>
        <UButton size="xs" color="error" variant="soft" :loading="loading" @click="() => loadInvoices(true)">إعادة المحاولة</UButton>
      </template>
    </UAlert>
    <UiAppTableSkeleton v-if="loading" />
    <template v-else>
      <!-- Desktop table -->
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th class="p-2 text-start font-medium">الأسم</th>
              <th class="p-2 text-start font-medium">الهاتف</th>
              <th class="p-2 text-start font-medium">عدد المنتجات</th>
              <th class="p-2 text-start font-medium">الإجمالي</th>
              <th class="p-2 text-start font-medium">المتبقى</th>
              <th class="p-2 text-start font-medium" title="صافي بيع البضاعة بعد الخصم والمرتجعات مطروحًا منه تكلفتها التاريخية">الربح/الخسارة</th>
              <th class="p-2 text-start font-medium">تاريخ الإنشاء</th>
              <th class="p-2 text-start font-medium">الأدوات</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in paginateArray"
              :key="row.id"
              class="border-b border-gray-100 last:border-0 hover:bg-gray-50"
            >
              <td class="p-2 font-medium">
                {{ row.name }}
                <UBadge v-if="row.invoice.status === 'cancelled'" color="error" variant="soft" size="xs" class="ms-1">ملغاة</UBadge>
                <UBadge v-if="row.returnBadge" color="warning" variant="soft" size="xs" class="ms-1">{{ row.returnBadge }} · {{ formatePrice(row.returnTotal) }} ج</UBadge>
                <UBadge v-if="row.hasPreviousBalance" color="info" variant="soft" size="xs" class="ms-1">يشمل رصيدًا سابقًا</UBadge>
              </td>
              <td class="p-2 text-gray-600" dir="ltr">{{ row.phone }}</td>
              <td class="p-2">{{ row.products_count }}</td>
              <td class="p-2 font-semibold">{{ row.total }}<span v-if="row.returnBadge" class="block text-xs font-normal text-gray-500">الأصلي {{ row.originalTotal }}</span></td>
              <td class="p-2 text-red-600">{{ formatePrice(row.debt) }}</td>
              <td class="p-2 font-semibold" :class="row.profitValue < 0 ? 'text-red-600' : 'text-emerald-600'">
                {{ row.profitValue < 0 ? 'خسارة' : '' }} {{ formatePrice(Math.abs(row.profitValue)) }}
              </td>
              <td class="p-2 text-gray-600">{{ row.created_at }}</td>
              <td class="p-2">
                <div class="flex gap-1.5">
                  <UTooltip
                    v-if="row.invoice.status !== 'cancelled' && outstandingDebtOf(row.invoice) > 0"
                    text="سداد الفاتورة بالكامل"
                    ><UButton
                      icon="i-lucide-hand-coins"
                      color="success"
                      variant="soft"
                      size="xs"
                      :loading="payingFullInvoiceId === row.invoice.id"
                      :disabled="isPayingFull"
                      aria-label="سداد الفاتورة بالكامل"
                      @click="payFull([row.invoice])"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="نسخ الفاتورة"
                    ><UButton
                      icon="i-lucide-copy"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="نسخ الفاتورة"
                      @click="copyInvoiceForEdit(row.invoice, true)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip v-if="row.invoice.status !== 'cancelled' && !row.invoice.credit_used" text="تعديل الفاتورة"
                    ><UButton
                      icon="i-lucide-pencil"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="تعديل الفاتورة"
                      @click="copyInvoiceForEdit(row.invoice, false)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="عرض الفاتورة"
                    ><UButton
                      icon="i-lucide-eye"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="عرض الفاتورة"
                      @click="openView(row)"
                      class="flex items-center justify-center"
                    /></UTooltip>
                  <UTooltip v-if="row.invoice.status !== 'cancelled'" text="إنشاء مرتجع"
                    ><UButton
                      icon="i-lucide-undo-2"
                      color="warning"
                      variant="soft"
                      size="xs"
                      aria-label="إنشاء مرتجع"
                      @click="openReturn(row.invoice)"
                      class="flex items-center justify-center"
                    /></UTooltip>
                  <UTooltip v-if="row.invoice.status !== 'cancelled'" text="إلغاء الفاتورة"
                    ><UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="soft"
                      size="xs"
                      aria-label="حذف"
                      @click="confirmDelete = row"
                      class="flex items-center justify-center"
                  /></UTooltip>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-files"
          title="لا يوجد فواتير مسجلة بالمستخدم الحالي حتى الأن"
        />
      </div>
      <!-- Mobile cards -->
      <div class="grid gap-2 md:hidden">
        <UCard
          v-for="row in paginateArray"
          :key="row.id"
          variant="outline"
          @click="openView(row)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-bold">{{ row.name }}</div>
              <UBadge v-if="row.invoice.status === 'cancelled'" color="error" variant="soft" size="xs" class="mt-0.5">فاتورة ملغاة</UBadge>
              <UBadge v-if="row.returnBadge" color="warning" variant="soft" size="xs" class="mt-0.5">{{ row.returnBadge }} · {{ formatePrice(row.returnTotal) }} ج</UBadge>
              <UBadge v-if="row.hasPreviousBalance" color="info" variant="soft" size="xs" class="mt-0.5">{{ "يشمل رصيدًا سابقًا" }}</UBadge>
              <div class="text-xs text-gray-500" dir="ltr">{{ row.phone }}</div>
              <div class="mt-1 text-xs text-gray-500">
                {{ row.created_at }} • {{ row.products_count }} منتجات
              </div>
              <div class="mt-1 font-bold text-emerald-700">{{ row.total }}<span v-if="row.returnBadge" class="block text-xs font-normal text-gray-500">الأصلي {{ row.originalTotal }}</span></div>
              <div
                v-if="row.debt"
                class="mt-0.5 text-xs font-semibold text-red-600"
              >
                المتبقي: {{ formatePrice(row.debt) }}
              </div>
              <div class="mt-0.5 text-xs font-semibold" :class="row.profitValue < 0 ? 'text-red-600' : 'text-emerald-600'">
                {{ row.profitValue < 0 ? 'الخسارة' : 'الربح' }}: {{ formatePrice(Math.abs(row.profitValue)) }}
              </div>
            </div>
            <div class="flex shrink-0 gap-1.5" @click.stop>
              <UButton
                v-if="row.invoice.status !== 'cancelled' && outstandingDebtOf(row.invoice) > 0"
                icon="i-lucide-hand-coins"
                color="success"
                variant="soft"
                size="xs"
                aria-label="سداد"
                @click="payFull([row.invoice])"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-copy"
                color="success"
                variant="soft"
                size="xs"
                aria-label="نسخ"
                @click="copyInvoiceForEdit(row.invoice, true)"
                class="flex items-center justify-center"
              />
              <UButton
                v-if="row.invoice.status !== 'cancelled' && !row.invoice.credit_used"
                icon="i-lucide-pencil"
                color="success"
                variant="soft"
                size="xs"
                aria-label="تعديل"
                @click="copyInvoiceForEdit(row.invoice, false)"
                class="flex items-center justify-center"
              />
              <UButton
                v-if="row.invoice.status !== 'cancelled'"
                icon="i-lucide-undo-2"
                color="warning"
                variant="soft"
                size="xs"
                aria-label="مرتجع"
                @click="openReturn(row.invoice)"
                class="flex items-center justify-center"
              />
              <UButton
                v-if="row.invoice.status !== 'cancelled'"
                icon="i-lucide-trash-2"
                color="error"
                variant="soft"
                size="xs"
                aria-label="حذف"
                @click="confirmDelete = row"
                class="flex items-center justify-center"
              />
            </div>
          </div>
        </UCard>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-files"
          title="لا يوجد فواتير مسجلة بالمستخدم الحالي حتى الأن"
        />
      </div>
    </template>
    <div class="mt-3 flex items-center justify-between gap-2">
      <USelect v-model="currentPerPage" :items="[25, 50, 100]" size="sm" class="w-24" />
      <div class="flex items-center gap-2"><span class="text-xs text-gray-500">صفحة {{ currentPage }}</span><div class="flex gap-2" dir="ltr"><UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-left" aria-label="الصفحة التالية" :disabled="loading || !hasMoreInvoices" @click="nextInvoicePage" /><UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-right" aria-label="الصفحة السابقة" :disabled="loading || currentPage <= 1" @click="previousInvoicePage" /></div></div>
    </div>
    <!-- View invoice -->
    <UiAppDialog v-model:open="viewOpen" title="عرض الفاتورة">
      <div
        v-if="viewRow"
        class="invoice-creator-view max-h-[80vh] overflow-auto"
      >
        <USkeleton v-if="viewReturnsLoading" class="h-64 w-full" />
        <Invoice v-else
          class="mx-auto"
          :view-mode="true"
          :returns="viewReturns"
          :invoice-data="{
            ...viewRow.invoice,
            date: viewRow.created_at_object,
            time: viewRow.created_at_object,
          }"
          @close="viewRow = null"
        />
        <UAlert v-if="viewReturnsError" color="error" variant="soft" class="mt-3" :title="viewReturnsError" />
      </div>
    </UiAppDialog>
    <UiAppDialog v-model:open="deleteOpen" title="تأكيد إلغاء الفاتورة">
      <p class="mb-4 text-gray-600">
        سيتم إلغاء الفاتورة الخاصة بـ {{ confirmDelete?.name }} وعكس أثرها على المخزون والخزنة.
      </p>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton
            color="error"
            block
            :loading="deleting"
            @click="deleteConfirmed"
            >إلغاء الفاتورة</UButton
          >
          <UButton
            color="neutral"
            variant="ghost"
            block
            :disabled="deleting"
            @click="confirmDelete = null"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
    <!-- Create return -->
    <UiAppDialog v-model:open="returnOpen" title="إنشاء مرتجع" width="sm:max-w-3xl">
      <div v-if="returnInvoice" class="max-h-[70vh] space-y-4 overflow-y-auto" dir="rtl">
        <USkeleton v-if="returnLoading" class="h-48 w-full" />
        <template v-else>
        <div class="grid gap-2 rounded-xl bg-gray-50 p-3 text-sm sm:grid-cols-3">
          <div><span class="block text-xs text-gray-500">العميل</span><strong>{{ returnInvoice.customer_name }}</strong></div>
          <div><span class="block text-xs text-gray-500">الدين على الفاتورة</span><strong>{{ formatePrice(outstandingDebtOf(returnInvoice)) }} ج</strong></div>
          <div><span class="block text-xs text-gray-500">رصيد محفوظ للعميل</span><strong>{{ formatePrice(returnCreditBalance) }} ج</strong></div>
        </div>
        <div class="space-y-2"><h3 class="text-sm font-bold">الأصناف المراد إرجاعها</h3>
        <div v-for="r in returnRows" :key="r.key" class="grid items-center gap-2 rounded-xl border border-gray-200 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_13rem_7rem]">
          <div class="min-w-0"><div class="font-semibold">{{ formatInvoiceLineName(r.product_name, r.unit_name) }}</div><div class="text-xs text-gray-500">المتاح {{ r.maxQty }} · سعر البيع {{ formatePrice(r.unit_price) }} ج</div></div>
          <UFormField label="الكمية"><UInputNumber v-model="r.qty" :min="0" :max="r.maxQty" :step="r.allows_fractional ? 0.0001 : 1" size="lg" class="w-full" /></UFormField>
          <UFormField label="سيعود إلى المخزون كـ">
            <USelect :model-value="returnComponentKey(r)" :items="returnComponentOptions(r)" value-key="value" label-key="label" class="w-full" @update:model-value="(key) => setReturnComponent(r, String(key))" />
            <p v-if="returnComponentError(r)" class="mt-1 text-xs text-red-600">{{ returnComponentError(r) }}</p>
          </UFormField>
          <div class="text-sm"><span class="block text-xs text-gray-500">قيمة المرتجع</span><strong>{{ formatePrice(previewRefund(r)) }} ج</strong></div>
        </div></div>
        <UEmpty v-if="!returnRows.length" icon="i-lucide-undo-2" title="لا توجد أصناف قابلة للإرجاع" />
        <div class="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
          <h3 class="text-sm font-bold">تسوية المرتجع</h3>
          <div class="grid gap-2 text-sm sm:grid-cols-2"><div>إجمالي المرتجع <strong class="float-end">{{ formatePrice(returnPreviewTotal) }} ج</strong></div><div>تخفيض دين الفاتورة <strong class="float-end">{{ formatePrice(returnPreviewSplit.debtReduction) }} ج</strong></div><div v-if="returnPreviewSplit.creditRestored">إعادة رصيد استُخدم في الشراء <strong class="float-end">{{ formatePrice(returnPreviewSplit.creditRestored) }} ج</strong></div><div>المتاح للرد نقدًا أو حفظه <strong class="float-end">{{ formatePrice(returnPreviewSplit.settlement) }} ج</strong></div></div>
          <UFormField label="المبلغ الذي سيُرد نقدًا الآن"><UInputNumber v-model="returnCashRefund" :min="0" :max="returnPreviewSplit.settlement" :step="0.01" class="w-full" /></UFormField>
          <p class="text-sm font-semibold text-emerald-800">سيُحفظ للعميل: {{ formatePrice(returnPreviewSplit.creditIssued + returnPreviewSplit.creditRestored) }} ج · النقد الخارج: {{ formatePrice(returnCashRefund || 0) }} ج</p>
          <p class="text-xs text-gray-600">يمكن استخدام الرصيد في فاتورة لاحقة دون تغيير قيمة المبيعات.</p>
        </div>
        <UFormField label="ملاحظة"><UInput v-model="returnNote" placeholder="اختياري" size="lg" class="w-full" /></UFormField>
        <p v-if="returnError" class="text-sm font-semibold text-red-600">{{ returnError }}</p>
        </template>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="warning" class="min-h-11 flex-1" :loading="returnBusy" :disabled="returnLoading || returnBusy || !returnRows.some((row) => row.qty > 0 && !returnComponentError(row)) || returnRows.some((row) => row.qty > 0 && returnComponentError(row)) || returnCashRefund > returnPreviewSplit.settlement" icon="i-lucide-undo-2" @click="submitReturn">تأكيد المرتجع</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="returnBusy" @click="returnOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
    </div>
    <ReturnJournal v-if="activeTab === 'returns'" />
  </div>
  <template #fallback><UiAppTableSkeleton /></template>
  </ClientOnly>
</template>

<script setup lang="ts">
import type { Invoice } from "~/types";
import { toDateSafe } from "~/types";
import type { ReturnRow } from "~/composables/useInvoiceReturns";
import type { InvoiceReturn } from "~/types/finance";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import { collection, doc, getAggregateFromServer, getDoc, query, sum, where } from "firebase/firestore";
import { cairoDayStart, invoiceDayKey, netCollectedOf, netSalesOf } from "~/composables/invoiceStats";

definePageMeta({ title: "الفواتير" });
const activeTab = ref<"sales" | "returns">("sales");
const route = useRoute();
const authStore = useAuth();
const { db } = useFirebase();
// HOME delta: debts filter replaces the creator filter.
const paid_amount_filter = ref<number | null>(null);
const debtsFilterOptions = [
  { label: "الكل", value: null },
  { label: " فواتير ذات ديون", value: 1 },
];
const isPayingFull = ref(false);
const payingFullInvoiceId = ref<string | null>(null);
const selectedDate = ref<Date | null>(null);
const searchText = ref<string>("");
const currentPage = ref(1);
const currentPerPage = ref(25);
const invoiceCursors = ref<(QueryDocumentSnapshot | null)[]>([null]);
const hasMoreInvoices = ref(false);
const loading = ref(true);
const loadError = ref("");
// Customer filter lives in local state (not the URL): incoming
// ?customer_id=&customer_name=&customer_phone= links are consumed once,
// applied, then stripped so the URL stays clean and shareable.
const customerFilter = ref({ id: "", name: "", phone: "" });
const hasCustomerFilter = computed(
  () => customerFilter.value.id !== "" || customerFilter.value.name !== "",
);

function readCustomerQuery(): { id: string; name: string; phone: string } {
  const q = route.query;
  return {
    id: typeof q.customer_id === "string" ? q.customer_id : "",
    name: typeof q.customer_name === "string" ? q.customer_name : "",
    phone: typeof q.customer_phone === "string" ? q.customer_phone : "",
  };
}

function stripCustomerQuery(): void {
  if (
    route.query.customer_id === undefined &&
    route.query.customer_name === undefined &&
    route.query.customer_phone === undefined
  ) {
    return;
  }
  const q = { ...route.query };
  delete q.customer_id;
  delete q.customer_name;
  delete q.customer_phone;
  void navigateTo({ path: route.path, query: q }, { replace: true });
}

function resetCustomerFilter(): void {
  customerFilter.value = { id: "", name: "", phone: "" };
  stripCustomerQuery();
  void loadInvoices(true);
}
const exporting = ref(false);
const deleting = ref(false);
const statsLoading = ref(true);
const statsReady = ref(false);
const statsError = ref(false);
const invoiceStats = ref({ total_sales: 0, returns_total: 0, total_paid: 0, outstanding_customer_debt: 0, total_profit: 0, invoice_count: 0 });
const cashRefundTotal = ref(0);
let statsRequest = 0;

async function loadInvoiceStats(): Promise<void> {
  const request = ++statsRequest;
  statsLoading.value = true;
  statsError.value = false;
  try {
    const statsRef = selectedDate.value
      ? doc(db, "invoice_stats_daily", invoiceDayKey({ date: selectedDate.value }) as string)
      : doc(db, "store_stats", "current");
    const snapshot = await getDoc(statsRef);
    if (request !== statsRequest) return;
    if (!snapshot.exists()) {
      statsReady.value = false;
      invoiceStats.value = { total_sales: 0, returns_total: 0, total_paid: 0, outstanding_customer_debt: 0, total_profit: 0, invoice_count: 0 };
      cashRefundTotal.value = 0;
      return;
    }
    const data = snapshot.data();
    statsReady.value = selectedDate.value !== null || data.initialized === true;
    if (!statsReady.value) {
      invoiceStats.value = { total_sales: 0, returns_total: 0, total_paid: 0, outstanding_customer_debt: 0, total_profit: 0, invoice_count: 0 };
      cashRefundTotal.value = 0;
      return;
    }
    invoiceStats.value = {
      total_sales: Number(data.total_sales) || 0,
      returns_total: Number(data.returns_total) || 0,
      total_paid: Number(data.total_paid) || 0,
      outstanding_customer_debt: Number(data.outstanding_customer_debt ?? data.outstanding_debt) || 0,
      total_profit: Number(data.total_profit) || 0,
      invoice_count: Math.max(0, Math.floor(Number(data.invoice_count) || 0)),
    };
    const returns = collection(db, "invoice_returns");
    const dayKey = selectedDate.value ? invoiceDayKey({ date: selectedDate.value }) : null;
    let returnsQuery = query(returns);
    if (dayKey) {
      const nextDay = new Date(Date.UTC(Number(dayKey.slice(0, 4)), Number(dayKey.slice(5, 7)) - 1, Number(dayKey.slice(8, 10)) + 1)).toISOString().slice(0, 10);
      returnsQuery = query(returns, where("created_at", ">=", cairoDayStart(dayKey)), where("created_at", "<", cairoDayStart(nextDay)));
    }
    const refunds = await getAggregateFromServer(returnsQuery, { cashRefund: sum("cash_refund") });
    if (request !== statsRequest) return;
    cashRefundTotal.value = Number(refunds.data().cashRefund) || 0;
  } catch (error) {
    if (request !== statsRequest) return;
    console.error(error);
    statsReady.value = false;
    statsError.value = true;
    cashRefundTotal.value = 0;
  } finally {
    if (request === statsRequest) statsLoading.value = false;
  }
}

// Native date input applies immediately.
watch(selectedDate, () => {
  void loadInvoices(true);
  void loadInvoiceStats();
});
watch(paid_amount_filter, () => { void loadInvoices(true); });
watch(currentPerPage, () => { void loadInvoices(true); });
// Server-side search across ALL Firestore invoices (not just the loaded
// page): debounced so every keystroke doesn't fire a query round-trip.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchText, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void loadInvoices(true);
  }, 400);
});

// HOME delta: settle debts in full (single or bulk) — preserved from home.
async function payFull(listInvs: Invoice[] | null | undefined) {
  // Same UX as before, now atomic + ledger-logged via debt payments (F18/F19).
  const list = (listInvs ?? []).filter((inv) => inv.id && outstandingDebtOf(inv) > 0);
  if (!list.length || isPayingFull.value) return;
  isPayingFull.value = true;
  payingFullInvoiceId.value = list.length === 1 ? String(list[0]?.id) : null;
  try {
    await customerStore.fetchCustomers();
    const groups = new Map<string, Invoice[]>();
    for (const inv of list) {
      const key = debtsApi.customerKeyOf({
        customer_id: inv.customer_id,
        customer_phone: inv.customer_phone,
        customer_name: inv.customer_name,
      });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(inv);
    }
    for (const [, invs] of groups) {
      const first = invs[0];
      if (!first) continue;
      const legacyCustomer = customerStore.list.find((customer) =>
        String(customer.name || "").trim().toLocaleLowerCase() === String(first.customer_name || "").trim().toLocaleLowerCase() &&
        String(customer.phone ?? "").replace(/\D/g, "") === String(first.customer_phone ?? "").replace(/\D/g, ""),
      );
      const customer_id = first.customer_id || legacyCustomer?.id;
      if (!customer_id) {
        notifyToast("تعذر ربط الفاتورة القديمة بسجل العميل. لم يتم تسجيل السداد.", "error");
        return;
      }
      const allocations = invs.map((inv) => ({ type: "invoice" as const, reference_id: inv.id as string, amount: outstandingDebtOf(inv) }));
      const res = await debtsApi.payDebts({
        customer_id,
        amount: round2(allocations.reduce((sum, item) => sum + item.amount, 0)),
        allocations,
      });
      if (!res.ok) {
        notifyToast(res.error, "error");
        return;
      }
    }
    notifyToast("تم تسجيل السداد وتحديث الخزنة.", "success");
    await Promise.all([loadInvoices(), loadInvoiceStats()]);
  } finally {
    isPayingFull.value = false;
    payingFullInvoiceId.value = null;
  }
}

function formatTimestamp(
  seconds: number | undefined,
  returnObject?: false,
): string;
function formatTimestamp(seconds: number | undefined, returnObject: true): Date;
function formatTimestamp(
  seconds: number | undefined,
  returnObject?: boolean,
): string | Date {
  if (seconds === undefined || seconds === null)
    return returnObject ? new Date(0) : "-";
  const date = new Date(seconds * 1000);
  if (returnObject) return date;
  const formattedDate = date.toLocaleDateString("ar-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("ar-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formattedDate} ${formattedTime}`;
}
const { formatePrice, calcTotal, formatInvoiceLineName } = useHelpers();
const { round2, round4, netRatioOf, splitCustomerReturn, outstandingDebtOf, lineBaseQuantity, merchandiseProfitOf } = useFinance();
const invoicesStore = useInvoicesStore();
const customerStore = useCustomersStore();
const returnsApi = useInvoiceReturns();
const returnTotals = ref<Record<string, number>>({});
const returnProfitAdjustments = ref<Record<string, number>>({});
const viewReturns = ref<InvoiceReturn[]>([]);
const viewReturnsLoading = ref(false);
const viewReturnsError = ref("");
let viewReturnsRequest = 0;
const productsStore = useProductsStore();
const debtsApi = useDebts();
const { notify: notifyToast } = useAppToast();
// HOME delta: debts/profit math (preserved from home branch).
const toNum = (num: unknown): number => {
  return num && typeof num !== "number" ? Number(num) : (num as number) || 0;
};
const calcInvTotal = (inv: Invoice): number => merchandiseProfitOf(inv);
const isFilteredInvoicesContainsDebts = computed<Invoice[] | null>(() => {
  if (searchText.value) {
    return filteredInvoices.value.some((i) => outstandingDebtOf(i) > 0)
      ? filteredInvoices.value
      : null;
  } else return null;
});
const filteredInvoices = computed<Invoice[]>(() => invoicesStore.list);
function discountAmount(invoice: Invoice): number {
  if (invoice.discount && invoice.discount_percentage) {
    return (calcTotal(invoice) * Number(invoice.discount)) / 100;
  }
  return Number(invoice.discount || 0);
}
const sortedInvoices = computed<Invoice[]>(() =>
  [...filteredInvoices.value].sort((a, b) => {
    const da = toDateSafe(a.date)?.getTime() ?? 0;
    const db = toDateSafe(b.date)?.getTime() ?? 0;
    return db - da;
  }),
);
const paginateArray = computed(() => {
  return sortedInvoices.value.map((invoice) => {
    const cancelled = invoice.status === "cancelled";
    const profitValue = cancelled ? 0 : round2(calcInvTotal(invoice) - (returnProfitAdjustments.value[invoice.id || ""] ?? 0));
    return {
      id: invoice.id,
      name: invoice.customer_name,
      phone: invoice.customer_phone,
      products_count: invoice.products?.length || 0,
      total: formatePrice(cancelled ? 0 : round2(calcTotal(invoice) - discountAmount(invoice) - (returnTotals.value[invoice.id || ""] ?? 0))),
      originalTotal: formatePrice(calcTotal(invoice) - discountAmount(invoice)),
      // HOME delta: debt + profit columns replace the creator column.
      debt: cancelled ? 0 : outstandingDebtOf(invoice),
      profitValue,
      returnBadge: returnBadgeFor(invoice),
      returnTotal: returnTotals.value[invoice.id || ""] ?? 0,
      hasPreviousBalance: Number(invoice.debt ?? 0) > 0,
      created_at: formatTimestamp(
        (invoice.date as { seconds?: number })?.seconds,
      ),
      invoice,
      created_at_object: formatTimestamp(
        (invoice.date as { seconds?: number })?.seconds,
        true,
      ),
    };
  });
});
// FLAG [B1-FIXED]: clone before stripping id — never mutate the store row.
// NOTE: Firestore Timestamp class instances are NOT structuredClone-able
// (DataCloneError), so unwrap Vue reactivity with toRaw() and fall back
// to JSON on failure. Dates/Timestamps survive as ISO strings or
// {seconds,nanoseconds} plain objects — both handled by toDateSafe().
async function copyInvoiceForEdit(source: Invoice, stripId: boolean): Promise<void> {
  if (!stripId && source.id) {
    try {
      invoicesStore.invoiceToEdit = await callStaff<{ id: string }, Invoice>("getCashierInvoice", { id: source.id });
      await navigateTo("/");
    } catch { notifyToast("تعذر فتح الفاتورة للتعديل. أعد المحاولة.", "error"); }
    return;
  }
  const raw = toRaw(source) as Invoice;
  let clone: Invoice;
  try {
    clone = structuredClone(raw);
  } catch {
    clone = JSON.parse(JSON.stringify(raw)) as Invoice;
  }
  if (stripId) delete clone.id;
  invoicesStore.invoiceToEdit = clone;
  navigateTo("/");
}
function invoiceFilters() {
  return {
    remaining: paid_amount_filter.value ?? undefined,
    date: selectedDate.value ?? undefined,
    customer_id: customerFilter.value.id || undefined,
    customer_name: customerFilter.value.name || undefined,
    customer_phone: customerFilter.value.phone || undefined,
    search: searchText.value.trim() || undefined,
  };
}
async function loadInvoices(reset = false) {
  loading.value = true;
  loadError.value = "";
  try {
    if (reset) { currentPage.value = 1; invoiceCursors.value = [null]; }
    const page = await invoicesStore.fetchInvoicePage(invoiceFilters(), invoiceCursors.value[currentPage.value - 1] ?? null, currentPerPage.value);
    invoicesStore.list = page.items;
    try {
      const records = await returnsApi.fetchForInvoices(page.items.map((invoice) => invoice.id || ""));
      const totals: Record<string, number> = {};
      const profits: Record<string, number> = {};
      for (const record of records) {
        totals[record.invoice_id] = round2((totals[record.invoice_id] ?? 0) + toNum(record.total_refund));
        if (record.items?.length && record.items.every((item) => Number.isFinite(Number(item.original_unit_cost)) && Number.isFinite(Number(item.base_quantity ?? item.quantity)))) {
          const returnedCost = record.items.reduce((sum, item) => sum + Number(item.original_unit_cost) * Number(item.base_quantity ?? item.quantity), 0);
          profits[record.invoice_id] = round2((profits[record.invoice_id] ?? 0) + toNum(record.total_refund) - returnedCost);
        }
      }
      returnTotals.value = totals;
      returnProfitAdjustments.value = profits;
    } catch (error) {
      console.error(error);
      returnTotals.value = {};
      returnProfitAdjustments.value = {};
      loadError.value = "تعذر تحميل قيم المرتجعات. حدّث الصفحة للمحاولة مجددًا.";
    }
    hasMoreInvoices.value = page.hasMore;
    if (page.cursor) invoiceCursors.value[currentPage.value] = page.cursor;
    if (page.error) loadError.value = page.error;
  } finally {
    loading.value = false;
  }
}
async function nextInvoicePage(): Promise<void> { if (!hasMoreInvoices.value || loading.value) return; currentPage.value += 1; await loadInvoices(); }
async function previousInvoicePage(): Promise<void> { if (currentPage.value <= 1 || loading.value) return; currentPage.value -= 1; await loadInvoices(); }
// Deep-links from the customers page arrive as URL query while staying on
// this route: adopt them into local state, then strip them from the URL.
watch(() => [route.query.customer_id, route.query.customer_name, route.query.customer_phone], () => {
  const next = readCustomerQuery();
  if (!next.id && !next.name && !next.phone) return; // stripped or unrelated
  const cur = customerFilter.value;
  if (next.id === cur.id && next.name === cur.name && next.phone === cur.phone) return;
  customerFilter.value = next;
  stripCustomerQuery();
  void loadInvoices(true);
});
type InvoiceRow = {
  id?: string;
  name: string | null;
  phone?: string | number | null;
  products_count: number;
  total: string;
  debt: string | number | null;
  profitValue: number;
  returnBadge: string;
  returnTotal: number;
  hasPreviousBalance: boolean;
  created_at: string;
  invoice: Invoice;
  created_at_object: Date;
};
function returnBadgeFor(inv: Invoice): string {
  if (inv.status === "cancelled") return "فاتورة ملغاة";
  if (inv.return_status === "full") return "مرتجع كلي";
  if (inv.return_status === "partial") return "مرتجع جزئي";
  return "";
}
const viewRow = ref<InvoiceRow | null>(null);
async function openView(row: InvoiceRow): Promise<void> {
  viewRow.value = row;
  viewReturns.value = [];
  viewReturnsError.value = "";
  viewReturnsLoading.value = false;
  const request = ++viewReturnsRequest;
  if (!row.returnBadge || !row.id) return;
  viewReturnsLoading.value = true;
  try {
    const records = await returnsApi.fetchForInvoices([row.id]);
    if (request === viewReturnsRequest) viewReturns.value = records.sort((a, b) => (toDateSafe(b.created_at)?.getTime() ?? 0) - (toDateSafe(a.created_at)?.getTime() ?? 0));
  } catch {
    if (request === viewReturnsRequest) viewReturnsError.value = "تعذر تحميل سجل المرتجعات.";
  } finally {
    if (request === viewReturnsRequest) viewReturnsLoading.value = false;
  }
}
const viewOpen = computed({
  get: () => viewRow.value !== null,
  set: (v: boolean) => {
    if (!v) viewRow.value = null;
  },
});
const confirmDelete = ref<InvoiceRow | null>(null);
const deleteOpen = computed({
  get: () => confirmDelete.value !== null,
  set: (v: boolean) => {
    if (!v) confirmDelete.value = null;
  },
});
async function deleteConfirmed() {
  const id = confirmDelete.value?.id;
  if (!id) return;
  deleting.value = true;
  try {
    const res = await invoicesStore.deleteInvoice(id);
    if (res.blocked) return; // guard message already shown; keep dialog open
    confirmDelete.value = null;
  } catch (err) {
    authStore.snackBarColor = "error";
    authStore.snackBarText = String(err);
  } finally {
    await Promise.all([loadInvoices(), loadInvoiceStats()]);
    deleting.value = false;
  }
}
async function handleSuccess(isSuccess: boolean) {
  if (!isSuccess) {
    return;
  }
  exporting.value = true;
  try {
    const allFiltered = await invoicesStore.fetchInvoicesForExport(invoiceFilters());
    const queryText = searchText.value.trim().toLocaleLowerCase();
    const matching = queryText ? allFiltered.filter((invoice) => `${invoice.customer_name ?? ""} ${invoice.customer_phone ?? ""}`.toLocaleLowerCase().includes(queryText)) : allFiltered;
    const records = await returnsApi.fetchForInvoices(matching.map((invoice) => invoice.id || ""));
    const res = await invoicesStore.exportInvoicesToExcel(matching, records);
    authStore.snackBarText = res;
    authStore.snackBarColor = "success";
  } catch (err) {
    authStore.snackBarText = String(err);
    authStore.snackBarColor = "error";
  } finally {
    exporting.value = false;
  }
}
// Return dialog state (F11).
const returnInvoice = ref<Invoice | null>(null);
const returnRows = ref<ReturnRow[]>([]);
const returnNote = ref("");
const returnError = ref("");
const returnBusy = ref(false);
const returnLoading = ref(false);
const returnCashRefund = ref(0);
const returnCreditBalance = ref(0);
const returnOpen = computed({
  get: () => returnInvoice.value !== null,
  set: (v: boolean) => {
    if (!v) returnInvoice.value = null;
  },
});
async function openReturn(inv: Invoice): Promise<void> {
  returnError.value = "";
  returnNote.value = "";
  returnCashRefund.value = 0;
  returnCreditBalance.value = 0;
  returnInvoice.value = inv;
  returnRows.value = [];
  returnLoading.value = true;
  try {
    const preview = await returnsApi.previewReturn(inv.id as string);
    returnRows.value = preview.rows.filter((row) => row.maxQty > 0).map((row) => ({ ...row, qty: 0, return_bucket: "loose", return_unit_id: null }));
    returnCreditBalance.value = preview.creditBalance;
  } catch (error) {
    returnError.value = error instanceof Error ? error.message : "بيانات الوحدات أو المرتجعات غير مكتملة.";
    returnRows.value = [];
  } finally {
    returnLoading.value = false;
  }
}
function rowRefundValue(r: ReturnRow, ratio: number): number {
  const quantity = Math.min(Math.max(0, Number(r.qty) || 0), r.maxQty);
  return round2(r.unit_price * quantity * ratio);
}
function returnComponentOptions(row: ReturnRow): { label: string; value: string }[] {
  return [
    { label: `${row.inventory_mode === "independent" ? "عبوات مفردة كاملة" : "كمية مفتوحة"} · ${row.loose_unit_name || row.unit_name}`, value: "loose" },
    ...row.return_units.map((unit) => ({ label: `عبوة مغلقة · ${unit.name}`, value: `package:${unit.id}` })),
  ];
}
function returnComponentKey(row: ReturnRow): string {
  return row.return_bucket === "package" && row.return_unit_id ? `package:${row.return_unit_id}` : "loose";
}
function setReturnComponent(row: ReturnRow, value: string): void {
  row.return_bucket = value.startsWith("package:") ? "package" : "loose";
  row.return_unit_id = row.return_bucket === "package" ? value.slice("package:".length) : null;
}
function returnComponentError(row: ReturnRow): string {
  if (row.qty <= 0 || row.return_bucket !== "package") return "";
  const pack = row.return_units.find((unit) => unit.id === row.return_unit_id);
  if (!pack) return "العبوة المغلقة المختارة غير موجودة.";
  const baseQuantity = toNum(row.qty) * row.unit_factor;
  return Math.abs(baseQuantity / pack.factor - Math.round(baseQuantity / pack.factor)) > 1e-9
    ? `كمية المرتجع لا تكوّن عددًا صحيحًا من ${pack.name}. اختر كمية مناسبة أو أعدها ككمية مفتوحة.`
    : "";
}
function previewRefund(r: ReturnRow): number {
  if (!returnInvoice.value) return 0;
  return rowRefundValue(r, netRatioOf(returnInvoice.value));
}
const returnPreviewSplit = computed(() => {
  if (!returnInvoice.value) return { debtReduction: 0, creditRestored: 0, creditIssued: 0, settlement: 0, total: 0 };
  const ratio = netRatioOf(returnInvoice.value);
  const total = round2(returnRows.value.reduce((s, r) => s + rowRefundValue(r, ratio), 0));
  const split = splitCustomerReturn(total, outstandingDebtOf(returnInvoice.value), Number(returnInvoice.value.credit_used || 0), Number(returnInvoice.value.credit_restored || 0), 0);
  return { ...split, cashRefund: Number(returnCashRefund.value || 0), creditIssued: Math.max(0, round2(split.settlement - Number(returnCashRefund.value || 0))), total };
});
const returnPreviewTotal = computed(() => returnPreviewSplit.value.total);
async function submitReturn(): Promise<void> {
  if (!returnInvoice.value || returnBusy.value || returnLoading.value) return;
  returnError.value = "";
  returnBusy.value = true;
  try {
      const res = await returnsApi.createReturn(
        returnInvoice.value,
        returnRows.value
          .map((r) => ({ line_id: r.line_id, quantity: r.qty, return_bucket: r.return_bucket, return_unit_id: r.return_unit_id }))
          .filter((item) => item.quantity > 0),
        returnNote.value.trim() || null,
        Number(returnCashRefund.value || 0),
      );
    if (!res.ok) {
      returnError.value = res.error;
      return;
    }
    notifyToast(
      `تم تسجيل المرتجع — تخفيض الدين: ${formatePrice(res.debtReduction)}، نقدي: ${formatePrice(res.cashRefund)}، رصيد للعميل: ${formatePrice(res.creditIssued + res.creditRestored)}.`,
      "success",
    );
    returnInvoice.value = null;
    await Promise.all([loadInvoices(), loadInvoiceStats(), productsStore.fetchProducts()]);
  } finally {
    returnBusy.value = false;
  }
}
onMounted(async () => {
  const authed = await useAuthReady();
  if (!authed) {
    loading.value = false;
    statsLoading.value = false;
    return; // layout redirects to /login
  }
  if (authStore.role === "cashier") return;
  // Consume a customer deep-link once, then clean the URL.
  customerFilter.value = readCustomerQuery();
  stripCustomerQuery();
  productsStore.ensureInventorySubscription();
  await Promise.all([loadInvoices(), loadInvoiceStats()]);
});
</script>
