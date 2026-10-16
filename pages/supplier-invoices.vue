<template>
  <div class="space-y-4">
    <UiAppPageHeader title="فواتير الموردين" description="المشتريات ومستحقات الموردين">
      <template #actions>
      <UButton color="success" icon="i-lucide-plus" @click="startDraft()">فاتورة مورد جديدة</UButton>
      </template>
    </UiAppPageHeader>
    <UAlert v-if="loadError" color="error" variant="soft" :title="loadError"><template #actions><UButton size="xs" color="error" variant="soft" :loading="loading" @click="reload(true)">إعادة المحاولة</UButton></template></UAlert>
    <UAlert v-if="supplierFilterId" color="info" variant="soft" :title="`عرض فواتير المورد: ${supplierFilterName || supplierFilterId}`"><template #actions><UButton size="xs" color="neutral" variant="soft" @click="clearSupplierFilter">عرض كل الفواتير</UButton></template></UAlert>
    <div class="grid gap-3 sm:grid-cols-3"><UCard variant="outline"><p class="text-xs text-gray-500">فواتير الصفحة</p><b class="text-xl">{{ visibleInvoices.length }}</b></UCard><UCard variant="outline"><p class="text-xs text-gray-500">قيمة البضائع بعد المرتجعات</p><b class="text-xl"><UiAppMoneyDisplay :text="formatePrice(totalPurchases)" /></b></UCard><UCard variant="outline"><p class="text-xs text-gray-500">مستحق الموردين في الصفحة</p><b class="text-xl text-red-600"><UiAppMoneyDisplay :text="formatePrice(totalPayable)" /></b></UCard></div>
    <div class="flex flex-wrap gap-2"><UInput v-model="search" icon="i-lucide-search" aria-label="بحث في فواتير الموردين المحملة" placeholder="بحث في الفواتير المحملة" class="w-full sm:max-w-sm" /><USelect v-model="statusFilter" :items="[{ label: 'كل الحالات', value: 'all' }, { label: 'غير مسددة', value: 'unpaid' }, { label: 'مسددة جزئيًا', value: 'partial' }, { label: 'مسددة', value: 'paid' }]" value-key="value" label-key="label" aria-label="حالة سداد فواتير الموردين" class="w-full sm:w-44" /></div>
    <UiAppCardsSkeleton v-if="loading" layout="list" :count="4" />
    <div v-else class="space-y-3">
      <UCard v-for="invoice in visibleInvoices" :key="invoice.id" variant="outline">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h2 class="font-bold">فاتورة توريد من {{ invoice.supplier_name || 'مورد غير مسمى' }}</h2><UBadge :color="statusColor(invoice)" variant="soft">{{ statusLabel(invoice) }}</UBadge><UBadge v-if="invoice.return_status" color="warning" variant="soft">مرتجع {{ invoice.return_status === 'full' ? 'كلي' : 'جزئي' }} · <UiAppMoneyDisplay :text="formatePrice(invoice.return_total || 0)" /></UBadge><UBadge v-if="invoice.pinned" color="warning" variant="soft">مثبتة</UBadge></div><p class="text-sm text-gray-500">{{ sourceLabel(invoice.source) }} · {{ formatDateOnly(invoice.created_at) }} · {{ invoice.items.length }} {{ invoice.items.length === 1 ? 'صنف' : 'أصناف' }}</p><div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm"><span>قيمة البضاعة <b><UiAppMoneyDisplay :text="formatePrice(invoice.total_amount)" /></b></span><span v-if="invoice.return_status">الصافي بعد المرتجعات <b><UiAppMoneyDisplay :text="formatePrice(invoice.total_amount - (invoice.return_total || 0))" /></b></span><span>مدفوع للمورد <UiAppMoneyDisplay :text="formatePrice(invoice.paid_amount)" /></span><span class="font-bold text-red-600">باقٍ للمورد <UiAppMoneyDisplay :text="formatePrice(invoice.remaining_amount)" /></span><span v-if="invoice.advance_amount" class="font-bold text-blue-700">سلفة لنا <UiAppMoneyDisplay :text="formatePrice(invoice.advance_amount)" /></span></div></div>
          <div class="flex flex-wrap gap-2"><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-eye" class="min-h-11" @click="openDetails(invoice)">عرض</UButton><UButton size="sm" v-if="invoice.remaining_amount > 0" color="success" icon="i-lucide-hand-coins" class="min-h-11" @click="openPayment(invoice)">تسديد</UButton><UDropdownMenu :items="supplierInvoiceActionItems(invoice)"><UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-ellipsis" class="min-h-11" :aria-label="`إجراءات فاتورة المورد ${invoice.supplier_name || ''}`">إجراءات أخرى</UButton></UDropdownMenu></div>
        </div>
      </UCard>
      <UEmpty v-if="!loadError && !visibleInvoices.length" icon="i-lucide-receipt" title="لا توجد فواتير موردين" />
      <div class="flex items-center justify-between gap-2 pt-2"><span class="text-xs text-gray-500">صفحة {{ pageNumber }} · حتى 25 فاتورة</span><div class="flex gap-2" dir="ltr"><UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-left" aria-label="الصفحة التالية" :disabled="loading || !hasMore" @click="nextPage" /><UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevron-right" aria-label="الصفحة السابقة" :disabled="loading || pageNumber <= 1" @click="previousPage" /></div></div>
    </div>

    <UiAppDialog v-model:open="draftDialogOpen" :title="draftSource ? 'فاتورة جديدة من فاتورة سابقة' : 'فاتورة مورد جديدة'" width="sm:max-w-[920px]">
      <div class="space-y-5">
        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-slate-800">بيانات المورد</h3>
          <UAlert v-if="suppliers.fetchError" color="error" variant="soft" :title="suppliers.fetchError"><template #actions><UButton size="xs" color="error" variant="soft" @click="reloadSuppliers">إعادة المحاولة</UButton></template></UAlert>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="المورد" required :error="showDraftErrors && !draftSource ? draftSupplierError : undefined">
              <USelectMenu :model-value="(draftSupplier ?? null) as Supplier | undefined" :items="supplierMenuItems" label-key="name" by="id" placeholder="اختر المورد" :search-input="{ placeholder: 'بحث عن مورد...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(s) => onPickDraftSupplier(s)" />
              <FormsSupplier v-model="showSupplierModal" :refresher="reloadSuppliers" @done="onDraftSupplierCreated" />
            </UFormField>
            <UFormField label="رقم فاتورة المورد"><UInput v-model="supplierRef" dir="ltr" class="w-full" /></UFormField>
            <UFormField v-if="draftSource && !draftSupplier" label="اسم المورد في الفاتورة السابقة" required :error="showDraftErrors ? draftSupplierError : undefined"><UInput v-model="supplierName" placeholder="اسم المورد" class="w-full" /></UFormField>
          </div>
        </section>
        <UAlert v-if="productsStore.inventorySyncState === 'error'" color="warning" variant="soft" title="تعذر تحديث قائمة المنتجات؛ قد تكون الأسعار والرصيد المعروض قديمة." />
        <h3 class="border-t border-slate-200 pt-3 text-sm font-semibold text-slate-800">الأصناف وتكلفتها</h3>
        <section v-for="(line, index) in draftLines" :key="line.key" class="space-y-3 rounded-xl border border-gray-200 p-3">
          <div class="flex items-center justify-between"><b class="text-sm">صنف {{ index + 1 }}</b><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="min-h-11 min-w-11" :aria-label="`حذف الصنف ${index + 1}`" :disabled="draftLines.length <= 1" @click="removeDraftLineWithExpenseSync(index)" /></div>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="المنتج" required :error="showDraftErrors && !line.family_id ? draftLineIssues[index]?.product : undefined"><USelectMenu :model-value="selectedFamily(line)" :items="familyOptions" label-key="name" by="id" placeholder="اختر المنتج" :search-input="{ placeholder: 'بحث باسم المنتج...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(family) => pickFamily(line, family)" /></UFormField>
            <UFormField v-if="line.family_id && selectedFamily(line)?.inventory_mode !== 'independent'" label="النوع" :error="showDraftErrors ? draftLineIssues[index]?.product : undefined"><USelectMenu :model-value="line.product" :items="productOptions(line)" label-key="variant_name" by="id" placeholder="اختر النوع" :search-input="{ placeholder: 'بحث عن نوع...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(product) => pickProduct(line, product)" /></UFormField>
            <UFormField v-if="line.family_id && selectedFamily(line)?.inventory_mode === 'independent' && selectedFamily(line)?.uses_variants !== false" label="النوع" :error="showDraftErrors && !line.variant_key ? draftLineIssues[index]?.product : undefined"><USelectMenu :model-value="selectedVariantOption(line)" :items="variantOptions(line)" label-key="name" by="key" placeholder="اختر النوع" :search-input="{ placeholder: 'بحث عن نوع...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(variant) => pickVariant(line, variant)" /></UFormField>
            <UFormField v-if="line.family_id && selectedFamily(line)?.inventory_mode === 'independent' && (selectedFamily(line)?.uses_variants === false || line.variant_key)" label="حجم العبوة" :error="showDraftErrors ? draftLineIssues[index]?.product : undefined"><USelectMenu :model-value="line.product" :items="packSizeOptions(line)" label-key="pack_size_name" by="id" placeholder="اختر حجم العبوة" :search-input="{ placeholder: 'بحث عن حجم عبوة...', icon: 'i-lucide-search' }" class="w-full" @update:model-value="(product) => pickProduct(line, product)" /></UFormField>
          </div>
          <div v-if="line.product" class="grid gap-3 sm:grid-cols-2">
            <UFormField label="وحدة الشراء" required :error="showDraftErrors ? draftLineIssues[index]?.unit : undefined"><USelectMenu :model-value="selectedUnit(line)" :items="unitOptions(line)" label-key="name" by="id" :search-input="false" class="w-full" @update:model-value="(unit) => pickUnit(line, unit)" /></UFormField>
            <UFormField label="الكمية" required :error="showDraftErrors ? draftLineIssues[index]?.quantity : undefined"><UInputNumber v-model="line.quantity" :min="selectedUnit(line)?.allows_fractional === true ? 0.0001 : 1" :step="selectedUnit(line)?.allows_fractional === true ? 0.0001 : 1" class="w-full" /></UFormField>
            <UFormField label="تكلفة وحدة الشراء" required :error="showDraftErrors ? draftLineIssues[index]?.cost : undefined"><UInputNumber v-model="line.unit_cost" :min="0" :step="0.0001" class="w-full" /></UFormField>
            <div class="col-span-full flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <span>إجمالي الصنف <b><UiAppMoneyDisplay :text="formatePrice(toNum(line.quantity) * toNum(line.unit_cost))" /></b></span>
              <span class="text-xs text-slate-600">المخزون الحالي: {{ stockQuantityLabel(line.product) }}</span>
              <UButton v-if="!pricingOpen[line.key] && !pricePolicyApplies(line) && line.priceMode === 'keep'" color="neutral" variant="link" size="sm" @click="pricingOpen[line.key] = true">تعديل سعر البيع</UButton>
            </div>
            <div v-if="pricingOpen[line.key] || pricePolicyApplies(line) || line.priceMode !== 'keep'" class="col-span-full space-y-3 rounded-lg border border-slate-200 p-3">
              <div class="flex flex-wrap items-center justify-between gap-2"><h4 class="text-sm font-semibold">سعر البيع بعد التوريد</h4><span class="text-xs text-slate-600">الحالي: <UiAppMoneyDisplay :text="formatePrice(selectedUnit(line)?.selling_price)" /></span><UButton v-if="pricingOpen[line.key] && !pricePolicyApplies(line) && line.priceMode === 'keep'" color="neutral" variant="link" size="sm" @click="pricingOpen[line.key] = false">إخفاء الخيارات</UButton></div>
              <UAlert v-if="pricePolicyApplies(line)" color="warning" variant="soft" title="التكلفة تتجاوز سعر البيع الحالي؛ اختر طريقة تحديث السعر." />
              <UFormField label="طريقة تحديث سعر البيع" :error="showDraftErrors ? draftLineIssues[index]?.pricing : undefined"><USelect :model-value="line.priceMode" :items="priceModeItems" value-key="value" label-key="label" class="w-full" @update:model-value="(mode) => setPriceMode(line, mode)" /></UFormField>
              <div v-if="line.priceMode !== 'keep'" class="grid gap-3 sm:grid-cols-2">
                <UFormField v-if="line.priceMode === 'proposed' && previewLine(line).proposed !== null" label="السعر المقترح (قابل للتعديل)" :error="showDraftErrors ? draftLineIssues[index]?.pricing : undefined"><UInputNumber v-model="line.approvedProposal" :min="0" :step="0.01" class="w-full" @update:model-value="line.proposalEdited = true" /></UFormField>
                <UFormField v-if="line.priceMode === 'custom'" label="سعر البيع المخصص" :error="showDraftErrors ? draftLineIssues[index]?.pricing : undefined"><UInputNumber v-model="line.customPrice" :min="0" :step="0.01" class="w-full" /></UFormField>
              </div>
              <p v-if="line.priceMode === 'proposed'" class="text-xs text-slate-600">متوسط التكلفة المتوقع: <UiAppMoneyDisplay :text="formatePrice(previewLine(line).avg)" /> · المقترح: <UiAppMoneyDisplay v-if="previewLine(line).proposed !== null" :text="formatePrice(previewLine(line).proposed)" /><span v-else>غير متاح</span></p>
              <UAlert v-if="line.priceMode === 'proposed' && previewLine(line).proposed === null" color="warning" variant="soft" title="لا يمكن حساب سعر مقترح؛ اختر سعرًا مخصصًا." />
              <details v-if="proposalsForProduct(line.product.id).length > 1" class="text-xs text-slate-600"><summary class="cursor-pointer">الأسعار المقترحة لبقية الوحدات</summary><div v-for="p in proposalsForProduct(line.product.id)" :key="p.unitId" class="mt-1 flex flex-wrap justify-between gap-2"><span>{{ p.unitName }}: {{ p.oldPrice === null ? '—' : formatePrice(p.oldPrice) }} → {{ p.proposed === null ? 'يدوي' : formatePrice(p.proposed) }}</span><span>هامش {{ p.rate === null ? '—' : `${Math.round(p.rate * 10000) / 100}%` }}</span></div></details>
            </div>
          </div>
        </section>
        <UButton color="neutral" variant="soft" icon="i-lucide-plus" :disabled="draftLines.length >= MAX_PURCHASE_ITEMS" @click="addDraftLineWithExpenseSync()">إضافة صنف</UButton>
        <section class="space-y-3 border-t border-slate-200 pt-4">
          <div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="text-sm font-semibold text-slate-800">مصاريف الشراء الإضافية</h3><p class="text-xs text-slate-500">المصاريف المدفوعة لطرف ثالث لا تُضاف إلى مستحق المورد.</p></div><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" :disabled="draftExpenses.length >= MAX_PURCHASE_EXPENSES" @click="addPurchaseExpense">إضافة مصروف</UButton></div>
          <UCard v-for="(expense, expenseIndex) in draftExpenses" :key="expense.id" variant="outline" class="space-y-3">
            <div class="flex items-center justify-between"><b class="text-sm">مصروف {{ expenseIndex + 1 }}</b><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="min-h-11 min-w-11" :aria-label="`حذف المصروف ${expenseIndex + 1}`" @click="draftExpenses.splice(expenseIndex, 1)" /></div>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField label="نوع المصروف"><USelect v-model="expense.type" :items="expenseTypeItems" value-key="value" label-key="label" class="w-full" @update:model-value="onExpenseTypeChange(expense)" /></UFormField>
              <UFormField :label="expense.type === 'custom' || expense.type === 'tip' ? 'الوصف' : 'وصف إضافي'"><UInput v-model="expense.description" class="w-full" /></UFormField>
              <UFormField label="المبلغ بالجنيه" :error="showDraftErrors ? expenseAmountIssue(expense) : undefined"><UInputNumber v-model="expense.amount" :min="0" :step="0.01" class="w-full" /></UFormField>
              <UFormField label="طريقة التوزيع" :error="showDraftErrors ? expenseAllocationIssue(expense) : undefined"><USelect v-model="expense.allocation_method" :items="expenseAllocationItems" value-key="value" label-key="label" class="w-full" @update:model-value="setExpenseAllocationMethod(expense, $event)" /></UFormField>
              <UFormField label="المستلم / الجهة"><UInput v-model="expense.recipient" class="w-full" /></UFormField>
              <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <UCheckbox v-model="expense.capitalize" label="يدخل في تكلفة المخزون" @update:model-value="expense.confirmTipCapitalization = false" />
                <UCheckbox v-model="expense.paid" label="مدفوع الآن" />
              </div>
            </div>
            <UAlert v-if="expense.type === 'tip' && expense.capitalize" color="warning" variant="soft" title="الإكرامية لا تُرسمل تلقائيًا؛ أكد إدخالها في تكلفة المخزون إذا كانت مرتبطة مباشرة بالتوريد."><template #actions><UCheckbox v-model="expense.confirmTipCapitalization" label="أؤكد رسملة هذا المصروف" /></template></UAlert>
            <div class="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
              <div class="flex justify-between gap-2"><span>توزيع المصروف</span><b>{{ formatePrice(expense.amount) }}</b></div>
              <div v-for="(line, lineIndex) in draftLines" :key="line.key" class="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-slate-200 pt-2">
                <span>{{ line.product ? `${line.product.family_name || line.product.name}${line.product.variant_name ? ` — ${line.product.variant_name}` : ''}` : `صنف ${lineIndex + 1}` }} · {{ line.quantity }} {{ line.unit_name || 'وحدة' }}</span>
                <UFormField v-if="expense.allocation_method === 'manual'" :label="`توزيع الصنف ${lineIndex + 1}`" :error="showDraftErrors && expenseAllocationIssue(expense) ? 'راجع مجموع التوزيع' : undefined"><UInputNumber v-model="expense.manualAllocations[lineIndex]" :min="0" :step="0.01" class="w-32" /><p class="text-xs text-slate-500">التوزيع المقترح: {{ formatePrice(suggestedExpenseAllocationValues(expense)[lineIndex] || 0) }}</p></UFormField>
                <b v-else>{{ formatePrice(expenseAllocationValues(expense)[lineIndex] || 0) }}</b>
              </div>
              <div v-if="expense.allocation_method === 'manual'" class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2"><span>الفرق المطلوب توزيعه: {{ formatePrice(expenseAllocationDifference(expense)) }}</span><UButton size="xs" color="neutral" variant="link" @click="recalculateExpenseAllocation(expense)">إعادة التوزيع المقترح</UButton></div>
            </div>
          </UCard>
          <div class="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
            <span>إجمالي الأصناف (مستحق المورد)</span><b class="text-end">{{ formatePrice(draftTotal) }}</b>
            <span>مصاريف مرسملة</span><b class="text-end">{{ formatePrice(capitalizedExpenseTotal) }}</b>
            <span>إجمالي تكلفة الاقتناء</span><b class="text-end">{{ formatePrice(draftTotal + capitalizedExpenseTotal) }}</b>
            <span>مصاريف غير مرسملة</span><b class="text-end">{{ formatePrice(nonCapitalizedExpenseTotal) }}</b>
            <span class="font-semibold">إجمالي الإنفاق المرتبط بالشراء</span><b class="text-end font-semibold">{{ formatePrice(draftTotal + allExpenseTotal) }}</b>
            <span>مدفوع للمورد الآن</span><b class="text-end">{{ formatePrice(toNum(paidNow)) }}</b>
            <span>مدفوع لمستلمي المصاريف</span><b class="text-end">{{ formatePrice(paidExpensesTotal) }}</b>
            <span>المتبقي للمورد</span><b class="text-end text-red-600">{{ formatePrice(Math.max(0, draftTotal - toNum(paidNow))) }}</b>
          </div>
          <div class="space-y-1 text-sm">
            <div v-for="(line, lineIndex) in draftLines" :key="`effective-${line.key}`" class="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-slate-100 py-1">
              <span>{{ line.product?.family_name || line.product?.name || `صنف ${lineIndex + 1}` }}</span><span>الأصل {{ formatePrice(line.unit_cost) }}</span><span>مصاريف {{ formatePrice(capitalizedAllocationByLine[lineIndex] || 0) }}</span><b>فعلي {{ formatePrice(effectiveUnitCostPreview(lineIndex)) }}</b>
            </div>
          </div>
        </section>
        <h3 class="border-t border-slate-200 pt-3 text-sm font-semibold text-slate-800">دفعة المورد</h3>
        <div class="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
          <span>إجمالي الفاتورة</span><b class="text-end"><UiAppMoneyDisplay :text="formatePrice(draftTotal)" /></b>
          <span>رصيد الخزنة</span><b class="text-end"><UiAppMoneyDisplay v-if="!cashbox.loading && cashbox.syncState !== 'error'" :text="formatePrice(cashbox.balance)" /><span v-else>غير متاح</span></b>
          <p v-if="cashbox.syncState === 'cache'" class="col-span-full text-xs text-amber-700">الرصيد المعروض من نسخة مخزنة.</p>
          <UFormField label="المدفوع الآن" class="col-span-full" :error="showDraftErrors ? draftPaymentError : undefined"><UInputNumber v-model="paidNow" :min="0" :max="cashbox.balance" :step="0.01" class="w-full" /></UFormField>
          <span>المتبقي للمورد</span><b class="text-end text-red-600"><UiAppMoneyDisplay :text="formatePrice(Math.max(0, draftTotal - toNum(paidNow)))" /></b>
          <span v-if="toNum(paidNow) > draftTotal">سلفة مستحقة لنا</span><b v-if="toNum(paidNow) > draftTotal" class="text-end text-blue-700"><UiAppMoneyDisplay :text="formatePrice(toNum(paidNow) - draftTotal)" /></b>
        </div>
        <UAlert v-if="draftCashError" color="warning" variant="soft" :title="draftCashError"><template #actions><UButton size="xs" color="warning" variant="soft" @click="cashbox.fetchCashbox()">إعادة المحاولة</UButton></template></UAlert>
      </div>
      <template #footer><div class="w-full space-y-2"><UAlert v-if="draftError" color="error" variant="soft" :title="draftError" /><p v-else-if="showDraftErrors && !draftReady" class="text-sm text-amber-700" role="status">راجع الحقول المميزة في المسودة قبل الحفظ.</p><div class="flex justify-between gap-2 text-sm font-semibold"><span>الإجمالي</span><UiAppMoneyDisplay :text="formatePrice(draftTotal)" /></div><div class="flex gap-2"><UButton color="success" class="min-h-11 flex-1" icon="i-lucide-check" :loading="savingDraft" @click="confirmDraft">تأكيد وحفظ الفاتورة</UButton><UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="savingDraft" @click="draftOpen = false">إلغاء</UButton></div></div></template>
    </UiAppDialog>

    <UiAppDialog v-model:open="detailsOpen" :title="`فاتورة ${selectedInvoice?.supplier_name || 'المورد'}`">
      <div v-if="selectedInvoice" class="space-y-3"><div class="grid grid-cols-2 gap-2 text-sm"><span>التاريخ</span><b>{{ formatDateOnly(selectedInvoice.created_at) }}</b><span>مستحق المورد الأصلي</span><b>{{ formatePrice(selectedInvoice.total_amount) }}</b><span>مصاريف مرسملة</span><b>{{ formatePrice(selectedInvoice.capitalized_expense_total || 0) }}</b><span>مصاريف غير مرسملة</span><b>{{ formatePrice(selectedInvoice.non_capitalized_expense_total || 0) }}</b><span>إجمالي الإنفاق</span><b>{{ formatePrice(selectedInvoice.purchase_outlay_total ?? selectedInvoice.total_amount) }}</b><span>المرتجعات</span><b>{{ formatePrice(selectedInvoice.return_total || 0) }}</b><span>المدفوع للمورد</span><b>{{ formatePrice(selectedInvoice.paid_amount) }}</b><span>الباقي للمورد</span><b class="text-red-600">{{ formatePrice(selectedInvoice.remaining_amount) }}</b></div><div class="max-h-[40vh] space-y-2 overflow-y-auto"><UCard v-for="(item, index) in selectedInvoice.items" :key="`${item.product_id}-${index}`" variant="outline"><div class="flex justify-between gap-2 text-sm"><b>{{ item.product_name }}</b><span>{{ item.quantity }} {{ item.unit_name || 'وحدة' }}</span></div><div class="mt-1 text-xs text-gray-500">تكلفة المورد {{ formatePrice(item.unit_cost) }} · المصروف المرسمل {{ formatePrice(item.capitalized_expense_amount || 0) }} · التكلفة الفعلية للوحدة {{ formatePrice(item.effective_unit_cost ?? item.unit_cost) }}</div><div class="mt-1 text-xs text-gray-500">إجمالي المورد <b>{{ formatePrice(item.line_total) }}</b> · إجمالي التكلفة الفعلية <b>{{ formatePrice(item.effective_line_total ?? item.line_total) }}</b></div></UCard></div><section v-if="selectedInvoice.expenses?.length" class="space-y-2 border-t pt-3"><h3 class="font-semibold">مصاريف الشراء الإضافية</h3><UCard v-for="expense in selectedInvoice.expenses" :key="expense.id" variant="outline"><div class="flex flex-wrap items-center justify-between gap-2 text-sm"><div><b>{{ expenseTypeLabel(expense.type) }} · {{ expense.description || 'بدون وصف' }}</b><p class="text-xs text-slate-500">{{ expense.capitalize ? 'مرسمل في المخزون' : 'غير مرسمل' }} · {{ expense.recipient || 'جهة غير محددة' }} · {{ expense.paid ? 'مدفوع' : 'غير مدفوع' }}</p></div><b>{{ formatePrice(expense.amount) }}</b></div><div class="mt-2 space-y-1 text-xs text-slate-600"><p v-for="allocation in expense.allocations" :key="allocation.line_index">{{ selectedInvoice.items[allocation.line_index]?.product_name || `صنف ${allocation.line_index + 1}` }}: {{ formatePrice(allocation.allocated_amount) }}</p></div><UButton v-if="!expense.paid" size="xs" color="success" variant="soft" class="mt-2 min-h-11" :loading="payingExpenseId === expense.id" @click="payRecordedExpense(expense.id)">تسجيل سداد المصروف</UButton></UCard></section><ReturnHistory v-if="selectedInvoice.return_status" :supplier-returns="selectedReturns" :loading="returnsLoading" :error="returnsError" /><div class="no-print flex flex-wrap gap-2"><UButton color="neutral" variant="soft" icon="i-lucide-printer" @click="printInvoice">طباعة الفاتورة</UButton><UButton color="neutral" variant="soft" icon="i-lucide-history" :disabled="!selectedInvoice.payment_ids?.length" @click="loadPayments(selectedInvoice)">سجل السداد</UButton><UButton v-if="selectedInvoice.return_status !== 'full'" color="warning" variant="soft" icon="i-lucide-undo-2" @click="openReturn(selectedInvoice)">إنشاء مرتجع</UButton></div></div>
      <div v-if="selectedInvoice?.supplier_id && advances.length" class="mt-3 space-y-2 border-t pt-3">
        <h3 class="font-semibold">سلف مستحقة لنا من المورد</h3>
        <div v-for="advance in advances" :key="advance.id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
          <span>{{ formatePrice(advance.remaining_amount) }}</span>
          <div class="flex gap-2"><UButton v-if="selectedInvoice.remaining_amount > 0" size="xs" color="success" @click="openAdvance(advance, 'apply')">تسوية مع الفاتورة</UButton><UButton size="xs" color="neutral" variant="soft" @click="openAdvance(advance, 'refund')">استرداد نقدي</UButton></div>
        </div>
      </div>
    </UiAppDialog>
    <UiAppDialog v-model:open="supplierReturnOpen" title="مرتجع فاتورة مورد" :z-index="70">
      <div v-if="returnInvoice" class="max-h-[65vh] space-y-3 overflow-y-auto">
        <p class="text-sm">{{ returnInvoice.supplier_name }} · إجمالي الفاتورة {{ formatePrice(returnInvoice.total_amount) }}</p>
        <div v-for="line in returnLines" :key="line.index" class="rounded-lg border p-3 text-sm">
          <div class="flex justify-between gap-2"><b>{{ line.name }}</b><span>المتاح من الفاتورة: {{ line.max }} {{ line.unit }}</span></div>
          <div class="mt-1 text-xs text-gray-500">تكلفة الوحدة الأصلية {{ formatePrice(line.cost) }}</div>
          <UFormField label="المكوّن الفعلي المراد إرجاعه" class="mt-2">
            <USelect v-model="line.componentKey" :items="returnComponentOptions(line)" value-key="value" label-key="label" class="w-full" />
          </UFormField>
          <p class="mt-1 text-xs text-gray-500">الرصيد الفعلي المحدد: {{ returnComponentBalance(line) }}</p>
          <UFormField label="الكمية المرتجعة" :error="returnPhysicalError(line) || undefined" class="mt-2">
            <UInputNumber v-model="line.quantity" :min="0" :max="returnMaxQuantity(line)" :step="line.fractional ? 0.0001 : 1" class="w-full" />
          </UFormField>
          <div class="mt-1 text-xs">قيمة الصنف: {{ formatePrice(line.quantity * line.cost) }}</div>
        </div>
        <UEmpty v-if="!returnLines.length" title="لا توجد أصناف قابلة للإرجاع" />
        <UFormField v-if="returnReceivable > 0 && !returnInvoice.supplier_id" label="المورد الذي سيُسجل له الرصيد المستحق لنا" required>
          <USelectMenu :model-value="returnSupplier ?? undefined" :items="suppliers.list" label-key="name" by="id" placeholder="اختر المورد" class="w-full" @update:model-value="returnSupplier = $event ?? null" />
          <UButton size="xs" color="neutral" variant="link" @click="showReturnSupplierModal = true">إضافة مورد</UButton>
          <FormsSupplier v-model="showReturnSupplierModal" :refresher="reloadSuppliers" @done="onReturnSupplierCreated" />
        </UFormField>
        <UFormField label="ملاحظة"><UInput v-model="returnNote" class="w-full" /></UFormField>
        <UAlert color="info" variant="soft" :title="`قيمة المرتجع: ${formatePrice(returnTotal)} · تخفيض المستحق: ${formatePrice(returnPayableReduction)} · رصيد لنا: ${formatePrice(returnReceivable)}`" />
        <UAlert v-if="returnError" color="error" variant="soft" :title="returnError" />
      </div>
      <template #footer><div class="flex w-full gap-2"><UButton color="warning" :loading="returnBusy" :disabled="!returnCanSubmit" @click="submitSupplierReturn">تأكيد المرتجع</UButton><UButton color="neutral" variant="soft" :disabled="returnBusy" @click="supplierReturnOpen = false">إلغاء</UButton></div></template>
    </UiAppDialog>
    <UiAppDialog v-model:open="advanceOpen" :title="advanceMode === 'apply' ? 'تسوية سلفة المورد' : 'استرداد سلفة المورد'">
      <UFormField label="المبلغ" :error="advanceError || undefined"><UInputNumber v-model="advanceAmount" :min="0.01" :max="advanceMode === 'apply' ? Math.min(advanceTarget?.remaining_amount ?? 0, selectedInvoice?.remaining_amount ?? 0) : advanceTarget?.remaining_amount ?? 0" :step="0.01" class="w-full" /></UFormField>
      <template #footer><UButton color="success" block :loading="advanceBusy" :disabled="!!advanceError" @click="confirmAdvance">تأكيد</UButton></template>
    </UiAppDialog>
    <UiAppDialog v-model:open="paymentOpen" :title="`سداد فاتورة ${paymentTarget?.supplier_name || 'المورد'}`">
      <div v-if="paymentTarget" class="space-y-3"><div class="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm"><span>الباقي</span><b>{{ formatePrice(paymentTarget.remaining_amount) }}</b><span>رصيد الخزنة</span><b>{{ formatePrice(cashbox.balance) }}</b></div><UFormField label="مبلغ الدفعة" :error="paymentError || undefined"><UInputNumber v-model="paymentAmount" :min="0" :max="cashbox.balance" :step="0.01" class="w-full" /></UFormField><p v-if="(paymentAmount || 0) > paymentTarget.remaining_amount" class="text-sm text-blue-700">الزيادة سلفة مستحقة لنا: {{ formatePrice((paymentAmount || 0) - paymentTarget.remaining_amount) }}</p><UFormField label="ملاحظة"><UInput v-model="paymentNote" class="w-full" /></UFormField><UAlert v-if="paymentError" color="warning" variant="soft" :title="paymentError" /></div>
      <template #footer><div class="flex w-full gap-2"><UButton color="success" class="flex-1" :loading="paying" :disabled="!!paymentError" @click="submitPayment">تأكيد السداد</UButton><UButton color="neutral" variant="soft" class="flex-1" :disabled="paying" @click="paymentOpen = false">إلغاء</UButton></div></template>
    </UiAppDialog>
    <UiAppDialog v-model:open="paymentsOpen" title="سجل سداد المورد"><div class="max-h-[60vh] space-y-2 overflow-y-auto"><UCard v-for="payment in payments" :key="payment.id" variant="outline"><div class="flex justify-between"><span>{{ formatDateOnly(payment.created_at) }}</span><b>{{ formatePrice(payment.amount) }}</b></div><p v-if="payment.return_id" class="text-xs text-amber-700">تسوية من مرتجع {{ payment.return_id }}</p><p v-if="payment.note" class="text-xs text-gray-500">{{ payment.note }}</p></UCard><UEmpty v-if="!payments.length" icon="i-lucide-history" title="لا توجد دفعات مسجلة" /></div></UiAppDialog>
    <div v-if="selectedInvoice" class="print-sheet" dir="rtl"><h1>فاتورة مورد</h1><p>{{ selectedInvoice.supplier_name }} · {{ selectedInvoice.invoice_number || selectedInvoice.supplier_ref || '' }}</p><p>{{ formatDateOnly(selectedInvoice.created_at) }}</p><table><thead><tr><th>المنتج</th><th>الوحدة</th><th>الكمية</th><th>تكلفة المورد</th><th>المصاريف المرسملة</th><th>تكلفة الوحدة الفعلية</th><th>الإجمالي</th></tr></thead><tbody><tr v-for="(item, index) in selectedInvoice.items" :key="`${item.product_id}-print-${index}`"><td>{{ item.product_name }}</td><td>{{ item.unit_name || 'وحدة' }}</td><td>{{ item.quantity }}</td><td>{{ formatePrice(item.unit_cost) }}</td><td>{{ formatePrice(item.capitalized_expense_amount || 0) }}</td><td>{{ formatePrice(item.effective_unit_cost ?? item.unit_cost) }}</td><td>{{ formatePrice(item.effective_line_total ?? item.line_total) }}</td></tr></tbody></table><div v-for="expense in selectedInvoice.expenses || []" :key="`print-expense-${expense.id}`"><p>{{ expenseTypeLabel(expense.type) }}: {{ expense.description || '' }} · {{ formatePrice(expense.amount) }} · {{ expense.capitalize ? 'مرسمل' : 'غير مرسمل' }} · {{ expense.paid ? 'مدفوع' : 'غير مدفوع' }}</p></div><p>مستحق المورد: {{ formatePrice(selectedInvoice.total_amount) }}</p><p>تكلفة الاقتناء: {{ formatePrice(selectedInvoice.total_amount + (selectedInvoice.capitalized_expense_total || 0)) }} · مصاريف غير مرسملة: {{ formatePrice(selectedInvoice.non_capitalized_expense_total || 0) }}</p><p>المدفوع للمورد: {{ formatePrice(selectedInvoice.paid_amount) }} · الباقي: {{ formatePrice(selectedInvoice.remaining_amount) }}</p></div>
  </div>
