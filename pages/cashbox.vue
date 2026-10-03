<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">الخزنة</h2>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="cashbox.initialized && !cashbox.loading" class="flex items-center gap-1 text-xs text-gray-400">
          <span class="inline-block size-2 rounded-full bg-emerald-500"></span>مباشر
        </span>
        <div v-if="cashbox.initialized" class="flex flex-wrap gap-2">
          <UButton
            icon="i-lucide-plus"
            color="success"
            @click="depositOpen = true"
            >إضافة أموال</UButton
          >
          <UButton
            icon="i-lucide-minus"
            color="error"
            variant="soft"
            @click="withdrawOpen = true"
            >سحب أموال</UButton
          >
        </div>
      </div>
    </div>

    <UiAppStatsSkeleton v-if="cashbox.loading" />
    <!-- Onboarding: opening balance once -->
    <UCard
      v-else-if="!cashbox.initialized"
      variant="outline"
      class="mb-3 border-dashed"
    >
      <template #header>
        <div class="font-bold">تهيئة الخزنة لأول مرة</div>
      </template>
      <p class="mb-3 text-sm text-gray-500">
        أدخل النقدية الفعلية الموجودة حالياً بالمحل. الصفر مسموح به ويعني خزنة
        مهيأة بدون نقدية — وهو مختلف عن عدم التهيئة. تُسجل مرة واحدة ولا يمكن
        تكرارها.
      </p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <UFormField label="الرصيد الافتتاحي" required>
          <UInputNumber
            v-model="openingAmount"
            :min="0"
            :step="0.01"
            placeholder="مثال: 12350"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UFormField label="ملاحظة">
          <UInput
            v-model="openingNote"
            placeholder="رصيد افتتاحي"
            size="lg"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <UButton
          color="success"
          block
          size="lg"
          :loading="openingBusy"
          icon="i-lucide-vault"
          @click="doOpening"
          >تأكيد الرصيد الافتتاحي</UButton
        >
      </template>
    </UCard>

    <template v-else>
      <div class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <UCard variant="outline">
          <div class="text-lg font-bold text-emerald-700 sm:text-xl">
            {{ formatePrice(cashbox.balance) }}
          </div>
          <div class="text-xs text-gray-500">النقدية الحالية</div>
          <div v-if="cashbox.initialized && cashbox.balance <= 0" class="mt-1 text-xs text-gray-400">مهيأة بصفر — ليست غير مهيأة</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-red-600 sm:text-xl">
            {{ summariesReady ? formatePrice(receivablesTotal) : "…" }}
          </div>
          <div class="text-xs text-gray-500">المستحق لنا</div>
          <div v-if="summariesReady" class="mt-1 space-y-0.5 border-t border-gray-100 pt-1 text-xs text-gray-500">
            <div class="flex justify-between gap-2"><span>مستحقات فواتير</span><b>{{ formatePrice(receivablesInvoices) }}</b></div>
            <div class="flex justify-between gap-2"><span>سلف مستحقة</span><b>{{ formatePrice(receivablesLoans) }}</b></div>
          </div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-red-600 sm:text-xl">
            {{ summariesReady ? formatePrice(payablesTotal) : "…" }}
          </div>
          <div class="text-xs text-gray-500">المستحق علينا (موردين)</div>
          <div v-if="summariesReady && unlinkedPayables > 0" class="mt-1 border-t border-gray-100 pt-1 text-xs text-amber-700">
            منها غير مرتبطة بمورد: {{ formatePrice(unlinkedPayables) }} — للمراجعة
          </div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">
            {{ formatePrice(agg.costValue) }}
          </div>
          <div class="text-xs text-gray-500">المخزون بالتكلفة</div>
          <div v-if="inventoryValuationNote" class="mt-1 text-xs text-amber-700">{{ inventoryValuationNote }}</div>
        </UCard>
      </div>

      <UAlert
        v-if="shortageAlert"
        color="warning"
        variant="soft"
        class="mb-3"
        :title="shortageAlert"
        :actions="[{ label: 'عرض المنتجات', color: 'warning', variant: 'soft', onClick: () => (shortagesOpen = true) }]"
      />
      <ProductsLowStockDialog
        v-model:open="shortagesOpen"
        :products="products.list"
        :show-cost="true"
      />

      <p class="mb-2 mt-4 text-xs font-bold text-gray-400">حسابات افتراضية وتحليلات</p>
      <div class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-3">
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">
            {{ summariesReady ? formatePrice(round2(cashbox.balance + receivablesTotal)) : "…" }}
          </div>
          <div class="text-xs text-gray-500">رصيدنا بعد التحصيل الكامل</div>
          <div class="mt-1 text-xs text-gray-400">افتراضي — بفرض تحصيل كل المستحقات</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">
            {{ summariesReady ? formatePrice(hypotheticalSettlement) : "…" }}
          </div>
          <div class="text-xs text-gray-500">رصيد افتراضي بعد تحصيل وسداد جميع المستحقات</div>
          <div class="mt-1 text-xs text-gray-400">تقدير نظري — لا يعني توفر السيولة الآن</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">
            {{ summariesReady ? formatePrice(registeredNetAssets) : "…" }}
          </div>
          <div class="text-xs text-gray-500">صافي الأصول المسجلة</div>
          <div class="mt-1 text-xs text-gray-400">نقد + مخزون + مستحق لنا − مستحق علينا — بنود التطبيق فقط</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold sm:text-xl">{{ payablesCoverage }}</div>
          <div class="text-xs text-gray-500">تغطية المستحق علينا من النقدية الحالية</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-emerald-700 sm:text-xl">
            {{ statsReady ? formatePrice(stats.sales) : "…" }}
          </div>
          <div class="text-xs text-gray-500">إجمالي المبيعات</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-emerald-600 sm:text-xl">
            {{ statsReady ? formatePrice(stats.profits) : "…" }}
          </div>
          <div class="text-xs text-gray-500">مجمل ربح البضاعة</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-lg font-bold text-blue-600 sm:text-xl">
            {{ formatePrice(agg.expectedProfit) }}
          </div>
          <div class="text-xs text-gray-500">الربح المتوقع من المخزون <span class="text-gray-400">(غير محقق — يتأثر بالوحدات والأسعار والخصومات)</span></div>
        </UCard>
      </div>

      <div class="mb-2 mt-4 flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs font-bold text-gray-400">سجل العمليات</p>
        <div class="flex flex-wrap items-center gap-2">
          <USelect
            v-model="periodPreset"
            :items="periodPresets"
            value-key="value"
            label-key="label"
            size="sm"
            class="w-36"
          />
          <UiAppDateField
            v-if="periodPreset === 'custom'"
            v-model="customFrom"
            label="من تاريخ"
            class="w-44"
          />
          <USelect
            v-model="typeFilter"
            :items="typeOptions"
            value-key="value"
            size="sm"
            class="w-48"
          />
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            icon="i-lucide-download"
            :loading="exporting"
            :disabled="!periodTxns.length"
            @click="exportPeriod"
            >تصدير الفترة</UButton
          >
        </div>
      </div>
      <div v-if="periodStart" class="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <UCard variant="outline">
          <div class="text-base font-bold sm:text-lg">{{ formatePrice(periodOpening) }}</div>
          <div class="text-xs text-gray-500">رصيد بداية الفترة</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-base font-bold text-emerald-700 sm:text-lg">+{{ formatePrice(periodIn) }}</div>
          <div class="text-xs text-gray-500">إجمالي المقبوضات</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-base font-bold text-red-600 sm:text-lg">−{{ formatePrice(periodOut) }}</div>
          <div class="text-xs text-gray-500">إجمالي المدفوعات</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-base font-bold sm:text-lg" :class="periodNet >= 0 ? 'text-emerald-700' : 'text-red-600'">
            {{ periodNet >= 0 ? "+" : "−" }}{{ formatePrice(Math.abs(periodNet)) }}
          </div>
          <div class="text-xs text-gray-500">صافي الحركة</div>
        </UCard>
        <UCard variant="outline">
          <div class="text-base font-bold sm:text-lg">{{ formatePrice(cashbox.balance) }}</div>
          <div class="text-xs text-gray-500">رصيد نهاية الفترة (الحالي)</div>
        </UCard>
      </div>
      <p v-if="periodIsFiltered" class="mb-2 text-xs text-gray-400">الملخص أعلاه لنتائج الفلتر فقط — رصيد الخزنة شامل كل الحركات.</p>
      <p v-if="periodTruncated" class="mb-2 text-xs text-amber-700">الفترة كبيرة — الملخص والتصدير لأحدث 2000 حركة فقط.</p>
      <UAlert
        v-if="newOpsAvailable"
        color="info"
        variant="soft"
        class="mb-2"
        title="توجد عمليات جديدة"
        :actions="[{ label: 'عرض الأحدث', color: 'info', variant: 'soft', onClick: backToLatest }]"
      />
      <UiAppTableSkeleton v-if="txnLoading && !txnList.length" />
      <template v-else>
        <div class="hidden overflow-x-auto md:block">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-gray-500">
                <th class="p-2 text-start font-medium">التاريخ</th>
                <th class="p-2 text-start font-medium">النوع</th>
                <th class="p-2 text-start font-medium">الوصف</th>
                <th class="p-2 text-start font-medium">المبلغ</th>
                <th class="p-2 text-start font-medium">الاتجاه</th>
                <th class="p-2 text-start font-medium">المرجع</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in paged"
                :key="t.id"
                class="border-b border-gray-100 last:border-0 hover:bg-gray-50"
              >
                <td class="p-2 text-gray-600">
                  {{ formatDateTime(t.created_at) }}
                </td>
                <td class="p-2">{{ CASH_TYPE_LABELS[t.type] || t.type }}</td>
                <td class="max-w-64 p-2 text-gray-600">
                  <UPopover
                    v-if="descriptionWords(t.note).length > 5"
                    mode="hover"
                    :content="{ side: 'top', align: 'start' }"
                  >
                    <button type="button" class="text-start">
                      {{ descriptionPreview(t.note) }}
                    </button>
                    <template #content>
                      <div
                        class="max-w-sm whitespace-normal text-sm text-gray-700"
                      >
                        {{ t.note }}
                      </div>
                    </template>
                  </UPopover>
                  <span v-else>{{ t.note || "—" }}</span>
                </td>
                <td
                  class="p-2 font-semibold"
                  :class="
                    t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'
                  "
                >
                  {{ t.direction === "in" ? "+" : "−"
                  }}{{ formatePrice(t.amount) }}
                </td>
                <td class="p-2">
                  <UBadge
                    :color="t.direction === 'in' ? 'success' : 'error'"
                    variant="soft"
                    >{{ t.direction === "in" ? "وارد" : "صادر" }}</UBadge
                  >
                </td>
                <td class="p-2 text-xs text-gray-500">
                  <UButton
                    v-if="canViewReference(t)"
                    size="xs"
                    color="neutral"
                    variant="link"
                    class="p-0"
                    @click="viewReference(t)"
                    >{{ refLabel(t) }}</UButton
                  ><span v-else>{{ refLabel(t) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <UEmpty
            v-if="!paged.length"
            icon="i-lucide-vault"
            title="لا توجد عمليات مسجلة"
          />
        </div>
        <div class="grid gap-2 md:hidden">
          <UCard v-for="t in paged" :key="t.id" variant="outline">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate text-sm font-bold">
                  {{ CASH_TYPE_LABELS[t.type] || t.type }}
                </div>
                <div class="text-xs text-gray-500">
                  {{ formatDateTime(t.created_at)
                  }}{{ t.note ? ` • ${t.note}` : "" }}
                </div>
                <div class="text-xs text-gray-400">
                  <UButton
                    v-if="canViewReference(t)"
                    size="xs"
                    color="neutral"
                    variant="link"
                    class="p-0"
                    @click="viewReference(t)"
                    >{{ refLabel(t) }}</UButton
                  ><span v-else>{{ refLabel(t) }}</span>
                </div>
              </div>
              <div
                class="shrink-0 font-bold"
                :class="
                  t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'
                "
                dir="ltr"
              >
                {{ t.direction === "in" ? "+" : "−"
                }}{{ formatePrice(t.amount) }}
              </div>
            </div>
          </UCard>
          <UEmpty
            v-if="!paged.length"
            icon="i-lucide-vault"
            title="لا توجد عمليات مسجلة"
          />
        </div>
      </template>
      <div class="mt-3 flex items-center justify-between gap-2">
        <span class="text-xs text-gray-500"
          >صفحة {{ txnPage }} · 25 عملية</span
        >
        <div class="flex gap-2" dir="ltr">
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-chevron-left"
            aria-label="الصفحة التالية"
            :disabled="txnLoading || !txnHasMore"
            @click="goTxnPage(txnPage + 1)"
          />
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-chevron-right"
            aria-label="الصفحة السابقة"
            :disabled="txnLoading || txnPage <= 1"
            @click="goTxnPage(txnPage - 1)"
          />
        </div>
      </div>
    </template>

    <div class="mt-4 border-t border-gray-100 pt-3">
      <UButton
        color="neutral"
        variant="soft"
        size="sm"
        :icon="adminOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="adminOpen = !adminOpen"
        >أدوات الإدارة</UButton
      >
      <div v-if="adminOpen" class="mt-2 space-y-2">
        <UAlert
          v-if="fixAccountsMsg"
          :color="fixAccountsOk ? 'success' : fixAccountsBusy ? 'info' : 'error'"
          variant="soft"
          :title="fixAccountsMsg"
        />
        <div class="flex flex-wrap gap-2">
          <UButton
            icon="i-lucide-wrench"
            color="neutral"
            variant="soft"
            size="sm"
            :loading="fixAccountsBusy"
            @click="runFixAccounts"
            >تصحيح الحسابات</UButton
          >
          <UButton
            icon="i-lucide-scale"
            color="neutral"
            variant="soft"
            size="sm"
            :loading="repairBusy"
            @click="runRepairAnalyze"
            >مراجعة متوسط التكلفة</UButton
          >
        </div>
        <UCard variant="outline" class="border-red-200">
          <div class="mb-1 text-sm font-bold text-red-700">إعادة ضبط المصنع</div>
          <p class="mb-2 text-xs text-gray-500">
            مسح كل بيانات النظام من كل المجموعات بلا استثناء (الفواتير، العملاء،
            المنتجات، الخزنة، الموردون، الملخصات والإحصائيات). لا يمكن التراجع.
            يتطلب كلمة مرور المدير.
          </p>
          <UButton
            color="error"
            size="sm"
            icon="i-lucide-trash-2"
            @click="openFactoryReset"
            >إعادة ضبط المصنع</UButton
          >
        </UCard>
      </div>
    </div>

    <!-- Factory reset: password gate + double confirm + wipe -->
    <UiAppDialog v-model:open="resetOpen" title="إعادة ضبط المصنع">
      <template v-if="resetStep === 'password'">
        <p class="mb-3 text-sm text-gray-600">
          أدخل كلمة مرور المدير للمتابعة إلى مسح البيانات.
        </p>
        <UFormField label="كلمة المرور">
          <UInput
            v-model="resetPassword"
            type="password"
            inputmode="numeric"
            dir="ltr"
            placeholder="••••••"
            size="lg"
            class="w-full"
            :disabled="resetBusy"
            @keydown.enter="verifyResetPassword"
          />
        </UFormField>
        <UAlert
          v-if="resetError"
          color="error"
          variant="soft"
          class="mt-2"
          :title="resetError"
        />
      </template>
      <template v-else-if="resetStep === 'confirm'">
        <UAlert
          color="error"
          variant="soft"
          title="سيتم مسح كل شيء نهائيًا"
          description="كل الفواتير والعملاء والمنتجات والخزنة والموردين والملخصات من كل المجموعات بلا استثناء. لا يوجد تراجع بعد التأكيد."
        />
        <UCheckbox
          v-model="resetUnderstood"
          label="أفهم أن المسح نهائي ولا يمكن التراجع عنه"
          class="mt-3"
        />
        <UAlert
          v-if="resetError"
          color="error"
          variant="soft"
          class="mt-2"
          :title="resetError"
        />
      </template>
      <template v-else-if="resetStep === 'wiping'">
        <div class="flex items-center gap-3">
          <span
            class="relative flex size-11 shrink-0 items-center justify-center"
          >
            <span
              class="absolute inset-0 animate-spin rounded-full border-2 border-red-200 border-t-red-600"
            ></span>
            <UIcon name="i-lucide-trash-2" class="size-5 text-red-600" />
          </span>
          <div class="min-w-0">
            <div class="font-bold text-gray-900">جاري مسح البيانات…</div>
            <div v-if="resetMsg" class="text-xs text-gray-500">
              {{ resetMsg }}
            </div>
          </div>
        </div>
        <UProgress :value="resetPct" class="mt-3" />
      </template>
      <template v-else>
        <UAlert
          color="success"
          variant="soft"
          icon="i-lucide-circle-check"
          :title="resetResult"
        />
      </template>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <template v-if="resetStep === 'password'">
            <UButton
              color="error"
              block
              :loading="resetBusy"
              @click="verifyResetPassword"
              >تحقق والمتابعة</UButton
            >
            <UButton
              color="neutral"
              variant="ghost"
              block
              :disabled="resetBusy"
              @click="resetOpen = false"
              >إلغاء</UButton
            >
          </template>
          <template v-else-if="resetStep === 'confirm'">
            <UButton
              color="error"
              block
              :loading="resetBusy"
              :disabled="!resetUnderstood"
              @click="runFactoryReset"
              >مسح كل البيانات نهائيًا</UButton
            >
            <UButton
              color="neutral"
              variant="ghost"
              block
              :disabled="resetBusy"
              @click="resetStep = 'password'"
              >رجوع</UButton
            >
          </template>
          <template v-else-if="resetStep === 'done'">
            <UButton
              color="success"
              block
              icon="i-lucide-refresh-cw"
              @click="reloadApp"
              >إعادة تحميل التطبيق</UButton
            >
            <UButton
              color="neutral"
              variant="ghost"
              block
              @click="resetOpen = false"
              >إغلاق</UButton
            >
          </template>
        </div>
      </template>
    </UiAppDialog>

    <!-- Cost repair review -->
    <UiAppDialog v-model:open="repairOpen" title="مراجعة متوسط التكلفة">
      <div
        v-if="repairRows.length"
        class="mb-2 flex items-center justify-between gap-2 text-xs"
      >
        <span class="text-gray-500"
          >{{ repairRows.length }} منتج • المحدد:
          {{ selectedRepairable.length }}</span
        >
        <div class="flex gap-2">
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            @click="toggleRepairSelectAll"
          >
            {{
              allRepairableSelected
                ? "إلغاء تحديد الكل"
                : "تحديد القابل للإصلاح"
            }}
          </UButton>
          <UButton
            size="xs"
            color="warning"
            :loading="repairApplyBusy"
            :disabled="!selectedRepairable.length"
            @click="applySelectedRepairs"
            >تطبيق المحدد ({{ selectedRepairable.length }})</UButton
          >
        </div>
      </div>
      <div class="max-h-[60vh] space-y-2 overflow-y-auto">
        <UEmpty
          v-if="!repairRows.length && !repairBusy"
          icon="i-lucide-scale"
          title="شغّل التحليل أولاً"
        />
        <div
          v-for="r in repairRows"
          :key="r.product_id"
          class="flex items-start gap-2 rounded-lg border border-gray-200 p-2 text-sm"
        >
          <UCheckbox
            v-if="r.status === 'REPAIRABLE'"
            :model-value="isRepairSelected(r.product_id)"
            @update:model-value="() => toggleRepairRow(r.product_id)"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold">{{ r.product_name }}</div>
            <div
              class="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-500"
            >
              <span>المخزون الحالي: {{ r.currentStock ?? "—" }}</span>
              <span>المعاد تشغيله: {{ r.replayedStock }}</span>
              <span>التكلفة الحالية: {{ r.currentCost ?? "—" }}</span>
              <span>المعاد حسابها: {{ r.recomputedCost ?? "—" }}</span>
            </div>
            <div class="mt-0.5 text-xs">
              <span
                v-if="r.difference !== null && r.difference !== 0"
                class="font-bold text-amber-600"
              >
                الفرق: {{ r.difference > 0 ? "+" : "" }}{{ r.difference }}
              </span>
              <UBadge
                :color="repairStatusColor(r.status)"
                variant="soft"
                size="xs"
                class="ms-1"
              >
                {{ REPAIR_STATUS_LABELS[r.status] }}
              </UBadge>
            </div>
          </div>
          <UButton
            v-if="r.status === 'REPAIRABLE'"
            size="xs"
            color="warning"
            variant="soft"
            :loading="repairRowBusy === r.product_id"
            @click="applySingleRepair(r)"
            >تطبيق</UButton
          >
        </div>
      </div>
      <p v-if="repairMsg" class="mt-2 text-sm font-semibold text-gray-700">
        {{ repairMsg }}
      </p>
    </UiAppDialog>

    <!-- Deposit dialog -->
    <UiAppDialog v-model:open="depositOpen" title="إضافة أموال">
      <div class="space-y-3">
        <UFormField label="المبلغ" required :error="amountError || undefined">
          <UInputNumber
            v-model="amount"
            :min="0"
            :step="0.01"
            placeholder="مثال: 5000"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="submitError"
          color="error"
          variant="soft"
          :title="submitError"
        />
        <UFormField label="ملاحظة">
          <UInput
            v-model="note"
            placeholder="مثال: إضافة رأس مال"
            size="lg"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="success"
            class="min-h-11 flex-1"
            :loading="busy"
            icon="i-lucide-plus"
            @click="doAdjust('manual_deposit', 'in')"
            >تأكيد الإضافة</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="min-h-11 flex-1"
            :disabled="busy"
            @click="closeForms"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>

    <!-- Withdraw dialog -->
    <UiAppDialog v-model:open="withdrawOpen" title="سحب أموال">
      <div class="space-y-3">
        <UAlert
          color="info"
          variant="soft"
          :title="`الرصيد الحالي: ${formatePrice(cashbox.balance)}`"
        />
        <UFormField label="المبلغ" required :error="amountError || undefined">
          <UInputNumber
            v-model="amount"
            :min="0"
            :step="0.01"
            placeholder="المبلغ"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="submitError"
          color="error"
          variant="soft"
          :title="submitError"
        />
        <UFormField label="ملاحظة">
          <UInput
            v-model="note"
            placeholder="سبب السحب"
            size="lg"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="error"
            class="min-h-11 flex-1"
            :loading="busy"
            icon="i-lucide-minus"
            @click="doAdjust('manual_withdrawal', 'out')"
            >تأكيد السحب</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="min-h-11 flex-1"
            :disabled="busy"
            @click="closeForms"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
    <UiAppDialog v-model:open="referenceOpen" :title="referenceTitle">
      <USkeleton v-if="referenceLoading" class="h-24 w-full" />
      <UAlert
        v-else-if="referenceError"
        color="error"
        variant="soft"
        :title="referenceError"
      />
      <div v-else-if="referenceInvoice" class="max-h-[75vh] overflow-y-auto">
        <Invoice
          :invoice-data="referenceInvoice"
          :view-mode="true"
          @close="referenceOpen = false"
        />
      </div>
      <div v-else-if="referencePurchase" class="max-h-[75vh] overflow-y-auto">
        <SupplierInvoice :invoice="referencePurchase" />
      </div>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { CashDirection, CashTransactionType } from "~/types/finance";
import { CASH_TYPE_LABELS } from "~/types/finance";
import type { RepairRow } from "~/composables/useInventoryCostRepair";
import { REPAIR_STATUS_LABELS } from "~/composables/useInventoryCostRepair";
import { toDateSafe } from "~/types";
import { ADMIN_EMAIL } from "~/constants/auth";
import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  limit as fsLimit,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { Invoice } from "~/types";
import type { CashTransaction, PurchaseInvoice } from "~/types/finance";

definePageMeta({ title: "الخزنة" });
const { formatePrice } = useHelpers();
const { inventoryAggregates, round2, toNum } = useFinance();
const cashbox = useCashbox();
const products = useProductsStore();
const migration = useMigration();
const repairApi = useInventoryCostRepair();
const { notify } = useAppToast();
const { db } = useFirebase();
const referenceOpen = ref(false);
const referenceLoading = ref(true);
const referenceError = ref("");
const referenceTitle = ref("");
const referenceInvoice = ref<Invoice | null>(null);
const referencePurchase = ref<PurchaseInvoice | null>(null);
const resolvedReferenceNames = ref<Record<string, string>>({});

// Cost repair review state (§12).
const repairOpen = ref(false);
const repairBusy = ref(false);
const repairPct = ref(0);
const repairMsg = ref("");
const repairRows = ref<RepairRow[]>([]);
const repairSelected = ref(new Set<string>());
const repairApplyBusy = ref(false);
const repairRowBusy = ref<string | null>(null);
const selectedRepairable = computed(() =>
  repairRows.value.filter(
    (r) => r.status === "REPAIRABLE" && repairSelected.value.has(r.product_id),
  ),
);
const allRepairableSelected = computed(() => {
  const reps = repairRows.value.filter((r) => r.status === "REPAIRABLE");
  return (
    reps.length > 0 && reps.every((r) => repairSelected.value.has(r.product_id))
  );
});
function isRepairSelected(id: string): boolean {
  return repairSelected.value.has(id);
}
function toggleRepairRow(id: string): void {
  if (repairSelected.value.has(id)) repairSelected.value.delete(id);
  else repairSelected.value.add(id);
}
function toggleRepairSelectAll(): void {
  if (allRepairableSelected.value) {
    repairSelected.value = new Set();
  } else {
    repairSelected.value = new Set(
      repairRows.value
        .filter((r) => r.status === "REPAIRABLE")
        .map((r) => r.product_id),
    );
  }
}
function repairStatusColor(
  s: RepairRow["status"],
): "success" | "warning" | "error" | "neutral" {
  if (s === "OK") return "success";
  if (s === "REPAIRABLE") return "warning";
  if (s === "STOCK_MISMATCH" || s === "INVALID_HISTORY") return "error";
  return "neutral";
}
async function runRepairAnalyze(): Promise<void> {
  repairBusy.value = true;
  repairMsg.value = "";
  repairRows.value = [];
  repairSelected.value = new Set();
  repairOpen.value = true;
  try {
    repairRows.value = await repairApi.analyze((d, t) => {
      repairPct.value = t ? Math.round((d / t) * 100) : 100;
    });
    const reps = repairRows.value.filter(
      (r) => r.status === "REPAIRABLE",
    ).length;
    repairMsg.value = `اكتمل التحليل: ${repairRows.value.length} منتج، ${reps} قابل للإصلاح.`;
  } catch (e) {
    repairMsg.value = "فشل التحليل.";
    notify("تعذر إتمام التحليل.", "error");
  } finally {
    repairBusy.value = false;
  }
}
async function applySingleRepair(r: RepairRow): Promise<void> {
  repairRowBusy.value = r.product_id;
  try {
    const res = await repairApi.applyOne(r, "إصلاح يدوي من المراجعة");
    if (!res.ok) {
      notify(res.error, "error");
      return;
    }
    notify(`تم إصلاح ${r.product_name}.`, "success");
    repairSelected.value.delete(r.product_id);
    await products.fetchProducts();
    await refreshRepairRows();
  } finally {
    repairRowBusy.value = null;
  }
}
async function applySelectedRepairs(): Promise<void> {
  const targets = selectedRepairable.value;
  if (!targets.length) return;
  repairApplyBusy.value = true;
  try {
    const res = await repairApi.applyMany(
      targets,
      "إصلاح جماعي من المراجعة",
      () => {},
    );
    repairMsg.value = `تم تطبيق ${res.applied}، وتخطي ${res.skipped}، وفشل ${res.failed}.`;
    notify(repairMsg.value, res.failed ? "error" : "success");
    repairSelected.value = new Set();
    await products.fetchProducts();
    await refreshRepairRows();
  } finally {
    repairApplyBusy.value = false;
  }
}
async function refreshRepairRows(): Promise<void> {
  // Re-run analysis (idempotent: applied rows now report OK).
  repairRows.value = await repairApi.analyze();
}

const adminOpen = ref(false);
// One-button account repair state
const fixAccountsBusy = ref(false);
const fixAccountsMsg = ref("");
const fixAccountsOk = ref(false);
const migStockBusy = ref(false);
const migStockPct = ref(0);
const migStockMsg = ref("");
const migSupplierStatusBusy = ref(false);
const migSupplierStatusPct = ref(0);
const migSupplierStatusMsg = ref("");
const migUnitBusy = ref(false);
const migUnitPct = ref(0);
const migUnitMsg = ref("");
// Factory reset state machine: password -> confirm -> wiping -> done.
const resetOpen = ref(false);
const resetStep = ref<"password" | "confirm" | "wiping" | "done">("password");
const resetPassword = ref("");
const resetUnderstood = ref(false);
const resetBusy = ref(false);
const resetError = ref("");
const resetPct = ref(0);
const resetMsg = ref("");
const resetResult = ref("");
function openFactoryReset(): void {
  resetStep.value = "password";
  resetPassword.value = "";
  resetUnderstood.value = false;
  resetBusy.value = false;
  resetError.value = "";
  resetPct.value = 0;
  resetMsg.value = "";
  resetResult.value = "";
  resetOpen.value = true;
}
async function verifyResetPassword(): Promise<void> {
  resetError.value = "";
  if (!resetPassword.value) {
    resetError.value = "أدخل كلمة المرور.";
    return;
  }
  resetBusy.value = true;
  try {
    const { auth, signInWithEmailAndPassword } = useFirebase();
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, resetPassword.value);
    resetPassword.value = "";
    resetStep.value = "confirm";
  } catch {
    resetError.value = "كلمة المرور غير صحيحة.";
  } finally {
    resetBusy.value = false;
  }
}
async function runFactoryReset(): Promise<void> {
  resetError.value = "";
  resetBusy.value = true;
  resetStep.value = "wiping";
  try {
    const res = await migration.factoryReset((done, total, name) => {
      resetPct.value = total ? Math.round((done / total) * 100) : 100;
      resetMsg.value = name ? `مسح ${name}… (${done}/${total})` : "";
    });
    resetResult.value = `تم مسح ${res.documents} مستندًا من ${res.collections} مجموعة. أعد تحميل التطبيق لبداية نظيفة.`;
    resetStep.value = "done";
  } catch (error) {
    console.error("Factory reset failed:", error);
    resetError.value = `فشل المسح: ${migrationErrorDetail(error)}`;
    resetStep.value = "confirm";
  } finally {
    resetBusy.value = false;
  }
}
function reloadApp(): void {
  if (import.meta.client) window.location.reload();
}
const openingQtys = ref<Record<string, number | undefined>>({});
const openingThresholds = ref<Record<string, number | undefined>>({});
const stockSearch = ref("");
const missingStock = computed(() =>
  products.list.filter(
    (p) =>
      p.id && (p.stock_quantity === null || p.stock_quantity === undefined),
  ),
);
// Search within not-yet-counted products (entered quantities are preserved
// while typing since inputs are keyed by product id).
const filteredMissingStock = computed(() => {
  const q = stockSearch.value.trim();
  if (!q) return missingStock.value;
  return missingStock.value.filter((p) => p.name?.includes(q));
});
// Lazy rendering: mount only the first chunk; user appends more with the
// button, so 60 heavy inputs never mount at once.
const STOCK_PAGE = 15;
const visibleCount = ref(STOCK_PAGE);
const visibleMissingStock = computed(() =>
  filteredMissingStock.value.slice(0, visibleCount.value),
);
watch(stockSearch, () => {
  visibleCount.value = STOCK_PAGE;
});
function showMoreStock(): void {
  visibleCount.value += STOCK_PAGE;
}
/** One-button account repair: normalize phones → clean bad links →
 *  link old invoices → rebuild summaries. Idempotent; safe to re-run. */
async function runFixAccounts(): Promise<void> {
  if (fixAccountsBusy.value) return;
  fixAccountsBusy.value = true;
  fixAccountsOk.value = false;
  try {
    fixAccountsMsg.value = "جاري العمل: توحيد صيغة الهواتف…";
    const phones = await migration.normalizeCustomerPhones();
    fixAccountsMsg.value = "جاري العمل: مراجعة روابط العملاء…";
    const repair = await migration.repairCustomerLinks();
    fixAccountsMsg.value = "جاري العمل: ربط الفواتير بالعملاء…";
    const linked = await migration.backfillCustomerIds();
    fixAccountsMsg.value = "جاري العمل: إعادة بناء الملخصات والإجماليات…";
    await migration.backfillPerformanceSummaries();
    fixAccountsOk.value = true;
    fixAccountsMsg.value = `تم تصحيح الحسابات: توحيد ${phones.invoices + phones.customers} هاتف، مراجعة ${repair.reviewed} رابط، ربط ${linked.matched} فاتورة، وأُعيد بناء الملخصات.`;
    notify("تم تصحيح الحسابات بنجاح.", "success");
  } catch (error) {
    console.error("Fix accounts failed:", error);
    fixAccountsOk.value = false;
    fixAccountsMsg.value = `فشل تصحيح الحسابات: ${migrationErrorDetail(error)}`;
    notify(fixAccountsMsg.value, "error");
  } finally {
    fixAccountsBusy.value = false;
  }
}
async function runSupplierStatusBackfill(): Promise<void> {
  migSupplierStatusBusy.value = true;
  migSupplierStatusMsg.value = "";
  try {
    const result = await migration.backfillSupplierInvoiceStatuses(
      (done, total) => {
        migSupplierStatusPct.value = total
          ? Math.round((done / total) * 100)
          : 100;
      },
    );
    migSupplierStatusMsg.value = `تم تحديث ${result.updated} من ${result.total} فاتورة.`;
    notify(migSupplierStatusMsg.value, "success");
  } catch (error) {
    console.error("Supplier invoice status initialization failed:", error);
    migSupplierStatusMsg.value = `فشلت التهيئة: ${migrationErrorDetail(error)}`;
    notify(migSupplierStatusMsg.value, "error");
  } finally {
    migSupplierStatusBusy.value = false;
  }
}
async function runUnitBackfill(): Promise<void> {
  migUnitBusy.value = true;
  migUnitMsg.value = "";
  try {
    const result = await migration.backfillProductUnits((done, total) => {
      migUnitPct.value = total ? Math.round((done / total) * 100) : 100;
    });
    migUnitMsg.value = `تم تحديث ${result.updated} من ${result.total} منتج.`;
    notify(migUnitMsg.value, "success");
    await products.fetchProducts(undefined, true);
  } catch (error) {
    console.error("Product unit initialization failed:", error);
    migUnitMsg.value = `فشلت التهيئة: ${migrationErrorDetail(error)}`;
    notify(migUnitMsg.value, "error");
  } finally {
    migUnitBusy.value = false;
  }
}
async function runStockEntry(): Promise<void> {
  const selectedEntries = missingStock.value
    .filter((p) => p.id && openingQtys.value[p.id] !== undefined)
    .map((p) => ({
      product_id: p.id as string,
      quantity: round2(openingQtys.value[p.id as string] ?? 0),
      unit_cost: toNum(p.cost_price),
      low_stock_threshold:
        openingThresholds.value[p.id as string] ?? p.low_stock_threshold ?? 5,
    }));
  if (
    selectedEntries.some(
      (entry) =>
        !Number.isFinite(entry.quantity) ||
        entry.quantity < 0 ||
        !Number.isFinite(entry.low_stock_threshold) ||
        entry.low_stock_threshold < 0,
    )
  ) {
    migStockMsg.value =
      "راجع الرصيد ومؤشر الكمية القليلة؛ يجب أن يكونا صفرًا أو أكبر.";
    return;
  }
  const entries = selectedEntries;
  if (!entries.length) {
    migStockMsg.value =
      "أدخل رصيدًا افتتاحيًا لمنتج واحد على الأقل؛ يمكن أن تكون الكمية صفرًا.";
    return;
  }
  migStockBusy.value = true;
  migStockMsg.value = "";
  try {
    const res = await migration.setOpeningStocks(entries, (d, t) => {
      migStockPct.value = t ? Math.round((d / t) * 100) : 100;
    });
    migStockMsg.value = `تم: حُفظ ${res.set} من ${res.total} منتج.`;
    notify(`اكتمل إدخال الأرصدة: ${res.set} منتج.`, "success");
    openingQtys.value = {};
    openingThresholds.value = {};
    await products.fetchProducts();
  } catch (error) {
    console.error("Opening stock entry failed:", error);
    migStockMsg.value = `فشل الحفظ: ${migrationErrorDetail(error)}`;
    notify(migStockMsg.value, "error");
  } finally {
    migStockBusy.value = false;
  }
}

function migrationErrorDetail(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error || "خطأ غير معروف");
}

