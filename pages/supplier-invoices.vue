<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div><h1 class="text-xl font-bold">فواتير الموردين</h1><p class="text-sm text-gray-500">مشتريات ومستحقات الموردين مستقلة عن دفتر ديون العملاء.</p></div>
      <UButton color="success" icon="i-lucide-plus" @click="startDraft()">فاتورة مورد جديدة</UButton>
    </header>
    <UAlert v-if="loadError" color="error" variant="soft" :title="loadError"><template #actions><UButton size="xs" color="error" variant="soft" :loading="loading" @click="reload(true)">إعادة المحاولة</UButton></template></UAlert>
    <UAlert v-if="supplierFilterId" color="info" variant="soft" :title="`عرض فواتير المورد: ${supplierFilterName || supplierFilterId}`"><template #actions><UButton size="xs" color="neutral" variant="soft" @click="clearSupplierFilter">عرض كل الفواتير</UButton></template></UAlert>
    <div class="grid gap-3 sm:grid-cols-3"><UCard variant="outline"><p class="text-xs text-gray-500">فواتير الصفحة</p><b class="text-xl">{{ visibleInvoices.length }}</b></UCard><UCard variant="outline"><p class="text-xs text-gray-500">صافي مشتريات الصفحة بعد المرتجعات</p><b class="text-xl">{{ formatePrice(totalPurchases) }} ج</b></UCard><UCard variant="outline"><p class="text-xs text-gray-500">مستحق الصفحة</p><b class="text-xl text-red-600">{{ formatePrice(totalPayable) }} ج</b></UCard></div>
    <div class="flex flex-wrap gap-2"><UInput v-model="search" icon="i-lucide-search" placeholder="بحث بالمورد" class="w-full sm:max-w-sm" /><USelect v-model="statusFilter" :items="[{ label: 'كل الحالات', value: 'all' }, { label: 'غير مسددة', value: 'unpaid' }, { label: 'مسددة جزئيًا', value: 'partial' }, { label: 'مسددة', value: 'paid' }]" value-key="value" label-key="label" class="w-full sm:w-44" /></div>
    <UiAppCardsSkeleton v-if="loading" layout="list" :count="4" />
    <div v-else class="space-y-3">
      <UCard v-for="invoice in visibleInvoices" :key="invoice.id" variant="outline">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h2 class="font-bold">فاتورة توريد من {{ invoice.supplier_name || 'مورد غير مسمى' }}</h2><UBadge :color="statusColor(invoice)" variant="soft">{{ statusLabel(invoice) }}</UBadge><UBadge v-if="invoice.return_status" color="warning" variant="soft">مرتجع {{ invoice.return_status === 'full' ? 'كلي' : 'جزئي' }} · {{ formatePrice(invoice.return_total || 0) }} ج</UBadge><UBadge v-if="invoice.pinned" color="warning" variant="soft">مثبتة</UBadge></div><p class="text-sm text-gray-500">{{ sourceLabel(invoice.source) }} · {{ formatDateOnly(invoice.created_at) }} · {{ invoice.items.length }} أصناف</p><div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm"><span>الإجمالي الأصلي <b>{{ formatePrice(invoice.total_amount) }} ج</b></span><span v-if="invoice.return_status">الصافي بعد المرتجعات <b>{{ formatePrice(invoice.total_amount - (invoice.return_total || 0)) }} ج</b></span><span>مدفوع {{ formatePrice(invoice.paid_amount) }} ج</span><span class="font-bold text-red-600">باقٍ {{ formatePrice(invoice.remaining_amount) }} ج</span><span v-if="invoice.advance_amount" class="font-bold text-blue-700">سلفة لنا {{ formatePrice(invoice.advance_amount) }} ج</span></div></div>
          <div class="flex flex-wrap gap-1"><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-eye" @click="openDetails(invoice)">عرض</UButton><UButton v-if="invoice.return_status !== 'full'" size="sm" color="warning" variant="soft" icon="i-lucide-undo-2" @click="openReturn(invoice)">مرتجع</UButton><UButton size="sm" color="neutral" variant="soft" :icon="invoice.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'" @click="togglePin(invoice)">{{ invoice.pinned ? 'إلغاء التثبيت' : 'تثبيت' }}</UButton><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-copy-plus" @click="startDraft(invoice)">فاتورة جديدة من هذه</UButton><UButton size="sm" v-if="invoice.remaining_amount > 0" color="success" icon="i-lucide-hand-coins" @click="openPayment(invoice)">تسديد</UButton></div>
        </div>
      </UCard>
      <UEmpty v-if="!loadError && !visibleInvoices.length" icon="i-lucide-receipt" title="لا توجد فواتير موردين" />
      <div class="flex items-center justify-between gap-2 pt-2"><span class="text-xs text-gray-500">صفحة {{ pageNumber }} · حتى 25 فاتورة</span><div class="flex gap-2" dir="ltr"><UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-left" aria-label="الصفحة التالية" :disabled="loading || !hasMore" @click="nextPage" /><UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-right" aria-label="الصفحة السابقة" :disabled="loading || pageNumber <= 1" @click="previousPage" /></div></div>
    </div>

    <UiAppDialog v-model:open="draftOpen" :title="draftSource ? 'مسودة فاتورة جديدة من فاتورة سابقة' : 'فاتورة مورد جديدة'">
      <div class="max-h-[65vh] space-y-4 overflow-y-auto pe-1">
        <UFormField label="المورد" required>
          <USelectMenu :model-value="(draftSupplier ?? null) as Supplier | undefined" :items="supplierMenuItems" label-key="name" by="id" placeholder="اختر المورد" :search-input="{ placeholder: 'بحث عن مورد...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(s) => onPickDraftSupplier(s)" />
          <FormsSupplier v-model="showSupplierModal" :refresher="reloadSuppliers" @done="onDraftSupplierCreated" />
        </UFormField>
        <UFormField v-if="draftSource && !draftSupplier" label="اسم المورد في الفاتورة السابقة" required><UInput v-model="supplierName" placeholder="اسم المورد" class="w-full" /></UFormField>
        <UFormField label="رقم فاتورة المورد"><UInput v-model="supplierRef" dir="ltr" class="w-full" /></UFormField>
        <div v-for="(line, index) in draftLines" :key="line.key" class="space-y-2 rounded-xl border border-gray-200 p-3">
          <div class="flex items-center justify-between"><b class="text-sm">صنف {{ index + 1 }}</b><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" aria-label="حذف الصنف" :disabled="draftLines.length <= 1" @click="draftLines.splice(index, 1)" /></div>
          <UFormField label="المنتج"><USelectMenu :model-value="selectedFamily(line)" :items="familyOptions" label-key="name" by="id" placeholder="اختر المنتج" :search-input="{ placeholder: 'بحث باسم المنتج...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(family) => pickFamily(line, family)" /></UFormField>
          <UFormField v-if="line.family_id && selectedFamily(line)?.inventory_mode !== 'independent'" label="النوع"><USelectMenu :model-value="line.product" :items="productOptions(line)" label-key="variant_name" by="id" placeholder="اختر النوع" :search-input="{ placeholder: 'بحث عن نوع...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(product) => pickProduct(line, product)" /></UFormField>
          <UFormField v-if="line.family_id && selectedFamily(line)?.inventory_mode === 'independent' && selectedFamily(line)?.uses_variants !== false" label="النوع"><USelectMenu :model-value="selectedVariantOption(line)" :items="variantOptions(line)" label-key="name" by="key" placeholder="اختر النوع" :search-input="{ placeholder: 'بحث عن نوع...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(variant) => pickVariant(line, variant)" /></UFormField>
          <UFormField v-if="line.family_id && selectedFamily(line)?.inventory_mode === 'independent' && (selectedFamily(line)?.uses_variants === false || line.variant_key)" label="حجم العبوة"><USelectMenu :model-value="line.product" :items="packSizeOptions(line)" label-key="pack_size_name" by="id" placeholder="اختر حجم العبوة" :search-input="{ placeholder: 'بحث عن حجم عبوة...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(product) => pickProduct(line, product)" /></UFormField>
          <div v-if="line.product" class="grid grid-cols-2 gap-2">
            <UFormField label="وحدة الشراء"><USelectMenu :model-value="selectedUnit(line)" :items="unitOptions(line)" label-key="name" by="id" :search-input="false" class="w-full" @update:model-value="(unit) => pickUnit(line, unit)" /></UFormField>
            <UFormField label="الكمية"><UInputNumber v-model="line.quantity" :min="0.01" :step="selectedUnit(line)?.allows_fractional ? 0.01 : 1" class="w-full" /></UFormField>
            <UFormField label="تكلفة الوحدة المحددة"><UInputNumber v-model="line.unit_cost" :min="0" :step="0.0001" class="w-full" /></UFormField>
            <UFormField label="تأثير سعر البيع"><USelect :model-value="line.priceMode" :items="priceModeItems" value-key="value" label-key="label" class="w-full" @update:model-value="(mode) => setPriceMode(line, mode)" /></UFormField>
            <div class="col-span-full rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
              الوحدة: <b>{{ line.unit_name || 'وحدة' }}</b><br>
              سعر شراء الوحدة: <b>{{ formatePrice(line.unit_cost) }} ج</b> · إجمالي السطر: <b>{{ formatePrice((line.quantity || 0) * (line.unit_cost || 0)) }} ج</b><br>
              المخزون المسجل: <b>{{ stockQuantityLabel(line.product) }}</b>
            </div>
            <div class="col-span-full rounded-lg bg-amber-50 p-2 text-xs text-gray-700">سعر البيع الحالي: <b>{{ formatePrice(selectedUnit(line)?.selling_price) }} ج</b> · متوسط التكلفة المتوقع: <b>{{ formatePrice(previewLine(line).avg) }} ج</b> · السعر المقترح: <b>{{ previewLine(line).proposed === null ? 'أدخل سعرًا يدويًا' : `${formatePrice(previewLine(line).proposed)} ج` }}</b>
              <div v-if="proposalsForProduct(line.product.id).length > 1" class="mt-1 space-y-0.5">
                <div v-for="p in proposalsForProduct(line.product.id)" :key="p.unitId" class="flex justify-between gap-2">
                  <span>{{ p.unitName }}: بيع {{ p.oldPrice === null ? '—' : formatePrice(p.oldPrice) }} → مقترح {{ p.proposed === null ? 'يدوي' : formatePrice(p.proposed) }}</span>
                  <span class="text-gray-500">هامش {{ p.rate === null ? '—' : `${Math.round(p.rate * 10000) / 100}%` }}</span>
                </div>
              </div>
            </div>
            <UFormField v-if="line.priceMode === 'proposed' && previewLine(line).proposed !== null" label="السعر المقترح (قابل للتعديل)"><UInputNumber v-model="line.approvedProposal" :min="0" :step="0.01" class="w-full" /></UFormField>
            <UFormField v-if="line.priceMode === 'custom'" label="سعر البيع المخصص"><UInputNumber v-model="line.customPrice" :min="0" :step="0.01" class="w-full" /></UFormField>
            <UAlert v-if="line.priceMode === 'proposed' && previewLine(line).proposed === null" class="col-span-full" color="warning" variant="soft" title="لا يمكن اشتقاق هامش ربح قديم لهذا المنتج؛ اختر سعرًا مخصصًا." />
          </div>
        </div>
        <UButton color="neutral" variant="soft" icon="i-lucide-plus" @click="addDraftLine()">إضافة صنف</UButton>
        <div class="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 text-sm"><span>إجمالي الفاتورة</span><b class="text-end">{{ formatePrice(draftTotal) }} ج</b><span>رصيد الخزنة</span><b class="text-end">{{ formatePrice(cashbox.balance) }} ج</b><span>المدفوع الآن</span><UInputNumber v-model="paidNow" :min="0" :max="cashbox.balance" :step="0.01" class="w-full" /><span>المتبقي للمورد</span><b class="text-end text-red-600">{{ formatePrice(Math.max(0, draftTotal - (paidNow || 0))) }} ج</b><span v-if="(paidNow || 0) > draftTotal">سلفة مستحقة لنا</span><b v-if="(paidNow || 0) > draftTotal" class="text-end text-blue-700">{{ formatePrice((paidNow || 0) - draftTotal) }} ج</b></div>
        <UAlert v-if="draftError" color="error" variant="soft" :title="draftError" />
      </div>
      <template #footer><div class="flex w-full gap-2"><UButton color="success" class="flex-1" icon="i-lucide-check" :loading="savingDraft" :disabled="!draftReady" @click="confirmDraft">تأكيد وحفظ الفاتورة</UButton><UButton color="neutral" variant="soft" class="flex-1" :disabled="savingDraft" @click="draftOpen = false">إلغاء</UButton></div></template>
    </UiAppDialog>

    <UiAppDialog v-model:open="detailsOpen" :title="`فاتورة ${selectedInvoice?.supplier_name || 'المورد'}`">
      <div v-if="selectedInvoice" class="space-y-3"><div class="grid grid-cols-2 gap-2 text-sm"><span>التاريخ</span><b>{{ formatDateOnly(selectedInvoice.created_at) }}</b><span>الإجمالي الأصلي</span><b>{{ formatePrice(selectedInvoice.total_amount) }} ج</b><span>المرتجعات</span><b>{{ formatePrice(selectedInvoice.return_total || 0) }} ج</b><span>الصافي</span><b>{{ formatePrice(selectedInvoice.total_amount - (selectedInvoice.return_total || 0)) }} ج</b><span>المدفوع</span><b>{{ formatePrice(selectedInvoice.paid_amount) }} ج</b><span>الباقي</span><b class="text-red-600">{{ formatePrice(selectedInvoice.remaining_amount) }} ج</b></div><div class="max-h-[40vh] space-y-2 overflow-y-auto"><UCard v-for="(item, index) in selectedInvoice.items" :key="`${item.product_id}-${index}`" variant="outline"><div class="flex justify-between gap-2 text-sm"><b>{{ item.product_name }}</b><span>{{ item.quantity }} {{ item.unit_name || 'وحدة' }}</span></div><div class="mt-1 text-xs text-gray-500">سعر الشراء {{ formatePrice(item.unit_cost) }} ج · إجمالي السطر <b>{{ formatePrice(item.line_total) }} ج</b></div></UCard></div><ReturnHistory v-if="selectedInvoice.return_status" :supplier-returns="selectedReturns" :loading="returnsLoading" :error="returnsError" /><div class="no-print flex flex-wrap gap-2"><UButton color="neutral" variant="soft" icon="i-lucide-printer" @click="printInvoice">طباعة الفاتورة</UButton><UButton color="neutral" variant="soft" icon="i-lucide-history" :disabled="!selectedInvoice.payment_ids?.length" @click="loadPayments(selectedInvoice)">سجل السداد</UButton><UButton v-if="selectedInvoice.return_status !== 'full'" color="warning" variant="soft" icon="i-lucide-undo-2" @click="openReturn(selectedInvoice)">إنشاء مرتجع</UButton></div></div>
      <div v-if="selectedInvoice?.supplier_id && advances.length" class="mt-3 space-y-2 border-t pt-3">
        <h3 class="font-semibold">سلف مستحقة لنا من المورد</h3>
        <div v-for="advance in advances" :key="advance.id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
          <span>{{ formatePrice(advance.remaining_amount) }} ج</span>
          <div class="flex gap-2"><UButton v-if="selectedInvoice.remaining_amount > 0" size="xs" color="success" @click="openAdvance(advance, 'apply')">تسوية مع الفاتورة</UButton><UButton size="xs" color="neutral" variant="soft" @click="openAdvance(advance, 'refund')">استرداد نقدي</UButton></div>
        </div>
      </div>
    </UiAppDialog>
    <UiAppDialog v-model:open="supplierReturnOpen" title="مرتجع فاتورة مورد" :z-index="70">
      <div v-if="returnInvoice" class="max-h-[65vh] space-y-3 overflow-y-auto">
        <p class="text-sm">{{ returnInvoice.supplier_name }} · إجمالي الفاتورة {{ formatePrice(returnInvoice.total_amount) }} ج</p>
        <div v-for="line in returnLines" :key="line.index" class="rounded-lg border p-3 text-sm">
          <div class="flex justify-between gap-2"><b>{{ line.name }}</b><span>المتاح من الفاتورة: {{ line.max }} {{ line.unit }}</span></div>
          <div class="mt-1 text-xs text-gray-500">تكلفة الوحدة الأصلية {{ formatePrice(line.cost) }} ج</div>
          <UFormField label="المكوّن الفعلي المراد إرجاعه" class="mt-2">
            <USelect v-model="line.componentKey" :items="returnComponentOptions(line)" value-key="value" label-key="label" class="w-full" />
          </UFormField>
          <p class="mt-1 text-xs text-gray-500">الرصيد الفعلي المحدد: {{ returnComponentBalance(line) }}</p>
          <UFormField label="الكمية المرتجعة" :error="returnPhysicalError(line) || undefined" class="mt-2">
            <UInputNumber v-model="line.quantity" :min="0" :max="returnMaxQuantity(line)" :step="line.fractional ? 0.0001 : 1" class="w-full" />
          </UFormField>
          <div class="mt-1 text-xs">قيمة الصنف: {{ formatePrice(line.quantity * line.cost) }} ج</div>
        </div>
        <UEmpty v-if="!returnLines.length" title="لا توجد أصناف قابلة للإرجاع" />
        <UFormField v-if="returnReceivable > 0 && !returnInvoice.supplier_id" label="المورد الذي سيُسجل له الرصيد المستحق لنا" required>
          <USelectMenu :model-value="returnSupplier ?? undefined" :items="suppliers.list" label-key="name" by="id" placeholder="اختر المورد" class="w-full" @update:model-value="returnSupplier = $event ?? null" />
          <UButton size="xs" color="neutral" variant="link" @click="showReturnSupplierModal = true">إضافة مورد</UButton>
          <FormsSupplier v-model="showReturnSupplierModal" :refresher="reloadSuppliers" @done="onReturnSupplierCreated" />
        </UFormField>
        <UFormField label="ملاحظة"><UInput v-model="returnNote" class="w-full" /></UFormField>
        <UAlert color="info" variant="soft" :title="`قيمة المرتجع: ${formatePrice(returnTotal)} ج · تخفيض المستحق: ${formatePrice(returnPayableReduction)} ج · رصيد لنا: ${formatePrice(returnReceivable)} ج`" />
        <UAlert v-if="returnError" color="error" variant="soft" :title="returnError" />
      </div>
      <template #footer><div class="flex w-full gap-2"><UButton color="warning" :loading="returnBusy" :disabled="!returnCanSubmit" @click="submitSupplierReturn">تأكيد المرتجع</UButton><UButton color="neutral" variant="soft" :disabled="returnBusy" @click="supplierReturnOpen = false">إلغاء</UButton></div></template>
    </UiAppDialog>
    <UiAppDialog v-model:open="advanceOpen" :title="advanceMode === 'apply' ? 'تسوية سلفة المورد' : 'استرداد سلفة المورد'">
      <UFormField label="المبلغ" :error="advanceError || undefined"><UInputNumber v-model="advanceAmount" :min="0.01" :max="advanceMode === 'apply' ? Math.min(advanceTarget?.remaining_amount ?? 0, selectedInvoice?.remaining_amount ?? 0) : advanceTarget?.remaining_amount ?? 0" :step="0.01" class="w-full" /></UFormField>
      <template #footer><UButton color="success" block :loading="advanceBusy" :disabled="!!advanceError" @click="confirmAdvance">تأكيد</UButton></template>
    </UiAppDialog>
    <UiAppDialog v-model:open="paymentOpen" :title="`سداد فاتورة ${paymentTarget?.supplier_name || 'المورد'}`">
      <div v-if="paymentTarget" class="space-y-3"><div class="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm"><span>الباقي</span><b>{{ formatePrice(paymentTarget.remaining_amount) }} ج</b><span>رصيد الخزنة</span><b>{{ formatePrice(cashbox.balance) }} ج</b></div><UFormField label="مبلغ الدفعة" :error="paymentError || undefined"><UInputNumber v-model="paymentAmount" :min="0" :max="cashbox.balance" :step="0.01" class="w-full" /></UFormField><p v-if="(paymentAmount || 0) > paymentTarget.remaining_amount" class="text-sm text-blue-700">الزيادة سلفة مستحقة لنا: {{ formatePrice((paymentAmount || 0) - paymentTarget.remaining_amount) }} ج</p><UFormField label="ملاحظة"><UInput v-model="paymentNote" class="w-full" /></UFormField><UAlert v-if="paymentError" color="warning" variant="soft" :title="paymentError" /></div>
      <template #footer><div class="flex w-full gap-2"><UButton color="success" class="flex-1" :loading="paying" :disabled="!!paymentError" @click="submitPayment">تأكيد السداد</UButton><UButton color="neutral" variant="soft" class="flex-1" :disabled="paying" @click="paymentOpen = false">إلغاء</UButton></div></template>
    </UiAppDialog>
    <UiAppDialog v-model:open="paymentsOpen" title="سجل سداد المورد"><div class="max-h-[60vh] space-y-2 overflow-y-auto"><UCard v-for="payment in payments" :key="payment.id" variant="outline"><div class="flex justify-between"><span>{{ formatDateOnly(payment.created_at) }}</span><b>{{ formatePrice(payment.amount) }} ج</b></div><p v-if="payment.return_id" class="text-xs text-amber-700">تسوية من مرتجع {{ payment.return_id }}</p><p v-if="payment.note" class="text-xs text-gray-500">{{ payment.note }}</p></UCard><UEmpty v-if="!payments.length" icon="i-lucide-history" title="لا توجد دفعات مسجلة" /></div></UiAppDialog>
    <div v-if="selectedInvoice" class="print-sheet" dir="rtl"><h1>فاتورة مورد</h1><p>{{ selectedInvoice.supplier_name }} · {{ selectedInvoice.invoice_number || selectedInvoice.supplier_ref || '' }}</p><p>{{ formatDateOnly(selectedInvoice.created_at) }}</p><table><thead><tr><th>المنتج</th><th>الوحدة</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead><tbody><tr v-for="(item, index) in selectedInvoice.items" :key="`${item.product_id}-print-${index}`"><td>{{ item.product_name }}</td><td>{{ item.unit_name || 'وحدة' }}</td><td>{{ item.quantity }}</td><td>{{ formatePrice(item.unit_cost) }}</td><td>{{ formatePrice(item.line_total) }}</td></tr></tbody></table><p>الإجمالي: {{ formatePrice(selectedInvoice.total_amount) }} ج</p><p>المدفوع: {{ formatePrice(selectedInvoice.paid_amount) }} ج · الباقي: {{ formatePrice(selectedInvoice.remaining_amount) }} ج</p></div>
  </div>
