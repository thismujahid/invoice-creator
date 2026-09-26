<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">دفتر الديون</h2>
      <UButton
        icon="i-lucide-hand-coins"
        color="success"
        @click="openLoan(null)"
        >إضافة سلفة</UButton
      >
    </div>
    <UInput
      v-model="searchText"
      placeholder="بحث بالاسم أو الهاتف"
      icon="i-lucide-search"
      size="lg"
      class="mb-3 w-full sm:max-w-xs"
    />
    <USkeleton v-if="loading" class="h-24 w-full" />
    <template v-else>
      <!-- Totals of the currently displayed (filtered) debts -->
      <div class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <UCard variant="outline">
          <div class="text-lg font-bold text-red-600 sm:text-xl">
            {{ formatePrice(displayed.invoiceDebts) }}
          </div>
          <div class="text-xs text-gray-500">ديون الفواتير المعروضة</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-red-600 sm:text-xl">
            {{ formatePrice(displayed.loanDebts) }}
          </div>
          <div class="text-xs text-gray-500">إجمالي السلف</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-red-700 sm:text-xl">
            {{ formatePrice(displayed.totalDebts) }}
          </div>
          <div class="text-xs text-gray-500">إجمالي ديون الفواتير والسلف</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">
            {{ displayed.debtors }}
          </div>
          <div class="text-xs text-gray-500">عدد أصحاب الديون المعروضين</div>
        </UCard>
      </div>
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th class="p-2 text-start font-medium">اسم العميل</th>
              <th class="p-2 text-start font-medium">الهاتف</th>
              <th class="p-2 text-start font-medium">فواتير غير مسددة</th>
              <th class="p-2 text-start font-medium">ديون الفواتير</th>
              <th class="p-2 text-start font-medium">السلف</th>
              <th class="p-2 text-start font-medium">إجمالي الدين</th>
              <th class="p-2 text-start font-medium">الأدوات</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in paged"
              :key="c.key"
              class="border-b border-gray-100 last:border-0 hover:bg-gray-50"
            >
              <td class="p-2 font-medium">{{ c.name }}</td>
              <td class="p-2 text-gray-600" dir="ltr">{{ c.phone ?? "—" }}</td>
              <td class="p-2">{{ c.unpaidCount }}</td>
              <td class="p-2">{{ formatePrice(c.invoiceDebt) }}</td>
              <td class="p-2">{{ formatePrice(c.loanDebt) }}</td>
              <td class="p-2 font-bold text-red-600">
                {{ formatePrice(c.totalDebt) }}
              </td>
              <td class="p-2">
                <div class="flex gap-1.5">
                  <UTooltip text="عرض التفاصيل"
                    ><UButton
                      icon="i-lucide-eye"
                      color="neutral"
                      variant="soft"
                      size="xs"
                      aria-label="عرض التفاصيل"
                      @click="openDetails(c)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="تسديد دفعة"
                    ><UButton
                      icon="i-lucide-hand-coins"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="تسديد دفعة"
                      @click="openPay(c)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="إضافة سلفة"
                    ><UButton
                      icon="mdi-plus"
                      color="info"
                      variant="soft"
                      size="xs"
                      aria-label="إضافة سلفة"
                      @click="openLoan(c)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="عرض السلف"
                    ><UButton
                      icon="i-lucide-wallet"
                      color="neutral"
                      variant="soft"
                      size="xs"
                      aria-label="عرض السلف"
                      @click="openLoansRow(c)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="سجل السداد"
                    ><UButton
                      icon="i-lucide-history"
                      color="neutral"
                      variant="soft"
                      size="xs"
                      aria-label="سجل السداد"
                      @click="openHistoryRow(c)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <UEmpty
          v-if="!paged.length"
          icon="i-lucide-notebook-text"
          title="لا توجد ديون مستحقة"
        />
      </div>
      <div class="grid gap-2 md:hidden">
        <UCard
          v-for="c in paged"
          :key="c.key"
          variant="outline"
          @click="openDetails(c)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-bold">{{ c.name }}</div>
              <div class="text-xs text-gray-500" dir="ltr">
                {{ c.phone ?? "" }}
              </div>
              <div class="mt-1 text-xs text-gray-500">
                {{ c.unpaidCount }} فواتير • سلف: {{ formatePrice(c.loanDebt) }}
              </div>
              <div class="mt-1 font-bold text-red-600">
                {{ formatePrice(c.totalDebt) }}
              </div>
            </div>
            <div
              class="flex max-w-[7.5rem] shrink-0 flex-wrap justify-end gap-1.5"
              @click.stop
            >
              <UButton
                icon="i-lucide-eye"
                color="neutral"
                variant="soft"
                size="xs"
                aria-label="عرض التفاصيل"
                @click="openDetails(c)"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-hand-coins"
                color="success"
                variant="soft"
                size="xs"
                aria-label="تسديد دفعة"
                @click="openPay(c)"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-plus"
                color="info"
                variant="soft"
                size="xs"
                aria-label="إضافة سلفة"
                @click="openLoan(c)"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-wallet"
                color="neutral"
                variant="soft"
                size="xs"
                aria-label="عرض السلف"
                @click="openLoansRow(c)"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-history"
                color="neutral"
                variant="soft"
                size="xs"
                aria-label="سجل السداد"
                @click="openHistoryRow(c)"
                class="flex items-center justify-center"
              />
            </div>
          </div>
        </UCard>
        <UEmpty
          v-if="!paged.length"
          icon="i-lucide-notebook-text"
          title="لا توجد ديون مستحقة"
        />
      </div>
    </template>
    <div class="mt-3 flex items-center justify-between gap-2">
      <USelect
        v-model="currentPerPage"
        :items="[10, 25, 50, 100]"
        size="sm"
        class="w-24"
      />
      <UPagination
        dir="ltr"
        v-model:page="currentPage"
        :total="filtered.length"
        :items-per-page="currentPerPage"
        :sibling-count="1"
        size="sm"
      />
    </div>

    <section class="mt-5 rounded-xl bg-white p-3 shadow-sm sm:p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-lg font-bold text-gray-900">ديون الموردين</h2>
          <p class="text-xs text-gray-500">فواتير الشراء التي لم يُسدَّد كامل رصيدها</p>
        </div>
        <UButton color="neutral" variant="soft" icon="i-lucide-refresh-cw" :loading="supplierLoading" @click="loadSupplierInvoices">تحديث</UButton>
      </div>
      <UInput v-model="supplierSearch" icon="i-lucide-search" placeholder="بحث باسم المورد أو مرجع الفاتورة" class="mb-3 w-full sm:max-w-sm" />
      <USkeleton v-if="supplierLoading" class="h-20 w-full" />
      <UAlert v-else-if="supplierError" color="error" variant="soft" :title="supplierError" />
      <div v-else-if="openSupplierInvoices.length" class="grid gap-2">
        <UCard v-for="invoice in openSupplierInvoices" :id="`purchase-${invoice.id}`" :key="invoice.id" variant="outline">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold">{{ invoice.supplier_name || 'مورد غير مسمى' }}</span>
                <UBadge :color="supplierInvoiceStatus(invoice) === 'paid' ? 'success' : supplierInvoiceStatus(invoice) === 'unpaid' ? 'error' : 'warning'" variant="soft">{{ SUPPLIER_STATUS_LABELS[supplierInvoiceStatus(invoice)] }}</UBadge>
              </div>
              <div class="text-xs text-gray-500">{{ invoice.supplier_ref ? `مرجع ${invoice.supplier_ref} · ` : '' }}{{ formatDateOnly(invoice.created_at) }} · {{ invoice.items?.length ?? 0 }} أصناف</div>
              <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>الإجمالي: <b>{{ formatePrice(invoice.total_amount) }} ج</b></span>
                <span>مدفوع: {{ formatePrice(invoice.paid_amount) }} ج</span>
                <span class="font-bold text-red-600">الباقي: {{ formatePrice(invoice.remaining_amount) }} ج</span>
              </div>
            </div>
            <UButton v-if="invoice.remaining_amount > 0" color="success" icon="i-lucide-hand-coins" class="min-h-11 shrink-0" @click="openSupplierPayment(invoice)">تسديد</UButton>
            <UBadge v-else color="success" variant="soft">مسددة بالكامل</UBadge>
            <UButton color="neutral" variant="soft" icon="i-lucide-history" class="min-h-11 shrink-0" :disabled="!invoice.payment_ids?.length" @click="showSupplierPayments(invoice)">سجل السداد</UButton>
          </div>
        </UCard>
      </div>
      <UEmpty v-else icon="i-lucide-circle-check" title="لا توجد ديون مستحقة للموردين" />
    </section>

    <UiAppDialog v-model:open="supplierPayOpen" :title="`تسديد فاتورة — ${supplierPayTarget?.supplier_name || 'مورد'}`">
      <div v-if="supplierPayTarget" class="space-y-3">
        <div class="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm">
          <div><span class="text-gray-500">الإجمالي</span><div class="font-bold">{{ formatePrice(supplierPayTarget.total_amount) }} ج</div></div>
          <div><span class="text-gray-500">المدفوع</span><div class="font-bold">{{ formatePrice(supplierPayTarget.paid_amount) }} ج</div></div>
          <div><span class="text-gray-500">المتبقي</span><div class="font-bold text-red-600">{{ formatePrice(supplierPayTarget.remaining_amount) }} ج</div></div>
          <div><span class="text-gray-500">رصيد الخزنة</span><div class="font-bold">{{ formatePrice(cashbox.balance) }} ج</div></div>
        </div>
        <UAlert v-if="cashbox.balance <= 0" color="warning" variant="soft" title="لا يوجد رصيد متاح في الخزنة للسداد." />
        <UFormField label="مبلغ الدفعة" required :error="supplierPaymentError || undefined" :hint="`الحد الأقصى ${formatePrice(Math.min(supplierPayTarget.remaining_amount, cashbox.balance))} ج`">
          <UInputNumber v-model="supplierPaymentAmount" :min="0" :max="Math.min(supplierPayTarget.remaining_amount, cashbox.balance)" class="w-full" />
        </UFormField>
        <div class="flex justify-between rounded-lg bg-gray-50 p-3 text-sm"><span>المتبقي بعد هذه الدفعة</span><b>{{ formatePrice(Math.max(0, supplierPayTarget.remaining_amount - (supplierPaymentAmount ?? 0))) }} ج</b></div>
        <UFormField label="ملاحظة (اختياري)"><UInput v-model="supplierPaymentNote" class="w-full" /></UFormField>
        <UAlert v-if="supplierPaymentSubmitError" color="error" variant="soft" :title="supplierPaymentSubmitError" />
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="success" class="min-h-11 flex-1" icon="i-lucide-check" :loading="supplierPaymentBusy" :disabled="!supplierPayTarget || !!supplierPaymentError || cashbox.balance <= 0" @click="submitSupplierPayment">تأكيد السداد</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="supplierPaymentBusy" @click="supplierPayOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>

    <UiAppDialog v-model:open="supplierHistoryOpen" :title="`سجل السداد — ${supplierHistoryInvoice?.supplier_name || 'مورد'}`">
      <USkeleton v-if="supplierHistoryLoading" class="h-20 w-full" />
      <UEmpty v-else-if="!supplierHistory.length" icon="i-lucide-history" title="لا توجد دفعات مسجلة" />
      <div v-else class="max-h-[65vh] space-y-2 overflow-y-auto">
        <UCard v-for="payment in supplierHistory" :key="payment.id" variant="outline">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm text-gray-500">{{ formatDateOnly(payment.created_at) }}</span>
            <b class="text-emerald-700">{{ formatePrice(payment.amount) }} ج</b>
          </div>
          <p v-if="payment.note" class="mt-1 text-xs text-gray-600">{{ payment.note }}</p>
        </UCard>
      </div>
    </UiAppDialog>

    <!-- Customer details -->
    <UiAppDialog
      v-model:open="detailsOpen"
      :title="`ديون ${selected?.name || ''}`"
    >
      <div v-if="selected" class="max-h-[70vh] space-y-4 overflow-y-auto">
        <div
          class="flex items-center justify-between rounded-lg bg-gray-50 p-2 text-sm"
        >
          <span class="text-gray-500">إجمالي الدين</span>
          <span class="font-bold text-red-600">{{
            formatePrice(selected.totalDebt)
          }}</span>
        </div>
        <div>
          <p class="mb-1.5 text-xs font-bold text-gray-400">
            الفواتير غير المسددة
          </p>
          <div v-if="!selected.invoices.length" class="text-sm text-gray-400">
            لا يوجد
          </div>
          <div
            v-for="o in selected.invoices"
            :key="o.id"
            class="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-2 text-sm"
          >
            <div class="min-w-0">
              <div class="truncate font-semibold">
                {{ formatDateOnly(o.date) }} • الإجمالي
                {{ formatePrice(o.total) }}
              </div>
              <div class="text-xs text-gray-500">
                مدفوع: {{ formatePrice(o.paid) }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <div class="font-bold text-red-600">
                {{ formatePrice(o.remaining) }}
              </div>
              <UTooltip text="عرض الفاتورة">
                <UButton
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="soft"
                  size="xs"
                  aria-label="عرض الفاتورة"
                  class="flex items-center justify-center"
                  @click="openViewInvoice(o.id)"
                />
              </UTooltip>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <UButton
            color="info"
            variant="soft"
            size="sm"
            icon="i-lucide-hand-coins"
            @click="loansOpen = true"
          >
            عرض السلف ({{ selected.loans.length }})
          </UButton>
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            icon="i-lucide-history"
            @click="openHistory()"
          >
            سجل السداد
          </UButton>
        </div>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="success"
            class="min-h-11 flex-1"
            icon="i-lucide-hand-coins"
            @click="selected && openPay(selected)"
            >تسديد دفعة</UButton
          >
          <UButton
            color="info"
            variant="soft"
            class="min-h-11 flex-1"
            icon="i-lucide-plus"
            @click="selected && openLoan(selected)"
            >سلفة جديدة</UButton
          >
        </div>
      </template>
    </UiAppDialog>

    <!-- Loans modal -->
    <UiAppDialog v-model:open="loansOpen" title="سلف العميل">
      <div v-if="selected" class="max-h-[70vh] space-y-2 overflow-y-auto">
        <div v-if="!selected.loans.length" class="text-sm text-gray-400">
          لا يوجد سلف
        </div>
        <div
          v-for="o in selected.loans"
          :key="o.id"
          class="rounded-lg border border-gray-200 p-2 text-sm"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="font-semibold">
              {{ formatDateOnly(o.date) }} • الأصل {{ formatePrice(o.total) }}
            </div>
            <div class="shrink-0 font-bold text-red-600">
              {{ formatePrice(o.remaining) }}
            </div>
          </div>
          <div
            class="mt-0.5 flex items-center justify-between gap-2 text-xs text-gray-500"
          >
            <span
              >مدفوع: {{ formatePrice(o.paid)
              }}{{ loanNoteOf(o) ? ` • ${loanNoteOf(o)}` : "" }}</span
            >
            <UBadge :color="loanStatusColor(o)" variant="soft" size="xs">{{
              loanStatusLabel(o)
            }}</UBadge>
          </div>
        </div>
      </div>
    </UiAppDialog>

    <!-- Payment history modal -->
    <UiAppDialog v-model:open="historyOpen" title="سجل السداد">
      <div class="max-h-[70vh] space-y-2 overflow-y-auto">
        <USkeleton v-if="paymentsLoading" class="h-12 w-full" />
        <div v-else-if="!payments.length" class="text-sm text-gray-400">
          لا يوجد سدادات
        </div>
        <div
          v-for="p in payments"
          :key="p.id"
          class="rounded-lg border border-gray-200 p-2 text-sm"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="font-semibold">{{ formatDateOnly(p.created_at) }}</div>
            <div class="shrink-0 font-bold text-emerald-600" dir="ltr">
              +{{ formatePrice(p.amount) }}
            </div>
          </div>
          <div class="mt-0.5 text-xs text-gray-500">
            <span v-for="(a, i) in p.allocations" :key="i"
              >{{ a.type === "invoice" ? "فاتورة" : "سلفة" }} #{{
                shortId(a.reference_id)
              }}: {{ formatePrice(a.amount)
              }}{{ i < p.allocations.length - 1 ? " • " : "" }}</span
            >
            {{ p.note ? ` • ${p.note}` : "" }}
          </div>
        </div>
      </div>
    </UiAppDialog>

    <!-- Invoice view (fetched on demand by document ID only) -->
    <UiAppDialog v-model:open="viewOpen" title="عرض الفاتورة" :z-index="700">
      <USkeleton v-if="viewLoading" class="h-48 w-full" />
      <UAlert
        v-else-if="viewError"
        color="error"
        variant="soft"
        :title="viewError"
      />
      <div
        v-else-if="viewInvoice"
        class="invoice-creator-view max-h-[80vh] overflow-auto"
      >
        <Invoice
          class="mx-auto"
          :view-mode="true"
          :invoice-data="viewInvoice"
          @close="viewInvoice = null"
        />
      </div>
    </UiAppDialog>

    <!-- Loan dialog -->
    <UiAppDialog v-model:open="loanOpen" title="إضافة سلفة">
      <div class="space-y-3">
        <UFormField label="العميل" required>
          <!-- Same controlled-from-mount rule as invoice selects (see index.vue). -->
          <USelectMenu
            :model-value="(loanCustomer ?? null) as Customer | undefined"
            :items="loanCustomerItems"
            label-key="name"
            by="id"
            v-model:search-term="loanSearch"
            :search-input="{
              placeholder: 'بحث عن عميل...',
              icon: 'i-lucide-search',
            }"
            :ignore-filter="true"
            placeholder="اختر العميل"
            class="w-full"
            @update:model-value="onPickLoanCustomer"
          />
          <FormsCustomer
            v-model="showCustomerModal"
            :refresher="loadCustomersForLoan"
            @done="onLoanCustomerCreated"
          />
        </UFormField>
        <UFormField
          label="مبلغ السلفة"
          required
          :error="loanAmountError || undefined"
        >
          <UInputNumber
            v-model="loanAmount"
            :min="0"
            placeholder="المبلغ"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UFormField label="ملاحظة">
          <UInput
            v-model="loanNote"
            placeholder="اختياري"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="loanSubmitError"
          color="error"
          variant="soft"
          :title="loanSubmitError"
        />
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="success"
            class="min-h-11 flex-1"
            :loading="loanBusy"
            icon="i-lucide-check"
            @click="submitLoan"
            >تأكيد السلفة</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="min-h-11 flex-1"
            :disabled="loanBusy"
            @click="loanOpen = false"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>

    <!-- Pay dialog -->
    <UiAppDialog
      v-model:open="payOpen"
      :title="`تسديد دفعة — ${payTarget?.name || ''}`"
      :z-index="30"
    >
      <div v-if="payTarget" class="space-y-2">
        <div class="rounded-lg bg-gray-50 p-2.5 text-sm">
          <div class="flex items-center justify-between gap-2">
            <span class="text-gray-500">إجمالي الدين الحالي</span>
            <span class="font-bold text-red-600"
              >{{ formatePrice(payTarget.totalDebt) }} ج</span
            >
          </div>
        </div>
        <UFormField
          label="المبلغ المدفوع"
          required
          :error="payAmountError || undefined"
        >
          <UInputNumber
            v-model="payAmount"
            :min="0"
            :max="payTarget.totalDebt"
            placeholder="0"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold text-gray-400">
            التوزيع على الالتزامات (الأقدم أولاً)
          </p>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-history"
            @click="autoDistribute"
            >توزيع تلقائي على الأقدم</UButton
          >
        </div>
        <div
          v-for="o in payObligations"
          :key="o.kind + o.id"
          class="flex items-center gap-2 rounded-lg border border-gray-200 p-2"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">
              {{ o.kind === "invoice" ? "فاتورة" : "سلفة" }} •
              {{ formatDateOnly(o.date) }}
            </div>
            <div class="text-xs text-gray-500">
              المتبقي: {{ formatePrice(o.remaining) }}
            </div>
          </div>
          <UTooltip v-if="o.kind === 'invoice'" text="عرض الفاتورة">
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="soft"
              size="xs"
              aria-label="عرض الفاتورة"
              class="flex shrink-0 items-center justify-center"
              @click="openViewInvoice(o.id)"
            />
          </UTooltip>
          <UInputNumber
            :model-value="payAllocs[o.kind + o.id] ?? 0"
            :min="0"
            :max="o.remaining"
            placeholder="0"
            class="w-28 shrink-0"
            @update:model-value="(v) => onAllocInput(o, v)"
          />
        </div>
        <UFormField label="ملاحظة">
          <UInput
            v-model="payNote"
            placeholder="اختياري"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <div class="space-y-1 rounded-lg bg-gray-50 p-2.5 text-sm font-bold">
          <div class="flex items-center justify-between gap-2">
            <span class="font-normal text-gray-500">إجمالي الدين</span>
            <span>{{ formatePrice(payTarget.totalDebt) }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="font-normal text-gray-500">المبلغ المدفوع</span>
            <span class="text-emerald-700">{{
              formatePrice(payAmount || 0)
            }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="font-normal text-gray-500">المبلغ الموزع</span>
            <span>{{ formatePrice(payAllocated) }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="font-normal text-gray-500">المتبقي بعد السداد</span>
            <span class="text-red-600">{{
              formatePrice(payTarget.totalDebt - payAllocated)
            }}</span>
          </div>
        </div>
        <p v-if="payError" class="text-sm font-semibold text-red-600">
          {{ payError }}
        </p>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="success"
            class="min-h-11 flex-1"
            :loading="payBusy"
            icon="i-lucide-check"
            @click="submitPay"
            >تأكيد السداد</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="min-h-11 flex-1"
            :disabled="payBusy"
            @click="payOpen = false"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Customer } from "~/types";
import type { Invoice } from "~/types";
import type { CustomerDebt, Obligation } from "~/composables/useDebts";
import type { DebtPayment, PurchaseInvoice, SupplierPayment } from "~/types/finance";
import { SUPPLIER_STATUS_LABELS, supplierInvoiceStatus } from "~/types/finance";
import { toDateSafe } from "~/types";
import { doc } from "firebase/firestore";

definePageMeta({ title: "دفتر الديون" });
const { formatePrice } = useHelpers();
const { round2, loanStatusOf, normalizePhone, normalizeName } = useFinance();
const debts = useDebts();
const customers = useCustomersStore();
const route = useRoute();
const { notify } = useAppToast();
const { db, getDoc } = useFirebase();
const purchasing = usePurchasing();
const cashbox = useCashbox();

const loading = ref(false);
const book = ref<CustomerDebt[]>([]);
const searchText = ref("");
const currentPage = ref(1);
const currentPerPage = ref(25);
const supplierInvoices = ref<PurchaseInvoice[]>([]);
const supplierSearch = ref("");
const supplierLoading = ref(false);
const supplierError = ref("");
const supplierPayOpen = ref(false);
const supplierPayTarget = ref<PurchaseInvoice | null>(null);
const supplierPaymentAmount = ref<number | undefined>(undefined);
const supplierPaymentNote = ref("");
const supplierPaymentBusy = ref(false);
const supplierPaymentSubmitError = ref("");
const supplierPaymentKey = ref("");
const supplierHistoryOpen = ref(false);
const supplierHistoryInvoice = ref<PurchaseInvoice | null>(null);
const supplierHistory = ref<SupplierPayment[]>([]);
const supplierHistoryLoading = ref(false);
const supplierPaymentError = computed(() => {
  const target = supplierPayTarget.value;
  const amount = supplierPaymentAmount.value;
  if (!target || amount === undefined || amount === null || !(amount > 0)) return "أدخل مبلغًا أكبر من صفر.";
  if (amount - target.remaining_amount > 1e-9) return "المبلغ يتجاوز باقي الفاتورة.";
  if (amount - cashbox.balance > 1e-9) return "المبلغ يتجاوز رصيد الخزنة.";
  return "";
});
const openSupplierInvoices = computed(() => {
  const query = supplierSearch.value.trim().toLocaleLowerCase();
  return supplierInvoices.value
    .filter((invoice) => !query || `${invoice.supplier_name ?? ""} ${invoice.supplier_ref ?? ""}`.toLocaleLowerCase().includes(query));
});
watch(searchText, () => {
  currentPage.value = 1;
});

const filtered = computed(() => {
  const q = searchText.value.trim();
  if (!q) return [...book.value];
  return book.value.filter(
    (c) => c.name?.includes(q) || String(c.phone ?? "").includes(q),
  );
});
const paged = computed(() => {
  const s = (currentPage.value - 1) * currentPerPage.value;
  return filtered.value.slice(s, s + currentPerPage.value);
});
// Totals of the DISPLAYED (filter-respecting) debts — not the whole book.
const displayed = computed(() => {
  let invoiceDebts = 0;
  let loanDebts = 0;
  for (const c of filtered.value) {
    invoiceDebts = round2(invoiceDebts + c.invoiceDebt);
    loanDebts = round2(loanDebts + c.loanDebt);
  }
  return {
    invoiceDebts,
    loanDebts,
    totalDebts: round2(invoiceDebts + loanDebts),
    debtors: filtered.value.length,
  };
});

function formatDateOnly(v: unknown): string {
  const d = toDateSafe(v);
  return d ? d.toLocaleDateString("ar-EG") : "—";
}
function loanNoteOf(o: Obligation): string {
  return o.ref?.note || "";
}
function loanStatusLabel(o: Obligation): string {
  const s = loanStatusOf(o.paid, o.remaining);
  return s === "paid" ? "مسددة" : s === "partial" ? "جزئية" : "مفتوحة";
}
function loanStatusColor(o: Obligation): "success" | "warning" | "error" {
  const s = loanStatusOf(o.paid, o.remaining);
  return s === "paid" ? "success" : s === "partial" ? "warning" : "error";
}
function shortId(id: string): string {
  return String(id || "").slice(0, 6);
}

// Details
const selected = ref<CustomerDebt | null>(null);
const detailsOpen = computed({
  get: () => selected.value !== null,
  set: (v: boolean) => {
    if (!v) selected.value = null;
  },
});
const payments = ref<DebtPayment[]>([]);
const paymentsLoading = ref(false);
async function openDetails(c: CustomerDebt): Promise<void> {
  selected.value = c;
}
const loansOpen = ref(false);
const historyOpen = ref(false);
function openLoansRow(c: CustomerDebt): void {
  selected.value = c;
  loansOpen.value = true;
}
function openHistoryRow(c: CustomerDebt): void {
  selected.value = c;
  void openHistory();
}
async function openHistory(): Promise<void> {
  payments.value = [];
  historyOpen.value = true;
  if (selected.value?.customer_id) {
    paymentsLoading.value = true;
    try {
      payments.value = await debts.fetchPaymentsForCustomer(
        selected.value.customer_id,
      );
    } finally {
      paymentsLoading.value = false;
    }
  }
}
async function openDetailsRefresh(): Promise<void> {
  // Details dialog now shows invoices only; loans/history live in own modals.
  if (historyOpen.value) await openHistory();
}
// On-demand single invoice fetch (never preloads full invoices).
const viewInvoice = ref<Invoice | null>(null);
const viewLoading = ref(false);
const viewError = ref("");
const viewOpen = computed({
  get: () =>
    viewInvoice.value !== null || viewLoading.value || !!viewError.value,
  set: (v: boolean) => {
    if (!v) {
      viewInvoice.value = null;
      viewError.value = "";
    }
  },
});
async function openViewInvoice(id: string): Promise<void> {
  viewInvoice.value = null;
  viewError.value = "";
  viewLoading.value = true;
  try {
    const snap = await getDoc(doc(db, "invoices", id));
    if (!snap.exists()) {
      viewError.value = "الفاتورة غير موجودة.";
      return;
    }
    viewInvoice.value = { id: snap.id, ...(snap.data() as object) } as Invoice;
  } catch (e) {
    console.error(e);
    viewError.value = "تعذر تحميل الفاتورة.";
  } finally {
    viewLoading.value = false;
  }
}

// Loan
const LOAN_CREATE_ID = "__create__";
const loanOpen = ref(false);
const loanCustomer = ref<Customer | undefined>(undefined);
const loanSearch = ref("");
const showCustomerModal = ref(false);
const loanAmount = ref<number | undefined>(undefined);
const loanNote = ref("");
const loanSubmitError = ref("");
const loanBusy = ref(false);
// Live amount error: empty = untouched (no red); clears the moment value is valid.
const loanAmountError = computed(() => {
  if (loanAmount.value === undefined || loanAmount.value === null) return "";
  return loanAmount.value > 0 ? "" : "المبلغ يجب أن يكون أكبر من صفر.";
});
const loanCustomerItems = computed<(Customer | { id: string; name: string })[]>(
  () => {
    const q = loanSearch.value.trim();
    const base = q
      ? customers.list.filter(
          (c) => c.name?.includes(q) || String(c.phone ?? "").includes(q),
        )
      : [...customers.list];
    return [
      { id: LOAN_CREATE_ID, name: "+ إضافة عميل جديد" } as Customer,
      ...base.slice(0, 30),
    ];
  },
);
function onPickLoanCustomer(cus: Customer | null | undefined): void {
  if (!cus) return;
  if (cus.id === LOAN_CREATE_ID) {
    showCustomerModal.value = true;
    return;
  }
  loanCustomer.value = cus;
}
async function loadCustomersForLoan(): Promise<void> {
  await customers.fetchCustomers();
}
async function onLoanCustomerCreated(
  cus: Customer | null | undefined,
): Promise<void> {
  await loadCustomersForLoan();
  if (cus?.id) {
    loanCustomer.value = customers.list.find((c) => c.id === cus.id) ?? cus;
  }
  loanSearch.value = "";
}
function openLoan(c: CustomerDebt | null): void {
  loanSubmitError.value = "";
  loanAmount.value = undefined;
  loanNote.value = "";
  loanCustomer.value = undefined;
  loanSearch.value = "";
  if (c) {
    // Preselect: real id first, then normalized phone, then normalized name.
    // Silent when unresolvable — validation happens at submit time only.
    const phone = normalizePhone(c.phone);
    const name = normalizeName(c.name);
    loanCustomer.value =
      customers.list.find((x) => x.id === c.customer_id) ??
      (phone
        ? customers.list.find((x) => normalizePhone(x.phone) === phone)
        : undefined) ??
      (name
        ? customers.list.find((x) => normalizeName(x.name) === name)
        : undefined) ??
      undefined;
  }
  loanOpen.value = true;
}
async function submitLoan(): Promise<void> {
  loanSubmitError.value = "";
  if (!loanCustomer.value?.id) {
    loanSubmitError.value = "اختر العميل أولاً.";
    return;
  }
  if (loanAmountError.value || loanAmount.value === undefined) {
    loanSubmitError.value = loanAmountError.value || "أدخل مبلغ السلفة أولاً.";
    return;
  }
  loanBusy.value = true;
  try {
    const res = await debts.createLoan({
      customer_id: loanCustomer.value.id,
      customer_name: loanCustomer.value.name,
      customer_phone: loanCustomer.value.phone ?? null,
      amount: loanAmount.value ?? 0,
      note: loanNote.value.trim() || null,
    });
    if (!res.ok) {
      loanSubmitError.value = res.error;
      return;
    }
    notify("تم تسجيل السلفة وخصمها من الخزنة.", "success");
    loanOpen.value = false;
    await reload();
    if (selected.value) {
      selected.value =
        book.value.find((c) => c.key === selected.value?.key) ?? selected.value;
      if (selected.value.customer_id) await openDetailsRefresh();
    }
  } finally {
    loanBusy.value = false;
  }
}

// Payment — main amount drives oldest-first auto-distribution.
const payOpen = ref(false);
const payTarget = ref<CustomerDebt | null>(null);
const payAmount = ref<number | undefined>(undefined);
const payAttempted = ref(false);
const payAllocs = ref<Record<string, number>>({});
const payNote = ref("");
const payError = ref("");
const payBusy = ref(false);
const payObligations = computed<Obligation[]>(() => {
  if (!payTarget.value) return [];
  return [...payTarget.value.invoices, ...payTarget.value.loans].sort(
    (a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity),
  );
});
const payAllocated = computed(() =>
  round2(Object.values(payAllocs.value).reduce((s, v) => s + (v || 0), 0)),
);
// Main field error: only after a submit attempt with a real problem.
const payAmountError = computed(() => {
  if (!payAttempted.value || !payTarget.value) return "";
  const v = payAmount.value;
  if (v === undefined || v === null || !(v > 0))
    return "أدخل مبلغاً أكبر من صفر.";
  if (v - payTarget.value.totalDebt > 1e-9)
    return "المبلغ يتجاوز إجمالي الدين.";
  return "";
});
function allocKey(o: Obligation): string {
  return o.kind + o.id;
}
/** Fill obligations oldest-first from the main amount. */
function autoDistribute(): void {
  const next: Record<string, number> = {};
  let rest = round2(payAmount.value || 0);
  for (const o of payObligations.value) {
    if (rest <= 0) break;
    const take = Math.min(o.remaining, rest);
    if (take > 0) next[allocKey(o)] = round2(take);
    rest = round2(rest - take);
  }
  payAllocs.value = next;
}
/** Manual edit of one allocation: preserve it, rebalance the rest. */
function onAllocInput(o: Obligation, v: number | undefined): void {
  const budget = round2(payAmount.value || 0);
  const mine = Math.min(Math.max(round2(v ?? 0), 0), o.remaining, budget);
  const next: Record<string, number> = { [allocKey(o)]: mine };
  let rest = round2(budget - mine);
  for (const x of payObligations.value) {
    if (x.kind === o.kind && x.id === o.id) continue;
    if (rest <= 0) break;
    const take = Math.min(x.remaining, rest);
    if (take > 0) next[allocKey(x)] = round2(take);
    rest = round2(rest - take);
  }
  payAllocs.value = next;
}
function payFormValid(): boolean {
  const t = payTarget.value;
  const v = payAmount.value;
  if (!t || v === undefined || v === null || !(v > 0)) return false;
  if (v - t.totalDebt > 1e-9) return false;
  return payAllocated.value - v <= 1e-9 && v - payAllocated.value <= 1e-9;
}
watch(payAmount, () => {
  autoDistribute();
});
watch(
  [payAllocs, payAmount, payTarget],
  () => {
    if (payError.value && payFormValid()) payError.value = "";
  },
  { deep: true },
);
function openPay(c: CustomerDebt): void {
  payTarget.value = c;
  payAmount.value = undefined;
  payAttempted.value = false;
  payAllocs.value = {};
  payNote.value = "";
  payError.value = "";
  payOpen.value = true;
}
function resolvePayCustomerId(): string | null {
  const t = payTarget.value;
  if (!t) return null;
  if (t.customer_id) return t.customer_id;
  const found = customers.list.find(
    (x) =>
      String(x.phone ?? "") !== "" &&
      String(x.phone ?? "") === String(t.phone ?? ""),
  );
  return found?.id ?? null;
}
async function submitPay(): Promise<void> {
  payError.value = "";
  payAttempted.value = true;
  if (!payTarget.value) return;
  const v = payAmount.value;
  if (v === undefined || v === null || !(v > 0)) {
    payError.value = "أدخل المبلغ المدفوع (أكبر من صفر).";
    return;
  }
  if (v - payTarget.value.totalDebt > 1e-9) {
    payError.value = "المبلغ المدفوع يتجاوز إجمالي الدين.";
    return;
  }
  if (!payFormValid()) {
    payError.value = "مجموع التوزيع لا يساوي المبلغ المدفوع.";
    return;
  }
  const customer_id = resolvePayCustomerId();
  if (!customer_id) {
    payError.value = "تعذر تحديد العميل — أنشئه في سجل العملاء أولاً.";
    return;
  }
  const allocations = payObligations.value
    .map((o) => ({
      type: o.kind,
      reference_id: o.id,
      amount: round2(payAllocs.value[o.kind + o.id] || 0),
    }))
    .filter((a) => a.amount > 0);
  if (!allocations.length) {
    payError.value = "أدخل مبلغاً واحداً على الأقل.";
    return;
  }
  for (const a of allocations) {
    const o = payObligations.value.find(
      (x) => x.kind === a.type && x.id === a.reference_id,
    );
    if (o && a.amount - o.remaining > 1e-9) {
      payError.value = "مبلغ يتجاوز المتبقي على أحد الالتزامات.";
      return;
    }
  }
  payBusy.value = true;
  try {
    const res = await debts.payDebts({
      customer_id,
      allocations,
      note: payNote.value.trim() || null,
    });
    if (!res.ok) {
      payError.value = res.error;
      return;
    }
    notify(
      `تم تسجيل سداد ${formatePrice(res.total)} وتحديث الخزنة.`,
      "success",
    );
    payOpen.value = false;
    selected.value = null;
    await reload();
  } finally {
    payBusy.value = false;
  }
}

async function reload(): Promise<void> {
  loading.value = true;
  try {
    book.value = await debts.fetchDebtsBook();
  } finally {
    loading.value = false;
  }
}

async function loadSupplierInvoices(): Promise<void> {
  supplierLoading.value = true;
  supplierError.value = "";
  try {
    supplierInvoices.value = await purchasing.fetchPurchaseInvoices();
    await cashbox.fetchCashbox();
    await nextTick();
    scrollToSupplierInvoice();
  } catch (error) {
    console.error(error);
    supplierError.value = "تعذر تحميل فواتير الموردين.";
  } finally {
    supplierLoading.value = false;
  }
}

function scrollToSupplierInvoice(): void {
  const invoiceId = String(route.hash || "").replace(/^#purchase-/, "");
  if (!invoiceId) return;
  document.getElementById(`purchase-${decodeURIComponent(invoiceId)}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

watch(() => route.hash, async () => {
  await nextTick();
  scrollToSupplierInvoice();
});

function openSupplierPayment(invoice: PurchaseInvoice): void {
  supplierPayTarget.value = invoice;
  supplierPaymentAmount.value = undefined;
  supplierPaymentNote.value = "";
  supplierPaymentSubmitError.value = "";
  supplierPaymentKey.value = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  void cashbox.fetchCashbox();
  supplierPayOpen.value = true;
}

async function showSupplierPayments(invoice: PurchaseInvoice): Promise<void> {
  if (!invoice.id) return;
  supplierHistoryInvoice.value = invoice;
  supplierHistory.value = [];
  supplierHistoryOpen.value = true;
  supplierHistoryLoading.value = true;
  try {
    supplierHistory.value = await purchasing.fetchSupplierPayments(invoice.id);
    supplierHistory.value.sort((a, b) => (toDateSafe(b.created_at)?.getTime() ?? 0) - (toDateSafe(a.created_at)?.getTime() ?? 0));
  } finally {
    supplierHistoryLoading.value = false;
  }
}

async function submitSupplierPayment(): Promise<void> {
  const target = supplierPayTarget.value;
  if (!target?.id || supplierPaymentError.value || supplierPaymentAmount.value === undefined) return;
  supplierPaymentBusy.value = true;
  supplierPaymentSubmitError.value = "";
  try {
    const response = await purchasing.paySupplierInvoice(target.id, supplierPaymentAmount.value, supplierPaymentNote.value.trim() || null, supplierPaymentKey.value);
    if (!response.ok) {
      supplierPaymentSubmitError.value = response.error;
      return;
    }
    notify(response.remaining > 0 ? `تم تسجيل الدفعة، والمتبقي ${formatePrice(response.remaining)} ج.` : "تم سداد فاتورة المورد بالكامل.", "success");
    supplierPayOpen.value = false;
    await loadSupplierInvoices();
  } finally {
    supplierPaymentBusy.value = false;
  }
}

onMounted(async () => {
  await Promise.all([reload(), customers.fetchCustomers(), loadSupplierInvoices()]);
});
</script>