const depositOpen = ref(false);
const withdrawOpen = ref(false);
const amount = ref<number | undefined>(undefined);
const note = ref("");
const submitError = ref("");
const busy = ref(false);
// Live amount error: empty = untouched (no red); withdraw also checks balance.
const amountError = computed(() => {
  if (amount.value === undefined || amount.value === null) return "";
  if (!(amount.value > 0)) return "المبلغ يجب أن يكون أكبر من صفر.";
  if (withdrawOpen.value && round2(amount.value) > cashbox.balance) {
    return `الرصيد الحالي (${formatePrice(cashbox.balance)}) لا يكفي.`;
  }
  return "";
});
const openingAmount = ref<number | undefined>(undefined);
const openingNote = ref("");
const openingBusy = ref(false);

const typeFilter = ref<string | null>(null);
const typeOptions = computed(() => [
  { label: "الكل", value: null },
  ...Object.entries(CASH_TYPE_LABELS).map(([value, label]) => ({
    label,
    value,
  })),
]);
const agg = computed(() => inventoryAggregates(products.list));

const statsLoading = ref(true);
const statsReady = ref(false);
const stats = ref({
  sales: 0,
  profits: 0,
  invoices: 0,
  customers: 0,
});
const receivablesInvoices = ref(0);
const receivablesLoans = ref(0);
const payablesTotal = ref(0);
const unlinkedPayables = ref(0);
const liveReady = reactive({ debts: false, loans: false, payables: false });
const summariesReady = computed(() => liveReady.debts && liveReady.loans && liveReady.payables);
const receivablesTotal = computed(() => round2(receivablesInvoices.value + receivablesLoans.value));
const hypotheticalSettlement = computed(() => round2(cashbox.balance + receivablesTotal.value - payablesTotal.value));
const registeredNetAssets = computed(() => round2(cashbox.balance + agg.value.costValue + receivablesTotal.value - payablesTotal.value));
const payablesCoverage = computed(() => {
  if (!(payablesTotal.value > 0)) return "—";
  if (!(cashbox.balance > 0)) return "0%";
  return `${Math.round((cashbox.balance / payablesTotal.value) * 100)}%`;
});
const inventoryValuationNote = computed(() => {
  const missing = products.list.filter((p) => p.stock_quantity === null || p.stock_quantity === undefined || p.cost_price === null || p.cost_price === undefined).length;
  return missing > 0 ? `${missing} صنف ببيانات ناقصة — التقييم غير مكتمل` : "";
});
const shortagesOpen = ref(false);
const shortageAlert = computed(() => {
  const out = products.outOfStockProducts.length;
  const low = products.lowStockCount;
  if (out + low <= 0) return "";
  return out > 0 ? `تنبيه مخزون: ${out + low} منتج (${out} نافد) يحتاج مراجعة` : `تنبيه مخزون: ${low} منتج قليل الكمية`;
});