</template>

<script setup lang="ts">
import type { Product, ProductUnit } from "~/types";
import type { PurchaseInvoice, PurchaseInvoiceItem, Supplier, SupplierPayment, SupplierAdvance, SupplierReturn } from "~/types/finance";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import { deriveSupplierInvoiceStatus, supplierInvoiceStatus } from "~/types/finance";
import { MAX_PURCHASE_ITEMS, convertUnitPrice, proposedSellingPrice, purchaseLineBaseCost, purchaseLineBaseQuantity, purchasePreviewAverage, purchaseUnitProposals, purchasableUnitsForProduct, round2, round4, splitSupplierReturn, toNum, unitPurchasePrice, stockQuantityLabel } from "~/composables/finance";
import { toDateSafe } from "~/types";
import { useSuppliersStore } from "~/stores/suppliers";
import { MAX_PURCHASE_EXPENSES, purchaseExpenseAllocationPreview, purchaseExpenseLines, purchaseExpenseSuggestedAllocation, type PurchaseExpenseDraft } from "~/composables/purchaseExpenses";

interface DraftLine { key: string; family_id: string | null; variant_key?: string | null; product?: Product; unit_id: string; unit_name: string; unit_factor: number; quantity: number; unit_cost: number; priceMode: "keep" | "proposed" | "custom"; approvedProposal?: number | null; proposalEdited?: boolean; customPrice?: number }
interface DraftLineIssue { product?: string; unit?: string; quantity?: string; cost?: string; pricing?: string }
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
const draftExpenses = ref<PurchaseExpenseDraft[]>([]);
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
const draftDialogOpen = computed({
  get: () => draftOpen.value,
  set: (open: boolean) => { if (!savingDraft.value) draftOpen.value = open; },
});
const draftError = ref("");
const showDraftErrors = ref(false);
const pricingOpen = ref<Record<string, boolean>>({});
const requestKey = ref("");
const priceModeItems = [{ label: "الإبقاء على السعر الحالي", value: "keep" }, { label: "اعتماد السعر المقترح", value: "proposed" }, { label: "سعر مخصص", value: "custom" }];
const expenseTypeItems = [{ label: "توصيل / نقل", value: "delivery" }, { label: "تحميل وتنزيل", value: "loading" }, { label: "مناولة مباشرة", value: "handling" }, { label: "مصروف آخر", value: "custom" }, { label: "إكرامية", value: "tip" }];
const expenseAllocationItems = [{ label: "حسب قيمة الشراء", value: "value" }, { label: "حسب الكمية الأساسية المتجانسة", value: "quantity" }, { label: "بالتساوي لكل سطر", value: "equal" }, { label: "توزيع يدوي", value: "manual" }];
const draftTotal = computed(() => round2(draftLines.value.reduce((sum, line) => sum + round2(toNum(line.quantity) * toNum(line.unit_cost)), 0)));
const expenseLines = computed(() => purchaseExpenseLines(draftLines.value));
const expenseAllocationPreviewById = computed(() => new Map(draftExpenses.value.map((expense) => {
  try { return [expense.id, purchaseExpenseAllocationPreview(expense, expenseLines.value)] as const; }
  catch { return [expense.id, draftLines.value.map(() => 0)] as const; }
})));
const expenseSuggestedById = computed(() => new Map(draftExpenses.value.map((expense) => {
  try { return [expense.id, purchaseExpenseSuggestedAllocation(expense, expenseLines.value)] as const; }
  catch { return [expense.id, draftLines.value.map(() => 0)] as const; }
})));
function expenseAllocationValues(expense: PurchaseExpenseDraft): number[] { return expenseAllocationPreviewById.value.get(expense.id) || []; }
function calculateExpenseAllocationIssue(expense: PurchaseExpenseDraft): string {
  if (!Number.isFinite(expense.amount) || expense.amount <= 0 || Math.abs(expense.amount * 100 - Math.round(expense.amount * 100)) > 1e-7) return "أدخل مبلغًا أكبر من صفر حتى قرشين عشريين، أو احذف المصروف.";
  if ((expense.type === "custom" || expense.type === "tip") && !expense.description.trim()) return "أدخل وصف المصروف.";
  if (expense.type === "tip" && expense.capitalize && !expense.confirmTipCapitalization) return "أكد رسملة الإكرامية صراحة.";
  try {
    if (expense.allocation_method === "manual") {
      if (expense.manualAllocations.length !== draftLines.value.length || expense.manualAllocations.some((value) => !Number.isFinite(value) || value < 0)) return "أدخل توزيعًا غير سالب لكل سطر.";
      if (Math.round(expenseAllocationDifference(expense) * 100) !== 0) return "يجب أن يساوي مجموع التوزيع مبلغ المصروف.";
      return "";
    }
    purchaseExpenseAllocationPreview(expense, expenseLines.value);
    return "";
  } catch (error) {
    return error instanceof Error && error.message === "EXPENSE_QUANTITY_UNITS_INCOMPARABLE" ? "لا يمكن مقارنة الوحدات الأساسية بين هذه الأصناف؛ اختر القيمة أو التوزيع المتساوي." : "تعذر توزيع المصروف على الأصناف الحالية.";
  }
}
const expenseIssueById = computed(() => new Map(draftExpenses.value.map((expense) => [expense.id, calculateExpenseAllocationIssue(expense)])));
function expenseAllocationIssue(expense: PurchaseExpenseDraft): string { return expenseIssueById.value.get(expense.id) || ""; }
function expenseAmountIssue(expense: PurchaseExpenseDraft): string { return expenseAllocationIssue(expense); }
function expenseAllocationDifference(expense: PurchaseExpenseDraft): number { return round2(toNum(expense.amount) - expense.manualAllocations.reduce((sum, value) => sum + toNum(value), 0)); }
const capitalizedAllocationByLine = computed(() => draftLines.value.map((_, index) => round2(draftExpenses.value.reduce((sum, expense) => sum + (expense.capitalize ? toNum(expenseAllocationValues(expense)[index]) : 0), 0))));
const capitalizedExpenseTotal = computed(() => round2(draftExpenses.value.reduce((sum, expense) => sum + (expense.capitalize ? toNum(expense.amount) : 0), 0)));
const nonCapitalizedExpenseTotal = computed(() => round2(draftExpenses.value.reduce((sum, expense) => sum + (!expense.capitalize ? toNum(expense.amount) : 0), 0)));
const allExpenseTotal = computed(() => round2(draftExpenses.value.reduce((sum, expense) => sum + toNum(expense.amount), 0)));
const paidExpensesTotal = computed(() => round2(draftExpenses.value.reduce((sum, expense) => sum + (expense.paid ? toNum(expense.amount) : 0), 0)));
function effectiveUnitCostPreview(index: number): number { const line = draftLines.value[index]; return line && line.quantity > 0 ? (round2(toNum(line.unit_cost) * line.quantity) + (capitalizedAllocationByLine.value[index] ?? 0)) / line.quantity : 0; }
function newPurchaseExpense(): PurchaseExpenseDraft { return { id: id(), type: "delivery", description: "", amount: 0, allocation_method: "value", capitalize: true, paid: false, recipient: "", manualAllocations: draftLines.value.map(() => 0), confirmTipCapitalization: false }; }
function suggestedExpenseAllocationValues(expense: PurchaseExpenseDraft): number[] { return expenseSuggestedById.value.get(expense.id) || []; }
function addPurchaseExpense(): void { if (draftExpenses.value.length < MAX_PURCHASE_EXPENSES) draftExpenses.value.push(newPurchaseExpense()); }
function onExpenseTypeChange(expense: PurchaseExpenseDraft): void { expense.capitalize = expense.type !== "tip"; expense.confirmTipCapitalization = false; }
function setExpenseAllocationMethod(expense: PurchaseExpenseDraft, method: string): void {
  if (method === "manual") {
    try { expense.manualAllocations = purchaseExpenseSuggestedAllocation({ ...expense, allocation_method: "value" }, expenseLines.value); }
    catch { expense.manualAllocations = draftLines.value.map(() => 0); }
    expense.allocation_method = "manual";
    return;
  }
  if (method === "value" || method === "quantity" || method === "equal") expense.allocation_method = method;
}
function recalculateExpenseAllocation(expense: PurchaseExpenseDraft): void { expense.manualAllocations = purchaseExpenseSuggestedAllocation(expense, expenseLines.value); }
function addDraftLineWithExpenseSync(): void { if (draftLines.value.length >= MAX_PURCHASE_ITEMS) return; addDraftLine(); for (const expense of draftExpenses.value) if (expense.allocation_method === "manual") expense.manualAllocations.push(0); }
function removeDraftLineWithExpenseSync(index: number): void { if (draftLines.value.length <= 1) return; draftLines.value.splice(index, 1); for (const expense of draftExpenses.value) if (expense.allocation_method === "manual") expense.manualAllocations.splice(index, 1); }
const draftCashOutflow = computed(() => round2(toNum(paidNow.value) + paidExpensesTotal.value));
const draftCashError = computed(() => draftCashOutflow.value > 0 && (cashbox.loading || cashbox.syncState === "error") ? "تعذر تأكيد رصيد الخزنة؛ أعد تحميله قبل تسجيل أي دفعة." : "");
const draftExpenseIssues = computed(() => draftExpenses.value.map((expense) => expenseIssueById.value.get(expense.id) || ""));
const draftSupplierError = computed(() => draftSupplier.value?.id || (draftSource.value && supplierName.value.trim()) ? "" : "اختر المورد أولًا.");
const draftLineIssues = computed<DraftLineIssue[]>(() => draftLines.value.map((line) => {
  const issue: DraftLineIssue = {};
  if (!line.product?.id || line.product.is_active === false || !selectedFamily(line)) issue.product = "اختر منتجًا نشطًا ونوعه أو حجم عبوته.";
  const unit = selectedUnit(line);
  if (line.product?.id && (!unit || !Number.isFinite(line.unit_factor) || line.unit_factor <= 0 || Number(unit.factor) !== line.unit_factor)) issue.unit = "اختر وحدة شراء صالحة لهذا المنتج.";
  if (!Number.isFinite(line.quantity) || line.quantity <= 0 || (unit?.allows_fractional !== true && !Number.isInteger(line.quantity))) issue.quantity = "أدخل كمية موجبة تناسب الوحدة.";
  if (!Number.isFinite(line.unit_cost) || line.unit_cost < 0) issue.cost = "أدخل تكلفة صالحة للوحدة.";
  if (line.product?.id && unit && !issue.quantity && !issue.cost) {
    if (pricePolicyApplies(line) && line.priceMode === "keep") issue.pricing = "التكلفة تتجاوز سعر البيع الحالي؛ اختر طريقة تحديثه.";
    else if (line.priceMode === "proposed" && (previewLine(line).proposed === null || line.approvedProposal == null || !Number.isFinite(Number(line.approvedProposal)) || Number(line.approvedProposal) < 0)) issue.pricing = "أدخل سعر البيع المقترح أو اختر سعرًا مخصصًا.";
    else if (line.priceMode === "custom" && (line.customPrice == null || !Number.isFinite(Number(line.customPrice)) || Number(line.customPrice) < 0)) issue.pricing = "أدخل سعر بيع مخصصًا صالحًا.";
  }
  return issue;
}));
const draftPaymentError = computed(() => {
  const paid = paidNow.value == null ? 0 : Number(paidNow.value);
  if (!Number.isFinite(paid) || paid < 0) return "أدخل مبلغًا صالحًا أو اتركه صفرًا.";
  if (draftCashError.value) return draftCashError.value;
  if (draftCashOutflow.value > cashbox.balance) return "إجمالي المدفوع للمورد ومستلمي المصاريف يتجاوز رصيد الخزنة.";
  if (paid > draftTotal.value && !draftSupplier.value?.id) return "اختر موردًا مسجلًا لحفظ الزيادة كسلفة.";
  return "";
});
const draftReady = computed(() => !savingDraft.value && !draftSupplierError.value && draftLines.value.length > 0 && draftLineIssues.value.every((issue) => Object.keys(issue).length === 0) && draftExpenseIssues.value.every((issue) => !issue) && !draftPaymentError.value);
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
function supplierInvoiceActionItems(invoice: PurchaseInvoice) {
  return [
    ...(invoice.return_status !== "full" ? [{ label: "إنشاء مرتجع", icon: "i-lucide-undo-2", onSelect: () => openReturn(invoice) }] : []),
    { label: invoice.pinned ? "إلغاء التثبيت" : "تثبيت الفاتورة", icon: invoice.pinned ? "i-lucide-pin-off" : "i-lucide-pin", onSelect: () => { void togglePin(invoice); } },
    { label: "فاتورة جديدة من هذه", icon: "i-lucide-copy-plus", onSelect: () => startDraft(invoice) },
  ];
}
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
function addDraftLine(): void { if (draftLines.value.length < MAX_PURCHASE_ITEMS) draftLines.value.push(newLine()); }
function productOptions(line: DraftLine): Product[] {
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
  line.variant_key = variant?.key || null; line.product = undefined; line.unit_id = ""; line.unit_name = ""; line.unit_factor = Number.NaN; line.unit_cost = 0; line.priceMode = "keep"; line.approvedProposal = undefined; line.proposalEdited = false; line.customPrice = undefined;
  if (!variant) return;
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
    line.priceMode = "keep";
    line.approvedProposal = undefined;
    line.proposalEdited = false;
    line.customPrice = undefined;
  }
  const selected = selectedFamily(line);
  if (selected?.inventory_mode === "independent") {
    if (selected.uses_variants === false) line.variant_key = "default";
    const variants = variantOptions(line); if (selected.uses_variants !== false && variants.length === 1) pickVariant(line, variants[0]);
    if (selected.uses_variants === false || line.variant_key) {
      const sizes = packSizeOptions(line); if (sizes.length === 1) pickProduct(line, sizes[0]);
    }
  } else {
    const products = productOptions(line); if (selected?.uses_variants === false && products.length === 1) pickProduct(line, products[0]);
  }
}
function pickUnit(line: DraftLine, unit?: ProductUnit): void {
  if (!unit) return;
  const f = Number(unit.factor);
  if (!Number.isFinite(f) || f <= 0) { line.unit_id = ""; line.unit_name = ""; line.unit_factor = Number.NaN; return; }
  line.unit_id = unit.id; line.unit_name = unit.name; line.unit_factor = f;
  line.unit_cost = line.product ? unitPurchasePrice(line.product, unit) ?? round4(toNum(line.product.cost_price) * f) : 0;
  line.priceMode = "keep";
  line.customPrice = undefined;
  line.proposalEdited = false;
  line.approvedProposal = previewLine(line).proposed;
}
function pickProduct(line: DraftLine, product?: Product): void {
  if (!product) { line.product = undefined; line.unit_id = ""; line.unit_name = ""; line.unit_factor = Number.NaN; line.unit_cost = 0; line.priceMode = "keep"; line.approvedProposal = undefined; line.proposalEdited = false; line.customPrice = undefined; return; }
  if (product.family_id !== line.family_id) return;
  line.product = product;
  line.variant_key = product.variant_key ?? null;
  line.priceMode = "keep";
  line.customPrice = undefined;
  line.proposalEdited = false;
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
  const matchingUnit = Number.isFinite(f) && f > 0 && cfg && Number(cfg.factor) === f;
  line.unit_id = matchingUnit ? unitId || "" : "";
  line.unit_name = matchingUnit ? unitName || "" : "";
  line.unit_factor = matchingUnit ? f : Number.NaN;
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
  draftExpenses.value = [];
  paidNow.value = 0;
  draftError.value = "";
  showDraftErrors.value = false;
  pricingOpen.value = {};
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
    const otherIndex = draftLines.value.indexOf(other);
    const ou = other.product.units?.find((u) => u.id === other.unit_id);
    const of = ou ? Number(ou.factor) : Number(other.unit_factor);
    if (!Number.isFinite(of) || of <= 0) return { avg: 0, proposed: null, baseQty: 0, baseCost: 0 };
    const q = round4(toNum(other.quantity) * of);
    totalQty = round4(totalQty + q);
    totalCost += round2(toNum(other.quantity) * toNum(other.unit_cost)) + toNum(capitalizedAllocationByLine.value[otherIndex]);
  }
  const combinedCost = totalQty > 0 ? totalCost / totalQty : baseCost;
  const avg = purchasePreviewAverage(line.product.stock_quantity, line.product.cost_price, totalQty, combinedCost);
  const unitAvg = round4(avg * f);
  const oldUnitAvg = line.product.inventory_mode === "independent"
    ? unitPurchasePrice(line.product, unit)
    : line.product.cost_price == null ? null : round4(toNum(line.product.cost_price) * f);
  const lineIndex = draftLines.value.indexOf(line);
  const nextUnitCost = line.product.inventory_mode === "independent" ? toNum(line.unit_cost) + (toNum(line.quantity) > 0 ? toNum(capitalizedAllocationByLine.value[lineIndex]) / toNum(line.quantity) : 0) : unitAvg;
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
  const lineIndex = draftLines.value.indexOf(line);
  const cost = line.product?.inventory_mode === "independent" ? toNum(line.unit_cost) + (toNum(line.quantity) > 0 ? toNum(capitalizedAllocationByLine.value[lineIndex]) / toNum(line.quantity) : 0) : previewLine(line).avg * Number(unit.factor);
  return cost - toNum(unit.selling_price) > 1e-9;
}
function setPriceMode(line: DraftLine, mode: string): void {
  if (mode !== "keep" && mode !== "proposed" && mode !== "custom") return;
  line.priceMode = mode;
  line.proposalEdited = false;
  line.approvedProposal = previewLine(line).proposed;
}
watch(() => draftLines.value.map((line) => `${line.key}:${line.quantity}:${line.unit_cost}:${line.unit_factor}:${line.product?.stock_quantity}:${line.product?.cost_price}`).join("|"), () => {
  for (const line of draftLines.value) if (!line.proposalEdited) line.approvedProposal = previewLine(line).proposed;
});
async function confirmDraft(): Promise<void> {
  if (savingDraft.value) return;
  if (!draftReady.value) { showDraftErrors.value = true; return; }
  savingDraft.value = true;
  draftError.value = "";
  try {
    const result = await purchasing.executePurchase({ idempotencyKey: requestKey.value, supplier_id: draftSupplier.value?.id ?? null, supplier_name: draftSupplier.value?.name ?? supplierName.value.trim(), supplier_ref: supplierRef.value.trim() || null, source: draftSource.value ? "repeat" : "manual", items: draftLines.value.map((line) => ({ product_id: line.product?.id, quantity: line.quantity, unit_cost: line.unit_cost, unit_id: line.unit_id, unit_name: line.unit_name, unit_factor: line.unit_factor, pricing: priceDecision(line) })), expenses: draftExpenses.value.map((expense) => ({ id: expense.id, type: expense.type, description: expense.description.trim() || null, amount: toNum(expense.amount), allocation_method: expense.allocation_method, capitalize: expense.capitalize, paid: expense.paid, recipient: expense.recipient.trim() || null, ...(expense.allocation_method === "manual" ? { allocations: [...expense.manualAllocations] } : {}), confirmTipCapitalization: expense.confirmTipCapitalization })), paidNow: toNum(paidNow.value) });
    if (!result.ok) { draftError.value = result.error || "تعذر حفظ الفاتورة."; return; }
    notify(result.advance ? `تم تسجيل الفاتورة وسلفة مستحقة لنا ${formatePrice(result.advance)}.` : result.remaining ? `فاتورة الشراء سُجلت، والمتبقي للمورد ${formatePrice(result.remaining)}.` : "تم تسجيل فاتورة الشراء مدفوعة بالكامل.", "success");
    draftOpen.value = false;
    await reload(true);
  } finally { savingDraft.value = false; }
}
const payingExpenseId = ref<string | null>(null);
const expensePaymentKeys = ref<Record<string, string>>({});
function expenseTypeLabel(type: string): string { return ({ delivery: "توصيل ونقل", loading: "تحميل وتنزيل", handling: "مناولة", custom: "مصروف آخر", tip: "إكرامية" } as Record<string, string>)[type] || "مصروف شراء"; }
async function payRecordedExpense(expenseId: string): Promise<void> {
  const invoice = selectedInvoice.value;
  if (!invoice?.id || payingExpenseId.value) return;
  payingExpenseId.value = expenseId;
  try {
    const paymentKey = expensePaymentKeys.value[expenseId] || (expensePaymentKeys.value[expenseId] = id());
    const result = await purchasing.payPurchaseExpense(invoice.id, expenseId, paymentKey);
    if (!result.ok) { notify(result.error, "error"); return; }
    const expenses = (invoice.expenses || []).map((expense) => expense.id === expenseId ? { ...expense, paid: true, payment_status: "paid" as const, payment_id: paymentKey } : expense);
    const updated = { ...invoice, expenses };
    delete expensePaymentKeys.value[expenseId];
    selectedInvoice.value = updated;
    pageInvoices.value = pageInvoices.value.map((item) => item.id === invoice.id ? updated : item);
    pinnedInvoices.value = pinnedInvoices.value.map((item) => item.id === invoice.id ? updated : item);
    notify("تم تسجيل سداد المصروف وخروجه من الخزنة دون تغيير مستحق المورد.", "success");
  } finally { payingExpenseId.value = null; }
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
  if (!(line.sourceFactor > 0)) return "عدد الوحدة الأساسية في وحدة الفاتورة غير صالح.";
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
    notify(`تم تسجيل المرتجع بقيمة ${formatePrice(result.total)}.`, "success");
    await reload(true);
    if (selectedInvoice.value?.id === invoiceId) {
      const fresh = await purchasing.fetchPurchaseInvoice(invoiceId);
      if (fresh) openDetails(fresh);
    }
  } finally { returnBusy.value = false; }
}
function openAdvance(advance: SupplierAdvance, mode: "apply" | "refund"): void { advanceTarget.value = advance; advanceMode.value = mode; advanceAmount.value = mode === "apply" ? Math.min(advance.remaining_amount, selectedInvoice.value?.remaining_amount ?? 0) : advance.remaining_amount; advanceKey.value = id(); advanceOpen.value = true; }
async function confirmAdvance(): Promise<void> { if (!advanceTarget.value?.id || advanceError.value || advanceBusy.value) return; advanceBusy.value = true; try { const result = await purchasing.settleSupplierAdvance({ advanceId: advanceTarget.value.id, invoiceId: advanceMode.value === "apply" ? selectedInvoice.value?.id : undefined, amount: Number(advanceAmount.value), mode: advanceMode.value, key: advanceKey.value }); if (!result.ok) { notify(result.error, "error"); return; } notify("تمت تسوية سلفة المورد.", "success"); advanceOpen.value = false; if (selectedInvoice.value?.supplier_id) advances.value = await purchasing.fetchSupplierAdvances(selectedInvoice.value.supplier_id); await reload(true); if (selectedInvoice.value?.id) selectedInvoice.value = await purchasing.fetchPurchaseInvoice(selectedInvoice.value.id); } finally { advanceBusy.value = false; } }
function printInvoice(): void {
  if (!import.meta.client) return;
  const sheet = document.querySelector(".print-sheet");
  const printer = document.getElementById("printableArea");
  if (!sheet || !printer) {
    notify("تعذر تجهيز فاتورة المورد للطباعة.", "error");
    return;
  }
  printer.replaceChildren(sheet.cloneNode(true));
  try {
    window.print();
  } catch (error) {
    console.error(error);
    notify("تعذر طباعة فاتورة المورد.", "error");
  } finally {
    printer.replaceChildren();
  }
}
async function togglePin(invoice: PurchaseInvoice): Promise<void> {
  if (!invoice.id) return;
  try {
    await purchasing.setPurchaseInvoicePinned(invoice.id, !invoice.pinned);
    await reload(true);
  } catch (error) {
    console.error(error);
    notify("تعذر تغيير تثبيت الفاتورة. أعد المحاولة.", "error");
  }
}
function openPayment(invoice: PurchaseInvoice): void { paymentTarget.value = invoice; paymentAmount.value = undefined; paymentNote.value = ""; paymentKey.value = id(); paymentOpen.value = true; }
async function submitPayment(): Promise<void> { if (!paymentTarget.value?.id || paymentError.value || paying.value) return; paying.value = true; try { const amount = Number(paymentAmount.value); const result = await purchasing.paySupplierInvoice(paymentTarget.value.id, amount, paymentNote.value.trim() || null, paymentKey.value); if (!result.ok) { notify(result.error, "error"); return; } const target = paymentTarget.value; const paid = round2(target.paid_amount + Math.min(amount, target.remaining_amount)); const status = deriveSupplierInvoiceStatus(paid, result.remaining, target.total_amount); const update = (items: PurchaseInvoice[]) => items.map((item) => item.id === target.id ? { ...item, paid_amount: paid, remaining_amount: result.remaining, status } : item); pageInvoices.value = update(pageInvoices.value); pinnedInvoices.value = update(pinnedInvoices.value); notify(result.advance ? `تم السداد وتسجيل سلفة مستحقة لنا ${formatePrice(result.advance)}.` : result.remaining ? `تم تسجيل السداد، والمتبقي ${formatePrice(result.remaining)}.` : "تم سداد فاتورة المورد بالكامل.", "success"); paymentOpen.value = false; if (statusFilter.value !== "all" && statusFilter.value !== status) await reload(true); } finally { paying.value = false; } }
async function loadPayments(invoice: PurchaseInvoice): Promise<void> { if (!invoice.id) return; paymentsOpen.value = true; payments.value = await purchasing.fetchSupplierPayments(invoice.id); }
let reloadGeneration = 0;
async function reload(reset = false): Promise<void> {
  const generation = ++reloadGeneration;
  loading.value = true;
  loadError.value = "";
  try {
    if (reset) { pageNumber.value = 1; pageCursors.value = [null]; }
    const page = await purchasing.fetchPurchaseInvoices({ supplierId: supplierFilterId.value || null, status: statusFilter.value as "all" | "paid" | "partial" | "unpaid", pageSize: 25, cursor: pageCursors.value[pageNumber.value - 1] });
    if (generation !== reloadGeneration) return;
    pageInvoices.value = page.items;
    pinnedInvoices.value = page.pinned;
    hasMore.value = page.hasMore;
    if (page.cursor) pageCursors.value[pageNumber.value] = page.cursor;
  } catch (error) {
    if (generation !== reloadGeneration) return;
    console.error(error);
    const message = error instanceof Error ? error.message : "";
    loadError.value = message.includes("requires an index")
      ? "تعذر عرض فواتير هذا المورد بسبب إعداد ناقص في قاعدة البيانات. تواصل مع المسؤول."
      : "تعذر تحميل فواتير الموردين. تحقق من الاتصال ثم أعد المحاولة.";
  } finally { if (generation === reloadGeneration) loading.value = false; }
}
async function nextPage(): Promise<void> { if (!hasMore.value || loading.value) return; pageNumber.value += 1; await reload(); }
async function previousPage(): Promise<void> { if (pageNumber.value <= 1 || loading.value) return; pageNumber.value -= 1; await reload(); }
watch(statusFilter, () => { void reload(true); });
watch(supplierFilterId, () => { void reload(true); });
onUnmounted(() => { reloadGeneration += 1; });
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
  .print-sheet { display: block !important; position: static; padding: 24px; color: #111827; background: #fff; }
  .print-sheet h1, .print-sheet th { font-weight: 700 !important; color: #111827 !important; }
  .print-sheet table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  .print-sheet thead { display: table-header-group; }
  .print-sheet tr { break-inside: avoid; }
  .print-sheet th, .print-sheet td { border: 1px solid #d1d5db; padding: 8px; text-align: right; }
}
</style>