</template>

<script setup lang="ts">
import type { Product, ProductUnit } from "~/types";
import type { PurchaseInvoice, PurchaseInvoiceItem, Supplier, SupplierPayment, SupplierAdvance, SupplierReturn } from "~/types/finance";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import { deriveSupplierInvoiceStatus, supplierInvoiceStatus } from "~/types/finance";
import { convertUnitPrice, proposedSellingPrice, purchaseLineBaseCost, purchaseLineBaseQuantity, purchasePreviewAverage, purchaseUnitProposals, purchasableUnitsForProduct, round2, round4, splitSupplierReturn, toNum, unitPurchasePrice, stockQuantityLabel } from "~/composables/finance";
import { toDateSafe } from "~/types";
import { useSuppliersStore } from "~/stores/suppliers";

interface DraftLine { key: string; family_id: string | null; variant_key?: string | null; product?: Product; unit_id: string; unit_name: string; unit_factor: number; quantity: number; unit_cost: number; priceMode: "keep" | "proposed" | "custom"; approvedProposal?: number | null; customPrice?: number }
definePageMeta({ title: "فواتير الموردين" });
const { formatePrice } = useHelpers();
const { notify } = useAppToast();
const route = useRoute();
const productsStore = useProductsStore();
const suppliers = useSuppliersStore();
const purchasing = usePurchasing();
const returnsApi = useSupplierReturns();
const cashbox = useCashbox();
function invoiceBaseQuantityLabel(item: PurchaseInvoiceItem): string {
  const product = productsStore.productsById.get(item.product_id);
  const quantity = item.base_quantity;
  return product && quantity !== null && quantity !== undefined ? stockQuantityLabel(product, quantity) : "—";
}
const pinnedInvoices = ref<PurchaseInvoice[]>([]);
const pageInvoices = ref<PurchaseInvoice[]>([]);
const pageNumber = ref(1);
const hasMore = ref(false);
const pageCursors = ref<(QueryDocumentSnapshot | null)[]>([null]);
const loading = ref(true);
const loadError = ref("");
const search = ref("");
const statusFilter = ref("all");
// Normalized supplier deep-link (?supplier=<id>): single source for the
// server query, the client filter, and the "new invoice" preselect, so a
// supplier-card click always scopes this page to that supplier's invoices.
const supplierFilterId = computed(() => {
  const raw = route.query.supplier;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
});
const supplierFilterName = computed(() => suppliers.list.find((supplier) => supplier.id === supplierFilterId.value)?.name ?? "");
function clearSupplierFilter(): void {
  const q = { ...route.query };
  delete q.supplier;
  delete q.new;
  void navigateTo({ path: route.path, query: q }, { replace: true });
}
const draftOpen = ref(false);
const draftSource = ref<PurchaseInvoice | null>(null);
const draftLines = ref<DraftLine[]>([]);
const draftSupplier = ref<Supplier | undefined>();
const CREATE_SUPPLIER_ID = "__create__";
const showSupplierModal = ref(false);
const supplierMenuItems = computed<Supplier[]>(() => [
  { id: CREATE_SUPPLIER_ID, name: "+ إضافة مورد جديد" } as Supplier,
  ...suppliers.list,
]);
function onPickDraftSupplier(s: Supplier | null | undefined): void {
  if (!s) {
    draftSupplier.value = undefined;
    return;
  }
  if (s.id === CREATE_SUPPLIER_ID) {
    showSupplierModal.value = true;
    return;
  }
  draftSupplier.value = suppliers.list.find((item) => item.id === s.id) ?? s;
}
async function reloadSuppliers(): Promise<void> {
  await suppliers.fetchSuppliers(true);
}
function onDraftSupplierCreated(s: Supplier | null | undefined): void {
  if (s?.id) draftSupplier.value = suppliers.list.find((item) => item.id === s.id) ?? s;
}
const supplierName = ref("");
const supplierRef = ref("");
const paidNow = ref<number | undefined>(0);
const savingDraft = ref(false);
const draftError = ref("");
const requestKey = ref("");
const priceModeItems = [{ label: "الإبقاء على السعر الحالي", value: "keep" }, { label: "اعتماد السعر المقترح", value: "proposed" }, { label: "سعر مخصص", value: "custom" }];
const draftTotal = computed(() => round2(draftLines.value.reduce((sum, line) => sum + round2(toNum(line.quantity) * toNum(line.unit_cost)), 0)));
const draftReady = computed(() => !savingDraft.value && !!(draftSupplier.value?.id || (draftSource.value && supplierName.value.trim())) && draftLines.value.length > 0 && draftLines.value.every((line) => line.product?.id && selectedUnit(line) && Number.isFinite(line.unit_factor) && line.unit_factor > 0 && line.quantity > 0 && (selectedUnit(line)?.allows_fractional === true || Number.isInteger(line.quantity)) && line.unit_cost >= 0 && (!pricePolicyApplies(line) || line.priceMode !== "keep") && (line.priceMode !== "proposed" || previewLine(line).proposed !== null && Number(line.approvedProposal) >= 0) && (line.priceMode !== "custom" || Number(line.customPrice) >= 0)) && toNum(paidNow.value) >= 0 && toNum(paidNow.value) <= cashbox.balance && (toNum(paidNow.value) <= draftTotal.value || !!draftSupplier.value?.id));
const draftMessage = computed(() => draftError.value);
const visibleInvoices = computed(() => [...new Map([...pinnedInvoices.value, ...pageInvoices.value].map((invoice) => [invoice.id, invoice])).values()].filter((invoice) => {
  const query = search.value.trim().toLocaleLowerCase();
  const matchesSearch = !query || `${invoice.supplier_name ?? ""} ${invoice.invoice_number ?? ""} ${invoice.supplier_ref ?? ""}`.toLocaleLowerCase().includes(query);
  const matchesSupplier = !supplierFilterId.value || invoice.supplier_id === supplierFilterId.value;
  return matchesSearch && matchesSupplier;
}));
const totalPurchases = computed(() => round2(visibleInvoices.value.reduce((sum, invoice) => sum + toNum(invoice.total_amount) - toNum(invoice.return_total), 0)));
const totalPayable = computed(() => round2(visibleInvoices.value.reduce((sum, invoice) => sum + toNum(invoice.remaining_amount), 0)));
const detailsOpen = ref(false);
const selectedInvoice = ref<PurchaseInvoice | null>(null);
const selectedReturns = ref<SupplierReturn[]>([]);
const returnsLoading = ref(false);
const returnsError = ref("");
interface SupplierReturnLine { index: number; name: string; unit: string; cost: number; fractional: boolean; max: number; sourceFactor: number; product?: Product; componentKey: string; quantity: number }
const returnInvoice = ref<PurchaseInvoice | null>(null);
const supplierReturnOpen = ref(false);
const returnLines = ref<SupplierReturnLine[]>([]);
const returnSupplier = ref<Supplier | null>(null);
const showReturnSupplierModal = ref(false);
const returnNote = ref("");
const returnError = ref("");
const returnBusy = ref(false);
const returnKey = ref("");
const returnTotal = computed(() => round2(returnLines.value.reduce((sum, line) => sum + line.quantity * line.cost, 0)));
const returnSettlement = computed(() => splitSupplierReturn(returnTotal.value, returnInvoice.value?.remaining_amount));
const returnPayableReduction = computed(() => returnSettlement.value.payableReduction);
const returnReceivable = computed(() => returnSettlement.value.receivable);
const returnCanSubmit = computed(() => !returnBusy.value && returnLines.value.some((line) => line.quantity > 0) && returnLines.value.every((line) => (line.fractional || Number.isInteger(line.quantity)) && line.quantity >= 0 && !returnPhysicalError(line)) && (!returnReceivable.value || !!(returnInvoice.value?.supplier_id || returnSupplier.value?.id)));
const advances = ref<SupplierAdvance[]>([]);
const advanceTarget = ref<SupplierAdvance | null>(null);
const advanceMode = ref<"apply" | "refund">("apply");
const advanceAmount = ref<number | undefined>();
const advanceOpen = ref(false);
const advanceBusy = ref(false);
const advanceKey = ref("");
const advanceError = computed(() => {
  const limit = advanceMode.value === "apply" ? Math.min(advanceTarget.value?.remaining_amount ?? 0, selectedInvoice.value?.remaining_amount ?? 0) : advanceTarget.value?.remaining_amount ?? 0;
  return !(Number(advanceAmount.value) > 0) || Number(advanceAmount.value) > limit ? "أدخل مبلغًا لا يتجاوز الرصيد المتاح." : "";
});
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
  if (Number(paymentAmount.value) > paymentTarget.value.remaining_amount && !paymentTarget.value.supplier_id) return "اربط الفاتورة بمورد لتسجيل السلفة.";
  if (Number(paymentAmount.value) > cashbox.balance) return "المبلغ يتجاوز رصيد الخزنة.";
  return "";
});
function id(): string { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function statusLabel(invoice: PurchaseInvoice): string { return invoice.return_status === "full" ? "مرتجعة بالكامل" : { paid: "مسددة", partial: "مسددة جزئيًا", unpaid: "غير مسددة" }[supplierInvoiceStatus(invoice)]; }
function statusColor(invoice: PurchaseInvoice): "success" | "warning" | "error" { return invoice.return_status === "full" ? "warning" : supplierInvoiceStatus(invoice) === "paid" ? "success" : supplierInvoiceStatus(invoice) === "partial" ? "warning" : "error"; }
function sourceLabel(source?: string): string { return source === "excel_import" ? "استيراد Excel" : source === "repeat" ? "من فاتورة سابقة" : "يدوية"; }
function formatDateOnly(value: unknown): string { const date = toDateSafe(value); return date?.toLocaleDateString("ar-EG") ?? "—"; }
function unitOptions(line: DraftLine): ProductUnit[] { return line.product ? purchasableUnitsForProduct(line.product) : []; }
function selectedUnit(line: DraftLine): ProductUnit | undefined { return unitOptions(line).find((unit) => unit.id === line.unit_id); }
const familyOptions = computed(() => [...new Map(productsStore.list
  .filter((product) => product.is_active !== false && product.family_id && product.family_name)
  .map((product) => [product.family_id as string, { id: product.family_id as string, name: product.family_name as string, uses_variants: product.uses_variants !== false, inventory_mode: product.inventory_mode === "independent" ? "independent" as const : "convertible" as const }]))]
  .map(([, family]) => family)
  .sort((left, right) => left.name.localeCompare(right.name, "ar")));
function selectedFamily(line: DraftLine): { id: string; name: string; uses_variants: boolean; inventory_mode: "convertible" | "independent" } | undefined {
  return line.family_id ? familyOptions.value.find((family) => family.id === line.family_id) : undefined;
}
function newLine(): DraftLine { return { key: id(), family_id: null, variant_key: null, unit_id: "", unit_name: "", unit_factor: Number.NaN, quantity: 1, unit_cost: 0, priceMode: "keep" }; }
function addDraftLine(): void { draftLines.value.push(newLine()); }
function productOptions(line: DraftLine): Product[] {
  // Same product may appear in several purchase units (e.g. cartons + pieces);
  // exact duplicate rows (same product + same unit) are rejected at save.
  return productsStore.list.filter((product) => product.is_active !== false && product.family_id === line.family_id);
}
type VariantOption = { key: string; name: string };
function variantOptions(line: DraftLine): VariantOption[] {
  const options = new Map<string, VariantOption>();
  for (const product of productsStore.list) {
    if (product.is_active === false || product.family_id !== line.family_id || product.inventory_mode !== "independent") continue;
    const key = product.variant_key || "default";
    if (!options.has(key)) options.set(key, { key, name: product.variant_name || "أساسي" });
  }
  return [...options.values()].sort((left, right) => Number(productsStore.list.find(product => product.family_id === line.family_id && product.variant_key === left.key)?.variant_order || 0) - Number(productsStore.list.find(product => product.family_id === line.family_id && product.variant_key === right.key)?.variant_order || 0));
}
function selectedVariantOption(line: DraftLine): VariantOption | undefined { return variantOptions(line).find(option => option.key === line.variant_key); }
function packSizeOptions(line: DraftLine): Product[] { return productsStore.list.filter(product => product.is_active !== false && product.family_id === line.family_id && product.inventory_mode === "independent" && (product.variant_key || "default") === (line.variant_key || "default")).sort((left, right) => (left.pack_size_order ?? 0) - (right.pack_size_order ?? 0)); }
function pickVariant(line: DraftLine, variant?: VariantOption | null): void {
  line.variant_key = variant?.key || null; line.product = undefined; line.unit_id = ""; line.unit_name = ""; line.unit_factor = Number.NaN; line.unit_cost = 0;
  const sizes = packSizeOptions(line); if (sizes.length === 1) pickProduct(line, sizes[0]);
}
function pickFamily(line: DraftLine, family?: { id: string; name: string } | null): void {
  line.family_id = family?.id ?? null;
  if (line.product?.family_id !== line.family_id) {
    line.product = undefined;
    line.variant_key = null;
    line.unit_id = "";
    line.unit_name = "";
    line.unit_factor = Number.NaN;
    line.unit_cost = 0;
  }
  const selected = selectedFamily(line);
  if (selected?.inventory_mode === "independent") {
    if (selected.uses_variants === false) line.variant_key = "default";
    const variants = variantOptions(line); if (selected.uses_variants !== false && variants.length === 1) pickVariant(line, variants[0]);
    const sizes = packSizeOptions(line); if (sizes.length === 1) pickProduct(line, sizes[0]);
  } else {
    const products = productOptions(line); if (selected?.uses_variants === false && products.length === 1) pickProduct(line, products[0]);
  }
}
function pickUnit(line: DraftLine, unit?: ProductUnit): void {
  if (!unit) return;
  // سعر الشراء يتبع الوحدة المختارة نفسها (آخر سعر شراء مسجل عليها).
  const unitLastCost = line.product ? unitPurchasePrice(line.product, unit) : null;
  line.unit_cost = unitLastCost !== null && unitLastCost !== undefined
    ? unitLastCost
    : line.unit_cost;
  const f = Number(unit.factor);
  if (!Number.isFinite(f) || f <= 0) return;
  line.unit_id = unit.id; line.unit_name = unit.name; line.unit_factor = f;
}
function pickProduct(line: DraftLine, product?: Product): void {
  if (!product) { line.product = undefined; return; }
  if (product.family_id !== line.family_id) return;
  line.product = product;
  line.variant_key = product.variant_key ?? null;
  const options = purchasableUnitsForProduct(product);
  const base = options.find((unit) => unit.id === product.base_unit_id) ?? options[0];
  if (!base) {
    line.unit_id = "";
    line.unit_name = "";
    line.unit_factor = Number.NaN;
    return;
  }
  const f = Number(base.factor);
  if (!Number.isFinite(f) || f <= 0) { line.product = undefined; return; }
  line.unit_id = base.id; line.unit_name = base.name; line.unit_factor = f;
  // Prefill with the unit's last purchase price when known (more accurate
  // than the blended base average for repeat buys of the same unit).
  line.unit_cost = unitPurchasePrice(product, base) ?? round4(toNum(product.cost_price) * f);
  line.approvedProposal = previewLine(line).proposed;
}
function openUnitFromSnapshot(productId: string, name: string, unitId?: string | null, unitName?: string | null, factor?: number | null): DraftLine {
  const line = newLine();
  line.product = productsStore.list.find((product) => product.id === productId);
  const cfg = line.product?.units?.find((u) => u.id === unitId);
  const f = Number(factor);
  line.family_id = line.product?.family_id ?? null;
  line.unit_id = unitId || "";
  line.unit_name = unitName || "";
  line.unit_factor = Number.isFinite(f) && f > 0 && cfg && Number(cfg.factor) === f ? f : Number.NaN;
  return line;
}
function startDraft(source?: PurchaseInvoice): void {
  draftSource.value = source ?? null;
  const querySupplierId = !source && supplierFilterId.value ? supplierFilterId.value : null;
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
  draftOpen.value = true;
}
function priceDecision(line: DraftLine): { mode: "keep" } | { mode: "proposed"; approvedProposed: number; price?: number } | { mode: "custom"; price: number; approvedProposed?: number | null } {
  const proposal = previewLine(line).proposed;
  if (line.priceMode === "custom") return { mode: "custom", price: toNum(line.customPrice), approvedProposed: proposal };
  if (!line.product || line.priceMode === "keep") return { mode: "keep" };
  return proposal === null ? { mode: "keep" } : { mode: "proposed", approvedProposed: proposal, price: toNum(line.approvedProposal ?? proposal) };
}
function previewLine(line: DraftLine): { avg: number; proposed: number | null; baseQty: number; baseCost: number } {
  if (!line.product) return { avg: 0, proposed: null, baseQty: 0, baseCost: 0 };
  const unit = selectedUnit(line);
  if (!unit) return { avg: 0, proposed: null, baseQty: 0, baseCost: 0 };
  const f = Number(unit.factor);
  if (!Number.isFinite(f) || f <= 0) return { avg: 0, proposed: null, baseQty: 0, baseCost: 0 };
  const baseQty = round4(toNum(line.quantity) * f);
  const baseCost = toNum(line.unit_cost) / f;
  let totalQty = 0;
  let totalCost = 0;
  for (const other of draftLines.value) {
    if (!other.product || other.product.id !== line.product.id) continue;
    const ou = other.product.units?.find((u) => u.id === other.unit_id);
    const of = ou ? Number(ou.factor) : Number(other.unit_factor);
    if (!Number.isFinite(of) || of <= 0) return { avg: 0, proposed: null, baseQty: 0, baseCost: 0 };
    const q = round4(toNum(other.quantity) * of);
    totalQty = round4(totalQty + q);
    totalCost += q * (toNum(other.unit_cost) / of);
  }
  const combinedCost = totalQty > 0 ? totalCost / totalQty : baseCost;
  const avg = purchasePreviewAverage(line.product.stock_quantity, line.product.cost_price, totalQty, combinedCost);
  const unitAvg = round4(avg * f);
  const oldUnitAvg = line.product.inventory_mode === "independent"
    ? unitPurchasePrice(line.product, unit)
    : line.product.cost_price == null ? null : round4(toNum(line.product.cost_price) * f);
  const nextUnitCost = line.product.inventory_mode === "independent" ? toNum(line.unit_cost) : unitAvg;
  const proposed = oldUnitAvg === null ? null : proposedSellingPrice(oldUnitAvg, unit.selling_price, nextUnitCost).proposed;
  return { avg: round4(avg), proposed, baseQty, baseCost: round4(baseCost) };
}

function proposalsForProduct(productId: string | undefined): { unitId: string; unitName: string; factor: number; oldAvg: number | null; oldPrice: number | null; newAvg: number | null; rate: number | null; proposed: number | null }[] {
  const line = draftLines.value.find((l) => l.product?.id === productId);
  const product = line?.product;
  if (!product) return [];
  if (product.inventory_mode === "independent") return [];
  return purchaseUnitProposals(product as Product, previewLine(line).avg);
}
function pricePolicyApplies(line: DraftLine): boolean {
  const unit = selectedUnit(line);
  if (!unit) return false;
  const cost = line.product?.inventory_mode === "independent" ? toNum(line.unit_cost) : previewLine(line).avg * Number(unit.factor);
  return cost - toNum(unit.selling_price) > 1e-9;
}
function setPriceMode(line: DraftLine, mode: string): void {
  if (mode !== "keep" && mode !== "proposed" && mode !== "custom") return;
  line.priceMode = mode;
  line.approvedProposal = previewLine(line).proposed;
}
watch(() => draftLines.value.map((line) => `${line.key}:${line.quantity}:${line.unit_cost}:${line.unit_factor}:${line.product?.stock_quantity}:${line.product?.cost_price}`).join("|"), () => {
  for (const line of draftLines.value) line.approvedProposal = previewLine(line).proposed;
});
async function confirmDraft(): Promise<void> {
  if (!draftReady.value || savingDraft.value) return;
  savingDraft.value = true;
  draftError.value = "";
  try {
    const result = await purchasing.executePurchase({ idempotencyKey: requestKey.value, supplier_id: draftSupplier.value?.id ?? null, supplier_name: draftSupplier.value?.name ?? supplierName.value.trim(), supplier_ref: supplierRef.value.trim() || null, source: draftSource.value ? "repeat" : "manual", items: draftLines.value.map((line) => ({ product_id: line.product?.id, quantity: line.quantity, unit_cost: line.unit_cost, unit_id: line.unit_id, unit_name: line.unit_name, unit_factor: line.unit_factor, pricing: priceDecision(line) })), paidNow: toNum(paidNow.value) });
    if (!result.ok) { draftError.value = result.error || "تعذر حفظ الفاتورة."; return; }
    notify(result.advance ? `تم تسجيل الفاتورة وسلفة مستحقة لنا ${formatePrice(result.advance)} ج.` : result.remaining ? `فاتورة الشراء سُجلت، والمتبقي للمورد ${formatePrice(result.remaining)} ج.` : "تم تسجيل فاتورة الشراء مدفوعة بالكامل.", "success");
    draftOpen.value = false;
    await reload(true);
  } finally { savingDraft.value = false; }
}
function openDetails(invoice: PurchaseInvoice): void {
  selectedInvoice.value = invoice;
  detailsOpen.value = true;
  advances.value = [];
  selectedReturns.value = [];
  returnsError.value = "";
  if (invoice.supplier_id) void purchasing.fetchSupplierAdvances(invoice.supplier_id).then((items) => { if (selectedInvoice.value?.id === invoice.id) advances.value = items; });
  if (invoice.return_status && invoice.id) {
    returnsLoading.value = true;
    void returnsApi.fetchForInvoice(invoice.id).then((items) => { if (selectedInvoice.value?.id === invoice.id) selectedReturns.value = items; }).catch(() => { returnsError.value = "تعذر تحميل سجل المرتجعات."; }).finally(() => { returnsLoading.value = false; });
  }
}
function openReturn(invoice: PurchaseInvoice): void {
  returnInvoice.value = invoice;
  returnKey.value = id();
  returnSupplier.value = null;
  returnNote.value = "";
  returnError.value = "";
  returnLines.value = invoice.items.map((item, index) => {
    const product = productsStore.productsById.get(item.product_id);
    const unit = product?.units?.find((u) => u.id === item.unit_id);
    const f = Number(item.unit_factor);
    const sourceKind = item.stock_kind || unit?.stock_kind;
    const closedCount = item.unit_id ? toNum(product?.inventory?.closed_packages?.[item.unit_id]) : 0;
    return {
      index,
      name: item.product_name,
      unit: item.unit_name || "وحدة",
      cost: toNum(item.unit_cost),
      fractional: item.allows_fractional === true,
      max: Math.max(0, toNum(item.quantity) - toNum(invoice.returned_quantities?.[String(index)])),
      sourceFactor: f,
      product,
      componentKey: sourceKind === "package" && closedCount > 0 ? `package:${item.unit_id}` : "loose",
      quantity: 0,
    };
  }).filter((line) => line.max > 0);
  supplierReturnOpen.value = true;
}
function returnComponentOptions(line: SupplierReturnLine): { label: string; value: string }[] {
  const product = line.product;
  if (!product) return [{ label: "الكمية المفتوحة", value: "loose" }];
  const options = [{ label: `${product.inventory_mode === "independent" ? "عبوات مفردة كاملة" : "كمية مفتوحة"} · ${product.base_unit_name || "الوحدة الأساسية"}`, value: "loose" }];
  for (const unit of product.units || []) {
    if (unit.stock_kind !== "package") continue;
    const count = toNum(product.inventory?.closed_packages?.[unit.id]);
    options.push({ label: `${unit.name} مغلقة · المتاح ${count}`, value: `package:${unit.id}` });
  }
  return options;
}
function returnBucket(line: SupplierReturnLine): "loose" | "package" {
  return line.componentKey.startsWith("package:") ? "package" : "loose";
}
function returnUnitId(line: SupplierReturnLine): string | null {
  return returnBucket(line) === "package" ? line.componentKey.slice("package:".length) : null;
}
function returnComponentBalance(line: SupplierReturnLine): string {
  if (!line.product) return "غير متاح";
  if (returnBucket(line) === "loose") return `${round4(toNum(line.product.inventory?.loose_base_quantity))} ${line.product.base_unit_name || "وحدة"}`;
  const unitId = returnUnitId(line) || "";
  const unit = line.product.units?.find((entry) => entry.id === unitId);
  return `${toNum(line.product.inventory?.closed_packages?.[unitId])} ${unit?.name || "عبوة"}`;
}
function returnMaxQuantity(line: SupplierReturnLine): number {
  if (!(line.sourceFactor > 0)) return 0;
  const product = line.product;
  const bucket = returnBucket(line);
  const unitId = returnUnitId(line);
  const unit = bucket === "package" ? product?.units?.find((entry) => entry.id === unitId) : undefined;
  const availableBase = bucket === "package"
    ? toNum(product?.inventory?.closed_packages?.[unitId || ""]) * Number(unit?.factor)
    : toNum(product?.inventory?.loose_base_quantity);
  if (bucket === "package") {
    const factor = Number(unit?.factor);
    if (!(factor > 0)) return 0;
    return Math.min(line.max, round4(Math.floor((availableBase + 1e-9) / factor) * factor / line.sourceFactor));
  }
  return Math.min(line.max, round4(availableBase / line.sourceFactor));
}
function returnPhysicalError(line: SupplierReturnLine): string {
  if (!(line.quantity > 0)) return "";
  if (!(line.sourceFactor > 0)) return "معامل الوحدة في الفاتورة غير صالح.";
  if (line.quantity - returnMaxQuantity(line) > 1e-9) return "الرصيد الفعلي للمكوّن المحدد لا يكفي لهذه الكمية.";
  if (returnBucket(line) === "package") {
    const unit = line.product?.units?.find((entry) => entry.id === returnUnitId(line));
    const count = line.quantity * line.sourceFactor / Number(unit?.factor);
    if (!Number.isFinite(count) || Math.abs(count - Math.round(count)) > 1e-9) return "كمية المرتجع يجب أن تطابق عددًا صحيحًا من العبوات المغلقة.";
  }
  return "";
}
function onReturnSupplierCreated(supplier: Supplier | null | undefined): void {
  if (supplier?.id) returnSupplier.value = supplier;
}
async function submitSupplierReturn(): Promise<void> {
  if (!returnInvoice.value?.id || !returnCanSubmit.value) return;
  returnBusy.value = true;
  returnError.value = "";
  try {
    const result = await returnsApi.createReturn({ id: returnKey.value, invoice_id: returnInvoice.value.id, items: returnLines.value.filter((line) => line.quantity > 0).map((line) => ({ line_index: line.index, quantity: line.quantity, return_bucket: returnBucket(line), return_unit_id: returnUnitId(line) })), supplier_id: returnSupplier.value?.id, note: returnNote.value.trim() || null });
    if (!result.ok) { returnError.value = result.error; return; }
    const invoiceId = returnInvoice.value.id;
    supplierReturnOpen.value = false;
    notify(`تم تسجيل المرتجع بقيمة ${formatePrice(result.total)} ج.`, "success");
    await reload(true);
    if (selectedInvoice.value?.id === invoiceId) {
      const fresh = await purchasing.fetchPurchaseInvoice(invoiceId);
      if (fresh) openDetails(fresh);
    }
  } finally { returnBusy.value = false; }
}
function openAdvance(advance: SupplierAdvance, mode: "apply" | "refund"): void { advanceTarget.value = advance; advanceMode.value = mode; advanceAmount.value = mode === "apply" ? Math.min(advance.remaining_amount, selectedInvoice.value?.remaining_amount ?? 0) : advance.remaining_amount; advanceKey.value = id(); advanceOpen.value = true; }
async function confirmAdvance(): Promise<void> { if (!advanceTarget.value?.id || advanceError.value || advanceBusy.value) return; advanceBusy.value = true; try { const result = await purchasing.settleSupplierAdvance({ advanceId: advanceTarget.value.id, invoiceId: advanceMode.value === "apply" ? selectedInvoice.value?.id : undefined, amount: Number(advanceAmount.value), mode: advanceMode.value, key: advanceKey.value }); if (!result.ok) { notify(result.error, "error"); return; } notify("تمت تسوية سلفة المورد.", "success"); advanceOpen.value = false; if (selectedInvoice.value?.supplier_id) advances.value = await purchasing.fetchSupplierAdvances(selectedInvoice.value.supplier_id); await reload(true); if (selectedInvoice.value?.id) selectedInvoice.value = await purchasing.fetchPurchaseInvoice(selectedInvoice.value.id); } finally { advanceBusy.value = false; } }
function printInvoice(): void { if (import.meta.client) window.print(); }
async function togglePin(invoice: PurchaseInvoice): Promise<void> { if (!invoice.id) return; await purchasing.setPurchaseInvoicePinned(invoice.id, !invoice.pinned); await reload(true); }
function openPayment(invoice: PurchaseInvoice): void { paymentTarget.value = invoice; paymentAmount.value = undefined; paymentNote.value = ""; paymentKey.value = id(); paymentOpen.value = true; }
async function submitPayment(): Promise<void> { if (!paymentTarget.value?.id || paymentError.value || paying.value) return; paying.value = true; try { const amount = Number(paymentAmount.value); const result = await purchasing.paySupplierInvoice(paymentTarget.value.id, amount, paymentNote.value.trim() || null, paymentKey.value); if (!result.ok) { notify(result.error, "error"); return; } const target = paymentTarget.value; const paid = round2(target.paid_amount + Math.min(amount, target.remaining_amount)); const status = deriveSupplierInvoiceStatus(paid, result.remaining, target.total_amount); const update = (items: PurchaseInvoice[]) => items.map((item) => item.id === target.id ? { ...item, paid_amount: paid, remaining_amount: result.remaining, status } : item); pageInvoices.value = update(pageInvoices.value); pinnedInvoices.value = update(pinnedInvoices.value); notify(result.advance ? `تم السداد وتسجيل سلفة مستحقة لنا ${formatePrice(result.advance)} ج.` : result.remaining ? `تم تسجيل السداد، والمتبقي ${formatePrice(result.remaining)} ج.` : "تم سداد فاتورة المورد بالكامل.", "success"); paymentOpen.value = false; if (statusFilter.value !== "all" && statusFilter.value !== status) await reload(true); } finally { paying.value = false; } }
async function loadPayments(invoice: PurchaseInvoice): Promise<void> { if (!invoice.id) return; paymentsOpen.value = true; payments.value = await purchasing.fetchSupplierPayments(invoice.id); }
async function reload(reset = false): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    if (reset) { pageNumber.value = 1; pageCursors.value = [null]; }
    const page = await purchasing.fetchPurchaseInvoices({ supplierId: supplierFilterId.value || null, status: statusFilter.value as "all" | "paid" | "partial" | "unpaid", pageSize: 25, cursor: pageCursors.value[pageNumber.value - 1] });
    pageInvoices.value = page.items;
    pinnedInvoices.value = page.pinned;
    hasMore.value = page.hasMore;
    if (page.cursor) pageCursors.value[pageNumber.value] = page.cursor;
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "";
    loadError.value = message.includes("requires an index")
      ? "عرض فواتير مورد محدد يحتاج فهرسًا مركبًا في Firestore — أنشئه من رابط رسالة الخطأ في وحدة التحكم أو نفّذ firebase deploy --only firestore:indexes ثم أعد المحاولة."
      : "تعذر تحميل فواتير الموردين. تحقق من الاتصال ثم أعد المحاولة.";
  } finally { loading.value = false; }
}
async function nextPage(): Promise<void> { if (!hasMore.value || loading.value) return; pageNumber.value += 1; await reload(); }
async function previousPage(): Promise<void> { if (pageNumber.value <= 1 || loading.value) return; pageNumber.value -= 1; await reload(); }
watch(statusFilter, () => { void reload(true); });
watch(supplierFilterId, () => { void reload(true); });
onMounted(async () => {
  const authed = await useAuthReady();
  if (!authed) return; // layout redirects to /login
  productsStore.ensureInventorySubscription();
  await Promise.all([reload(true), productsStore.fetchProducts(), suppliers.fetchSuppliers(), cashbox.fetchCashbox()]);
  if (route.query.new === "1") startDraft();
  else if (route.query.invoice) {
    const invoiceId = String(route.query.invoice);
    const target = [...pinnedInvoices.value, ...pageInvoices.value].find((invoice) => invoice.id === invoiceId) ?? await purchasing.fetchPurchaseInvoice(invoiceId);
    if (target) openDetails(target);
  }
});
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