let unsubStats: Unsubscribe | null = null;
let unsubDebts: Unsubscribe | null = null;
let unsubLoans: Unsubscribe | null = null;
let unsubPayables: Unsubscribe | null = null;
function unsubscribeSummaries(): void {
  unsubStats?.(); unsubStats = null;
  unsubDebts?.(); unsubDebts = null;
  unsubLoans?.(); unsubLoans = null;
  unsubPayables?.(); unsubPayables = null;
}
function subscribeSummaries(): void {
  if (!import.meta.client) return;
  unsubscribeSummaries();
  unsubStats = onSnapshot(doc(db, "store_stats", "current"),
    (snap) => {
      const data = snap.exists() ? snap.data() : null;
      statsReady.value = data?.initialized === true;
      if (statsReady.value && data) {
        stats.value = {
          sales: round2(toNum(data.total_sales)),
          profits: round2(toNum(data.total_profit)),
          invoices: Math.max(0, Math.floor(toNum(data.invoice_count))),
          customers: Math.max(0, Math.floor(toNum(data.customer_count))),
        };
      }
      statsLoading.value = false;
    },
    () => { statsLoading.value = false; });
  unsubDebts = onSnapshot(query(collection(db, "invoice_debt_summaries"), where("remaining", ">", 0)),
    (snap) => {
      let sum = 0;
      for (const d of snap.docs) sum = round2(sum + toNum(d.data().remaining));
      receivablesInvoices.value = sum;
      liveReady.debts = true;
    },
    () => { liveReady.debts = true; });
  unsubLoans = onSnapshot(query(collection(db, "customer_loans"), where("remaining", ">", 0)),
    (snap) => {
      let sum = 0;
      for (const d of snap.docs) sum = round2(sum + toNum(d.data().remaining));
      receivablesLoans.value = sum;
      liveReady.loans = true;
    },
    () => { liveReady.loans = true; });
  unsubPayables = onSnapshot(query(collection(db, "purchase_invoices"), where("remaining_amount", ">", 0)),
    (snap) => {
      let sum = 0;
      let unlinked = 0;
      for (const d of snap.docs) {
        const data = d.data();
        const rem = round2(toNum(data.remaining_amount));
        sum = round2(sum + rem);
        if (!data.supplier_id) unlinked = round2(unlinked + rem);
      }
      payablesTotal.value = sum;
      unlinkedPayables.value = unlinked;
      liveReady.payables = true;
    },
    () => { liveReady.payables = true; });
}

function cairoOffsetMs(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return asUTC - at.getTime();
}
function cairoDayStart(at: Date): Date {
  const off = cairoOffsetMs(at);
  const wall = new Date(at.getTime() + off);
  wall.setUTCHours(0, 0, 0, 0);
  return new Date(wall.getTime() - off);
}

type PeriodPreset = "today" | "7d" | "30d" | "custom";
const periodPreset = ref<PeriodPreset>("today");
const customFrom = ref<Date | null>(null);
const periodPresets: { label: string; value: PeriodPreset }[] = [
  { label: "اليوم", value: "today" },
  { label: "آخر 7 أيام", value: "7d" },
  { label: "آخر 30 يومًا", value: "30d" },
  { label: "مخصص", value: "custom" },
];
const periodStart = computed<Date | null>(() => {
  const now = new Date();
  if (periodPreset.value === "today") return cairoDayStart(now);
  if (periodPreset.value === "7d") return new Date(now.getTime() - 7 * 86400000);
  if (periodPreset.value === "30d") return new Date(now.getTime() - 30 * 86400000);
  return customFrom.value ? cairoDayStart(customFrom.value) : null;
});
const periodLoading = ref(false);
const periodTxns = ref<CashTransaction[]>([]);
const periodTruncated = ref(false);
async function reloadPeriodSummary(): Promise<void> {
  const start = periodStart.value;
  periodTxns.value = [];
  periodTruncated.value = false;
  if (!start) return;
  periodLoading.value = true;
  try {
    let q = query(collection(db, "cash_transactions"), where("created_at", ">=", Timestamp.fromDate(start)));
    if (typeFilter.value) q = query(q, where("type", "==", typeFilter.value));
    const snap = await getDocs(query(q, orderBy("created_at", "desc"), fsLimit(2000)));
    periodTxns.value = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CashTransaction);
    periodTruncated.value = snap.size >= 2000;
  } catch (e) {
    console.error(e);
  } finally {
    periodLoading.value = false;
  }
}
const periodIsFiltered = computed(() => typeFilter.value !== null && typeFilter.value !== undefined);
const periodIn = computed(() => round2(periodTxns.value.filter((t) => t.direction === "in").reduce((s, t) => s + toNum(t.amount), 0)));
const periodOut = computed(() => round2(periodTxns.value.filter((t) => t.direction === "out").reduce((s, t) => s + toNum(t.amount), 0)));
const periodNet = computed(() => round2(periodIn.value - periodOut.value));
const periodOpening = computed(() => round2(cashbox.balance - periodNet.value));
const exporting = ref(false);
async function exportPeriod(): Promise<void> {
  if (!periodTxns.value.length || exporting.value) return;
  exporting.value = true;
  try {
    const XLSX = await import("xlsx/dist/xlsx.full.min.js");
    const rows = periodTxns.value.map((t) => ({
      التاريخ: toDateSafe(t.created_at)?.toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }) ?? "",
      النوع: CASH_TYPE_LABELS[t.type] || t.type,
      الوصف: t.note || "",
      المبلغ: toNum(t.amount),
      الاتجاه: t.direction === "in" ? "وارد" : "صادر",
      المرجع: refLabel(t),
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [{ wch: 22 }, { wch: 20 }, { wch: 36 }, { wch: 14 }, { wch: 10 }, { wch: 30 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "حركات الخزنة");
    XLSX.writeFile(workbook, `حركات_الخزنة_${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify(`تم تصدير ${rows.length} حركة.`, "success");
  } catch (e) {
    console.error(e);
    notify("تعذر التصدير.", "error");
  } finally {
    exporting.value = false;
  }
}

const TXN_PAGE_SIZE = 25;
const txnList = ref<CashTransaction[]>([]);
const txnLoading = ref(true);
const txnPage = ref(1);
const txnHasMore = ref(false);
const txnCursors = ref<(QueryDocumentSnapshot | null)[]>([null]);
const newOpsAvailable = ref(false);
let liveTxnUnsub: Unsubscribe | null = null;
function stopLiveTxns(): void {
  liveTxnUnsub?.();
  liveTxnUnsub = null;
}
function txnBaseQuery() {
  let q = query(collection(db, "cash_transactions"));
  if (typeFilter.value) q = query(q, where("type", "==", typeFilter.value));
  if (periodStart.value) q = query(q, where("created_at", ">=", Timestamp.fromDate(periodStart.value)));
  return query(q, orderBy("created_at", "desc"));
}
function startLiveTxns(): void {
  if (!import.meta.client) return;
  stopLiveTxns();
  txnLoading.value = true;
  liveTxnUnsub = onSnapshot(query(txnBaseQuery(), fsLimit(TXN_PAGE_SIZE + 1)),
    (snap) => {
      const docs = snap.docs.slice(0, TXN_PAGE_SIZE);
      txnList.value = docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CashTransaction);
      txnHasMore.value = snap.docs.length > TXN_PAGE_SIZE;
      if (docs.length && txnHasMore.value) txnCursors.value[txnPage.value] = docs.at(-1) ?? null;
      txnLoading.value = false;
    },
    () => { txnLoading.value = false; });
}
async function loadTxnPage(): Promise<void> {
  txnLoading.value = true;
  try {
    let q = txnBaseQuery();
    const cursor = txnCursors.value[txnPage.value - 1];
    if (cursor) q = query(q, startAfter(cursor));
    const snap = await getDocs(query(q, fsLimit(TXN_PAGE_SIZE + 1)));
    const docs = snap.docs.slice(0, TXN_PAGE_SIZE);
    txnList.value = docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CashTransaction);
    txnHasMore.value = snap.docs.length > TXN_PAGE_SIZE;
    if (docs.length && txnHasMore.value) txnCursors.value[txnPage.value] = docs.at(-1) ?? null;
  } catch (e) {
    console.error(e);
  } finally {
    txnLoading.value = false;
  }
}
function goTxnPage(n: number): void {
  if (n < 1 || txnLoading.value) return;
  txnPage.value = n;
  newOpsAvailable.value = false;
  if (n === 1) startLiveTxns();
  else {
    stopLiveTxns();
    void loadTxnPage();
  }
}
function backToLatest(): void {
  txnPage.value = 1;
  txnCursors.value = [null];
  newOpsAvailable.value = false;
  startLiveTxns();
}
watch([typeFilter, periodStart], () => {
  txnPage.value = 1;
  txnCursors.value = [null];
  newOpsAvailable.value = false;
  startLiveTxns();
  void reloadPeriodSummary();
});
watch(() => cashbox.revision, () => {
  if (txnPage.value !== 1) newOpsAvailable.value = true;
});

const paged = computed(() => txnList.value);
let referenceLookupVersion = 0;
watch(
  paged,
  (transactions) => {
    void resolveMissingReferenceNames(transactions);
  },
  { immediate: true },
);

function formatDateTime(v: unknown): string {
  const d = toDateSafe(v);
  if (!d) return "-";
  return `${d.toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo" })} ${d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" })}`;
}

function descriptionWords(value: string | null | undefined): string[] {
  return value?.trim().split(/\s+/).filter(Boolean) ?? [];
}

function descriptionPreview(value: string | null | undefined): string {
  return `${descriptionWords(value).slice(0, 5).join(" ")}...`;
}

function refLabel(t: CashTransaction): string {
  const raw = String(t.reference_label || "").trim();
  const name =
    resolvedReferenceNames.value[t.id || ""] || extractReferenceName(raw);
  if (
    t.type === "invoice_sale" ||
    t.type === "invoice_payment" ||
    t.type === "invoice_edit_adjustment"
  ) {
    return `فاتورة بيع لـ ${name || "عميل"}`;
  }
  if (t.type === "inventory_purchase" || t.type === "supplier_payment") {
    return `فاتورة توريد من ${name || "مورد"}`;
  }
  if (t.type === "customer_loan" || t.type === "loan_payment") {
    return `سلفة ${name || "عميل"}`;
  }
  if (t.type === "invoice_refund") return `مرتجع فاتورة ${name || "عميل"}`;
  if (t.type === "supplier_return") return `مرتجع للمورد ${name || "منتج"}`;
  if (t.type === "inventory_adjustment") return `تسوية مخزون ${name || "منتج"}`;
  if (t.invoice_id || t.reference_type === "invoice")
    return `فاتورة بيع لـ ${name || "عميل"}`;
  if (t.purchase_invoice_id || t.reference_type === "supplier_invoice")
    return `فاتورة توريد من ${name || "مورد"}`;
  if (t.loan_id || t.reference_type === "loan") return `سلفة ${name || "عميل"}`;
  if (t.return_id || t.reference_type === "return")
    return `مرتجع فاتورة ${name || "عميل"}`;
  if (t.product_id || t.reference_type === "product")
    return `تسوية مخزون ${name || "منتج"}`;
  return t.direction === "in" ? "إيداع نقدي" : "سحب نقدي";
}

function extractReferenceName(raw: string): string {
  const name = raw
    .replace(
      /^(?:Invoice|Debt Payment|Customer Loan|Loan Payment|Supplier Invoice(?: Payment)?|Invoice Return|Supplier Return|Product Adjustment)\s*-\s*/i,
      "",
    )
    .replace(
      /\s*-\s*(?:Debt Payment|Customer Loan|Loan Payment|Supplier Invoice(?: Payment)?|Invoice Return|Supplier Return|Product Adjustment|Invoice)$/i,
      "",
    )
    .replace(
      /^(?:فاتورة(?: بيع لـ| توريد من| مورد)?|سلفة|مرتجع(?: فاتورة| للمورد)?|تسوية مخزون)\s*/u,
      "",
    )
    .trim();
  return !name ||
    /^(?:customer|supplier|product|عميل|مورد|غير مسمى|منتج)$/i.test(name)
    ? ""
    : name;
}

async function resolveMissingReferenceNames(
  transactions: CashTransaction[],
): Promise<void> {
  const version = ++referenceLookupVersion;
  const needsName = transactions.filter(
    (transaction) =>
      canViewReference(transaction) &&
      !extractReferenceName(String(transaction.reference_label || "")),
  );
  resolvedReferenceNames.value = {};
  const groups = [
    { collectionName: "invoices", isSupplier: false },
    { collectionName: "purchase_invoices", isSupplier: true },
  ];
  const resolved: Record<string, string> = {};
  for (const group of groups) {
    const groupTransactions = needsName.filter((transaction) => {
      const isSupplier =
        transaction.reference_type === "supplier_invoice" ||
        (!transaction.invoice_id && !!transaction.purchase_invoice_id);
      return isSupplier === group.isSupplier;
    });
    const ids = [
      ...new Set(
        groupTransactions
          .map(
            (transaction) =>
              transaction.reference_id ||
              (group.isSupplier
                ? transaction.purchase_invoice_id
                : transaction.invoice_id),
          )
          .filter((id): id is string => !!id),
      ),
    ];
    for (let index = 0; index < ids.length; index += 30) {
      const batch = ids.slice(index, index + 30);
      try {
        const snapshot = await getDocs(
          query(
            collection(db, group.collectionName),
            where(documentId(), "in", batch),
          ),
        );
        for (const invoice of snapshot.docs) {
          const data = invoice.data();
          const partyName = String(
            data[group.isSupplier ? "supplier_name" : "customer_name"] || "",
          ).trim();
          if (!partyName) continue;
          for (const transaction of groupTransactions) {
            const invoiceId =
              transaction.reference_id ||
              (group.isSupplier
                ? transaction.purchase_invoice_id
                : transaction.invoice_id);
            if (invoiceId === invoice.id && transaction.id)
              resolved[transaction.id] = partyName;
          }
        }
      } catch (error) {
        console.error(
          "Unable to resolve legacy cashbox reference names.",
          error,
        );
      }
    }
  }
  if (version === referenceLookupVersion)
    resolvedReferenceNames.value = resolved;
}

function canViewReference(transaction: CashTransaction): boolean {
  return !!(
    ((transaction.reference_type === "invoice" || transaction.invoice_id) &&
      (transaction.reference_id || transaction.invoice_id)) ||
    ((transaction.reference_type === "supplier_invoice" ||
      transaction.purchase_invoice_id) &&
      (transaction.reference_id || transaction.purchase_invoice_id))
  );
}
async function viewReference(transaction: CashTransaction): Promise<void> {
  const isPurchase =
    transaction.reference_type === "supplier_invoice" ||
    (!transaction.invoice_id && !!transaction.purchase_invoice_id);
  const id =
    transaction.reference_id ||
    (isPurchase ? transaction.purchase_invoice_id : transaction.invoice_id);
  if (!id) return;
  referenceOpen.value = true;
  referenceLoading.value = true;
  referenceError.value = "";
  referenceInvoice.value = null;
  referencePurchase.value = null;
  referenceTitle.value = refLabel(transaction);
  try {
    const snap = await getDoc(
      doc(db, isPurchase ? "purchase_invoices" : "invoices", id),
    );
    if (!snap.exists()) {
      referenceError.value = "الفاتورة غير موجودة.";
      return;
    }
    if (isPurchase)
      referencePurchase.value = {
        id: snap.id,
        ...(snap.data() as object),
      } as PurchaseInvoice;
    else
      referenceInvoice.value = {
        id: snap.id,
        ...(snap.data() as object),
      } as Invoice;
  } catch {
    referenceError.value = "تعذر تحميل الفاتورة.";
  } finally {
    referenceLoading.value = false;
  }
}

function closeForms(): void {
  depositOpen.value = false;
  withdrawOpen.value = false;
  amount.value = undefined;
  note.value = "";
  submitError.value = "";
}

async function doAdjust(
  type: CashTransactionType,
  direction: CashDirection,
): Promise<void> {
  submitError.value = "";
  if (amountError.value || amount.value === undefined) {
    submitError.value = amountError.value || "أدخل المبلغ أولاً.";
    return;
  }
  const v = round2(amount.value);
  busy.value = true;
  try {
    const res = await cashbox.adjustCash({
      type,
      direction,
      amount: v,
      note: note.value.trim() || null,
    });
    if (!res.ok) {
      submitError.value = res.error;
      return;
    }
    notify(
      direction === "in"
        ? "تمت إضافة المبلغ للخزنة بنجاح."
        : "تم سحب المبلغ من الخزنة بنجاح.",
      "success",
    );
    closeForms();
  } finally {
    busy.value = false;
  }
}

async function doOpening(): Promise<void> {
  const raw = openingAmount.value;
  if (raw === undefined || raw === null || !Number.isFinite(Number(raw)) || Number(raw) < 0) {
    notify("أدخل الرصيد الافتتاحي (صفر مسموح به).", "error");
    return;
  }
  const v = round2(raw);
  openingBusy.value = true;
  try {
    const res = await cashbox.ensureOpeningBalance(
      v,
      openingNote.value.trim() || null,
    );
    if (!res.ok) {
      notify(res.error, "error");
      return;
    }
    notify("تم تهيئة الخزنة بالرصيد الافتتاحي.", "success");
  } finally {
    openingBusy.value = false;
  }
}

onUnmounted(() => {
  stopLiveTxns();
  unsubscribeSummaries();
});
onMounted(async () => {
  const authed = await useAuthReady();
  if (!authed) {
    cashbox.loading = false;
    txnLoading.value = false;
    statsLoading.value = false;
    referenceLoading.value = false;
    return; // layout redirects to /login
  }
  cashbox.ensureCashboxSubscription();
  products.ensureInventorySubscription();
  subscribeSummaries();
  startLiveTxns();
  void reloadPeriodSummary();
  void products.fetchProducts();
});
</script>
