<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">المنتجات</h2>
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          v-if="isAdmin"
          color="info"
          variant="soft"
          icon="i-lucide-file-up"
          @click="importOpen = true"
          >استيراد كميات ومنتجات</UButton
        >
        <UButton
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          @click="shortagesOpen = true"
          >الوحدات قليلة الكمية ({{ shortageCount }})</UButton
        >
        <!-- HOME delta: no products export (as in home branch). -->
        <FormsProduct
          v-if="isAdmin"
          @close="productForm = undefined"
          :refresher="loadProds"
          v-model="productFormState"
          :edit="productForm"
        >
          <UButton icon="i-lucide-plus" color="success"
            >إضافة منتج جديد</UButton
          >
        </FormsProduct>
      </div>
    </div>
    <UAlert
      v-if="productsStore.syncError || loadError"
      color="error"
      variant="soft"
      :title="loadError || 'تعذر تحميل المنتجات.'"
      class="mb-3"
      ><template #actions
        ><UButton size="xs" color="error" variant="soft" @click="retryProducts"
          >إعادة المحاولة</UButton
        ></template
      ></UAlert
    >
    <ProductsLowStockDialog
      v-model:open="shortagesOpen"
      :products="productsStore.list"
      :show-cost="false"
    />
    <ProductsPurchaseImportDialog
      v-if="isAdmin"
      v-model:open="importOpen"
      :products="productsStore.list"
      :cash-balance="cashBalance"
      @done="refreshAfterPurchase"
    />
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <UInput
        v-model="searchText"
        placeholder="بحث"
        icon="i-lucide-search"
        size="lg"
        class="w-full sm:max-w-xs"
      />
      <div v-if="isAdmin" class="flex flex-wrap items-center gap-2">
        <UButton
          v-if="
            prodsList.length > 0 &&
            selectProducts.length < prodsList.length
          "
          icon="i-lucide-check-check"
          color="neutral"
          variant="soft"
          @click="selectAllFiltered"
          >تحديد الكل ({{ prodsList.length }})</UButton
        >
        <template v-if="selectProducts.length > 0">
          <UButton
            icon="i-lucide-file-plus"
            color="success"
            @click="createInvoiceFromSelectedProducts"
            >إنشاء فاتورة بالمنتجات المحددة ({{
              selectProducts.length
            }})</UButton
          >
          <UButton
            icon="i-lucide-archive"
            color="warning"
            variant="soft"
            @click="bulkDeleteOpen = true"
            >أرشفة المحدد ({{ selectProducts.length }})</UButton
          >
          <UButton
            icon="i-lucide-x"
            color="error"
            variant="soft"
            @click="clearConfirm = true"
            >إلغاء التحديد</UButton
          >
        </template>
        <UiAppDialog v-model:open="clearConfirm" title="إلغاء التحديد">
          <p class="py-2 text-gray-600">
            أنت علي وشك إلغاء المنتجات المحددة، هل أنت متاكد؟
          </p>
          <template #footer>
            <div class="flex w-full justify-center gap-2">
              <UButton
                color="error"
                @click="
                  selectProducts = [];
                  clearConfirm = false;
                "
                >تاكيد</UButton
              >
              <UButton
                color="neutral"
                variant="outline"
                @click="clearConfirm = false"
                >إلغاء</UButton
              >
            </div>
          </template>
        </UiAppDialog>
      </div>
    </div>
    <UiAppTableSkeleton
      v-if="
        loading ||
        (!productsStore.inventoryReady &&
          productsStore.inventorySyncState === 'loading')
      "
    />
    <template v-else>
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead><tr class="border-b text-gray-500">
            <th v-if="isAdmin" class="w-10 p-3"></th>
            <th class="p-3 text-start">اسم المنتج</th><th class="p-3 text-start">الكمية المتاحة</th><th class="p-3 text-start">الأسعار</th><th v-if="isAdmin" class="p-3 text-start">الإجراءات</th>
          </tr></thead>
          <tbody>
            <tr v-for="p in paginateArray" :key="p.id" class="border-b border-gray-100">
              <td v-if="isAdmin" class="p-3"><UCheckbox :model-value="groupSelected(p.variants)" @update:model-value="toggleGroup(p.variants)" /></td>
              <td class="p-3 font-semibold">{{ p.name }}</td>
              <td class="p-3"><span v-if="!p.complex">{{ stockQuantityLabel(p.variants[0]!) }}</span><UButton v-else variant="soft" color="neutral" icon="i-lucide-boxes" @click="showDetails(p.id, 'quantities')">عرض الكميات</UButton></td>
              <td class="p-3"><span v-if="!p.complex">{{ simplePrice(p.variants[0]!) }}</span><UButton v-else variant="soft" color="neutral" icon="i-lucide-tags" @click="showDetails(p.id, 'prices')">عرض الأسعار</UButton></td>
              <td v-if="isAdmin" class="p-3"><div class="flex flex-wrap gap-2">
                <UButton size="sm" variant="soft" @click="editProduct({ id: p.variants[0]?.id })">تعديل</UButton>
                <UButton size="sm" variant="soft" color="info" @click="chooseVariant(p.id, 'purchase')">شراء</UButton>
                <UButton size="sm" variant="soft" color="neutral" @click="chooseVariant(p.id, 'adjust')">جرد</UButton>
                <UButton size="sm" variant="soft" color="warning" @click="confirmDelete = { id: p.variants[0]?.id, name: p.name, ids: p.variants.flatMap(v => v.id ? [v.id] : []) }">أرشفة</UButton>
              </div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="space-y-3 md:hidden">
        <UCard v-for="p in paginateArray" :key="p.id">
          <div class="flex items-center gap-2"><UCheckbox v-if="isAdmin" :model-value="groupSelected(p.variants)" @update:model-value="toggleGroup(p.variants)" /><h3 class="font-bold">{{ p.name }}</h3></div>
          <div class="mt-3 flex flex-wrap gap-2">
            <span v-if="!p.complex" class="text-sm">{{ stockQuantityLabel(p.variants[0]!) }} · سعر البيع {{ simplePrice(p.variants[0]!) }}</span>
            <UButton v-if="p.complex" color="neutral" variant="soft" @click="showDetails(p.id, 'quantities')">عرض الكميات</UButton>
            <UButton v-if="p.complex" color="neutral" variant="soft" @click="showDetails(p.id, 'prices')">عرض الأسعار</UButton>
            <template v-if="isAdmin">
              <UButton variant="soft" @click="editProduct({ id: p.variants[0]?.id })">تعديل</UButton>
              <UButton color="info" variant="soft" @click="chooseVariant(p.id, 'purchase')">شراء</UButton>
              <UButton color="neutral" variant="soft" @click="chooseVariant(p.id, 'adjust')">جرد</UButton>
              <UButton color="warning" variant="soft" @click="confirmDelete = { id: p.variants[0]?.id, name: p.name, ids: p.variants.flatMap(v => v.id ? [v.id] : []) }">أرشفة</UButton>
            </template>
          </div>
        </UCard>
      </div>
      <UEmpty v-if="!paginateArray.length" title="لا توجد منتجات" />
    </template>
    <UiAppDialog v-model:open="detailsOpen" :title="`${detailMode === 'prices' ? 'عرض الأسعار' : 'عرض الكميات'} · ${detailGroup?.name || ''}`" width="sm:max-w-[740px]">
      <div class="space-y-4">
        <p v-if="detailMode === 'quantities'" class="text-sm text-gray-500">{{ detailGroup?.variants[0]?.inventory_mode === 'independent' ? 'كل حجم عبوة له رصيد مستقل، والكرتونة تخص الحجم الموضح فقط.' : 'الأعداد بدائل لنفس المخزون ولا تُجمع. الكمية المفردة تشمل فتح العبوات، والعبوات المعروضة هي المغلقة فقط.' }}</p>
        <section v-for="type in detailTypes" :key="type.key" class="space-y-3 rounded-xl border border-gray-200 p-3">
          <h3 v-if="detailGroup?.variants[0]?.uses_variants !== false" class="font-bold">{{ type.name }}</h3>
          <div v-for="variant in type.products" :key="variant.id" class="space-y-2 rounded-lg border border-gray-100 p-3">
            <h4 v-if="variant.inventory_mode === 'independent'" class="font-semibold">{{ variant.pack_size_name }}</h4>
            <p v-if="detailMode === 'quantities'" class="text-sm text-gray-500">المخزون الفعلي: {{ stockQuantityLabel(variant) }}</p>
            <div v-for="unit in unitsForProduct(variant).filter(unit => !unit.archived)" :key="unit.id" class="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 py-2">
              <span class="font-semibold">{{ unit.name }}</span>
              <div v-if="detailMode === 'prices'" class="text-sm"><p>سعر البيع: {{ unit.selling_price == null ? 'غير محدد' : `${formatePrice(unit.selling_price)} ج` }}</p><p v-if="isAdmin" class="text-gray-500">تكلفة التسعير: {{ unitReferenceCost(variant, unit) == null ? 'غير متاح' : `${formatePrice(unitReferenceCost(variant, unit))} ج` }}</p><p v-if="isAdmin" class="text-gray-500">متوسط المخزون: {{ unitAverageCost(variant, unit) == null ? 'غير متاح' : `${formatePrice(unitAverageCost(variant, unit))} ج` }}</p></div>
              <span v-else>متاح {{ unitStockDisplay(variant, unit) }} {{ unit.name }}</span>
            </div>
          </div>
        </section>
      </div>
    </UiAppDialog>
    <UiAppDialog v-model:open="variantChoiceOpen" :title="`اختر النوع وحجم العبوة · ${actionGroup?.name || ''}`">
      <div class="space-y-3"><section v-for="type in actionTypes" :key="type.key" class="space-y-2"><h3 v-if="actionGroup?.variants[0]?.uses_variants !== false" class="font-semibold">{{ type.name }}</h3><div class="flex flex-col gap-2"><UButton v-for="variant in type.products" :key="variant.id" color="neutral" variant="soft" @click="runVariantAction(variant.id)">{{ variant.inventory_mode === 'independent' ? variant.pack_size_name : productSkuLabel(variant) }}</UButton></div></section></div>
    </UiAppDialog>
    <div class="mt-3 flex items-center justify-between gap-2">
      <USelect
        v-model="currentPerPage"
        :items="[10, 25, 50, 100, 150]"
        size="sm"
        class="w-24"
      />
      <UPagination
        v-model:page="currentPage"
        :total="familyRows.length"
        :items-per-page="currentPerPage"
        :sibling-count="1"
        size="sm"
      />
    </div>
    <UiAppDialog v-model:open="deleteOpen" title="أرشفة المنتج">
      <p class="mb-2 text-gray-600">
        {{ confirmDelete?.name }} — الأرشفة تحفظ المنتج وسجله المحاسبي وتمنع بيعه.
      </p>
      <p v-if="deleteTarget" class="mb-4 text-xs text-gray-500">
        المخزون المتبقي:
        {{ stockQuantityLabel(deleteTarget) }} — إرجاع المورد عملية مالية مستقلة.
      </p>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton
            color="warning"
            block
            :loading="deleting"
            @click="archiveConfirmed"
            >تأكيد الأرشفة</UButton
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
    <UiAppDialog v-model:open="bulkDeleteOpen" title="أرشفة المنتجات المحددة">
      <p class="mb-2 text-gray-600">
        سيتم أرشفة {{ selectProducts.length }} منتج محدد مع حفظ سجلاتها المحاسبية.
      </p>
      <div
        class="mb-4 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 text-sm"
      >
        <div
          v-for="p in bulkSelectedProducts"
          :key="p.id"
          class="truncate text-gray-700"
        >
          • {{ p.name }}
        </div>
      </div>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton
            color="warning"
            block
            :loading="bulkBusy"
            @click="bulkArchiveConfirmed"
            >تأكيد أرشفة المحدد</UButton
          >
          <UButton
            color="neutral"
            variant="ghost"
            block
            :disabled="bulkBusy"
            @click="bulkDeleteOpen = false"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
    <!-- Stock purchase -->
    <UiAppDialog
      v-model:open="purchaseOpen"
      :title="`شراء مخزون — ${purchaseName}`"
    >
      <div class="space-y-3">
        <UAlert
          color="info"
          variant="soft"
          :title="`المخزون الحالي: ${purchaseCountText}`"
        />
        <UFormField v-if="purchaseUnits.length > 1" label="وحدة الشراء">
          <USelectMenu
            :model-value="purchaseUnit"
            :items="purchaseUnits"
            label-key="name"
            by="id"
            :search-input="false"
            class="w-full"
            @update:model-value="(unit) => selectPurchaseUnit(unit)"
          />
        </UFormField>
        <UFormField
          label="الكمية المشتراة"
          required
          :error="purchaseQtyError || undefined"
        >
          <UInputNumber
            v-model="purchaseQty"
            :min="purchaseUnit?.allows_fractional ? 0.0001 : 1"
            :step="purchaseUnit?.allows_fractional ? 0.0001 : 1"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="سعر تكلفة الوحدة"
          required
          :error="purchaseCostError || undefined"
        >
          <UInputNumber
            v-model="purchaseCost"
            :min="0"
            :step="0.0001"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <p class="text-xs text-gray-500">تُحدّث أسعار الوحدات تلقائيًا بنفس نسبة هامش الربح مع تكلفة آخر شراء. يمكنك تعديل سعر الوحدة المختارة يدويًا.</p>
        <div
          v-if="purchaseInputsReady"
          class="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3"
        >
          <UFormField
            label="متوسط التكلفة الجديد"
            :hint="`سعر التكلفة القديم: ${formatePrice(purchaseOldUnitAvg)} ج`"
          >
            <UInputNumber
              :model-value="suggestedAvgUnit"
              :min="0"
              :step="0.0001"
              size="lg"
              class="w-full"
              disabled
            />
          </UFormField>
          <div class="space-y-1 text-xs">
            <p class="font-semibold">أسعار البيع بعد الشراء</p>
            <p v-for="unit in automaticPrices.filter(unit => !unit.archived && unit.can_sell !== false)" :key="unit.id">{{ unit.name }}: {{ unit.selling_price == null ? 'يلزم تحديد السعر يدويًا' : `${formatePrice(unit.selling_price)} ج` }}</p>
          </div>
          <UCheckbox v-if="purchaseUnitSellable" v-model="purchasePriceEnabled" label="تعديل سعر بيع هذه الوحدة يدويًا" />
          <UFormField
            v-if="priceFieldShown"
            label="سعر البيع الجديد"
            :hint="
              purchaseUnitOldPrice === null
                ? 'لم يُسعر من قبل'
                : `سعر البيع القديم: ${formatePrice(purchaseUnitOldPrice)} ج`
            "
            :error="purchasePriceError || undefined"
          >
            <UInputNumber
              :model-value="purchasePrice"
              :min="0"
              :step="0.01"
              size="lg"
              class="w-full"
              @update:model-value="setPurchasePrice"
            />
          </UFormField>
        </div>
        <div class="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <div class="flex justify-between">
            <span>إجمالي الشراء</span><b>{{ formatePrice(purchaseTotal) }} ج</b>
          </div>
          <div class="flex justify-between">
            <span>رصيد الخزنة</span><b>{{ formatePrice(cashBalance) }} ج</b>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span>المدفوع الآن</span>
            <UInputNumber
              :model-value="purchasePaid"
              :min="0"
              :max="cashBalance"
              :step="0.01"
              size="sm"
              class="w-40"
              @update:model-value="setPurchasePaid"
            />
          </div>
          <p v-if="purchasePaidError" class="text-xs text-red-600">
            {{ purchasePaidError }}
          </p>
          <div class="flex justify-between">
            <span>الباقي المستحق</span
            ><b class="text-amber-700"
              >{{
                formatePrice(Math.max(0, purchaseTotal - (purchasePaid ?? 0)))
              }}
              ج</b
            >
          </div>
          <div
            v-if="(purchasePaid ?? 0) > purchaseTotal"
            class="flex justify-between text-blue-700"
          >
            <span>سلفة مستحقة لنا</span
            ><b>{{ formatePrice((purchasePaid ?? 0) - purchaseTotal) }} ج</b>
          </div>
        </div>
        <!-- Cost blending + selling price: compact card, shown only when the
          entered cost actually moves the average or the price. Money here is
          in the selected purchase unit's terms; the saved average stays in
          base terms, and other units follow the same margin automatically. -->

        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <UFormField label="المورد (اختياري)">
            <USelectMenu
              :model-value="(purchaseSupplier ?? null) as Supplier | undefined"
              :items="supplierMenuItems"
              label-key="name"
              by="id"
              placeholder="اختر المورد"
              :search-input="{
                placeholder: 'بحث عن مورد...',
                icon: 'i-lucide-search',
              }"
              class="w-full"
              @update:model-value="(s) => onPickPurchaseSupplier(s)"
            />
            <FormsSupplier
              v-model="showSupplierModal"
              :refresher="reloadPurchaseSuppliers"
              @done="onPurchaseSupplierCreated"
            />
          </UFormField>
          <UFormField label="مرجع فاتورة المورد (اختياري)">
            <UInput
              v-model="purchaseSupplierRef"
              placeholder="رقم/مرجع"
              size="lg"
              class="w-full"
              dir="ltr"
            />
          </UFormField>
        </div>
        <UFormField label="ملاحظة">
          <UInput
            v-model="purchaseNote"
            placeholder="مثال: فاتورة مورد"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="stockSubmitError"
          color="error"
          variant="soft"
          :title="stockSubmitError"
        />
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="success"
            class="min-h-11 flex-1"
            :loading="stockBusy"
            icon="i-lucide-package-plus"
            @click="doPurchase"
            >تأكيد الشراء</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="min-h-11 flex-1"
            :disabled="stockBusy"
            @click="purchaseOpen = false"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
    <!-- Manual stock adjustment (no cash) -->
    <UiAppDialog
      v-model:open="adjustOpen"
      :title="`تعديل مخزون — ${adjustName}`"
    >
      <div class="space-y-3">
        <UAlert
          color="warning"
          variant="soft"
          title="هذا التعديل سيغيّر كمية المخزون فقط ولن يؤثر على رصيد الخزنة."
        />
        <UFormField label="مكوّن المخزون المراد جرده" required>
          <USelect v-model="adjustComponentKey" :items="adjustComponentOptions" value-key="value" label-key="label" class="w-full" />
        </UFormField>
        <UFormField label="الرصيد الحالي لهذا المكوّن">
          <UInput
            :model-value="adjustCountText"
            readonly
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="الرصيد الفعلي الجديد لهذا المكوّن"
          hint="سيستبدل رصيد هذا المكوّن فقط؛ بقية العبوات والكمية المفتوحة لن تتغير."
          required
          :error="adjustNewError || undefined"
        >
          <UInputNumber
            v-model="adjustNew"
            :min="0"
            :step="adjustBucket === 'package' ? 1 : 0.0001"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="adjustNew !== undefined" color="info" variant="soft" :title="`بعد الحفظ: ${adjustComponentLabel} ${adjustNew} (كان ${adjustCountText})`" />
        <UFormField label="سبب التعديل" required>
          <UInput
            v-model="adjustReason"
            placeholder="مثال: جرد فعلي"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="stockSubmitError"
          color="error"
          variant="soft"
          :title="stockSubmitError"
        />
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton
            color="success"
            class="min-h-11 flex-1"
            :loading="stockBusy"
            @click="doAdjust"
            >حفظ التعديل</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            class="min-h-11 flex-1"
            :disabled="stockBusy"
            @click="adjustOpen = false"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import { repriceUnits, unitReferenceCost } from "~/functions/shared/unitPricing.mjs";
import { groupProductVariants, groupProductsByVariant, productSkuLabel } from "~/utils/productVariants";
import type { Invoice, Product } from "~/types";
import type { ProductUnit } from "~/types";
import type { Supplier } from "~/types/finance";
import type { PriceDecision } from "~/composables/finance";
import { useSuppliersStore } from "~/stores/suppliers";
import { toDateSafe } from "~/types";
definePageMeta({ title: "المنتجات" });
const searchText = ref<string>("");
const { formatePrice } = useHelpers();
const {
  round2,
  round4,
  toNum,
  unitStockDisplay,
  unitAverageCost,
  unitSellingPrice,
  purchasableUnitsForProduct,
  unitsForProduct,
  convertUnitPrice,
  unitPurchasePrice,
  purchasePreviewAverage,
  stockQuantityLabel,
} = useFinance();
const productFormState = ref(false);
const productsStore = useProductsStore();
// Hydration gate (see pages/index.vue): keeps SSR + first client render
// identical by hiding admin-only controls until post-mount.
const hydrated = ref(false);
const isAdmin = computed(() => hydrated.value && useAuth().role === "admin");
const loading = ref(true);
const loadError = ref("");
const deleting = ref(false);
const currentPage = ref(1);
const currentPerPage = ref(10);
const productForm = ref<Product | undefined>(undefined);
const selectProducts = ref<string[]>([]);
const invoiceStore = useInvoicesStore();
const purchaseOpen = ref(false);
const purchaseId = ref<string | null>(null);
const purchaseQty = ref<number | undefined>(undefined);
const purchaseCost = ref<number | undefined>(undefined);
const purchaseUnitId = ref("");
const purchaseUnits = computed<ProductUnit[]>(() => {
  const product = productsStore.list.find((item) => item.id === purchaseId.value);
  return product ? purchasableUnitsForProduct(product) : [];
});
const purchaseUnit = computed(
  () =>
    purchaseUnits.value.find((unit) => unit.id === purchaseUnitId.value) ??
    purchaseUnits.value[0],
);
function selectPurchaseUnit(unit?: ProductUnit): void {
  if (!unit) return;
  const currentUnit = purchaseUnits.value.find(
    (candidate) => candidate.id === purchaseUnitId.value,
  );
  const currentFactor = Number(currentUnit?.factor);
  purchaseUnitId.value = unit.id;
  const product = productsStore.list.find((item) => item.id === purchaseId.value);
  // سعر الشراء يتبع الوحدة المختارة نفسها (آخر سعر شراء مسجل عليها)，
  // وليس تحويلاً من المتوسط الحالي.
  const unitLastCost = product ? unitPurchasePrice(product, unit) : null;
  if (unitLastCost !== null && unitLastCost !== undefined) {
    purchaseCost.value = unitLastCost;
    return;
  }
  purchaseCost.value = currentFactor > 0
    ? convertUnitPrice(purchaseCost.value ?? purchaseCurrentCost.value, currentFactor, unit.factor)
    : undefined;
}
const purchasePrice = ref<number | undefined>(undefined);
const purchasePriceTouched = ref(false);
const purchasePriceEnabled = ref(false);
function setPurchasePrice(value: number | undefined): void {
  purchasePriceTouched.value = true;
  purchasePrice.value = value;
}
const purchasePaid = ref<number | undefined>(undefined);
const purchasePaidTouched = ref(false);
const suppliersStore = useSuppliersStore();
const purchaseSupplier = ref<Supplier | undefined>();
const CREATE_SUPPLIER_ID = "__create__";
const showSupplierModal = ref(false);
const supplierMenuItems = computed<Supplier[]>(() => [
  { id: CREATE_SUPPLIER_ID, name: "+ إضافة مورد جديد" } as Supplier,
  ...suppliersStore.list,
]);
function onPickPurchaseSupplier(s: Supplier | null | undefined): void {
  if (!s) {
    purchaseSupplier.value = undefined;
    return;
  }
  if (s.id === CREATE_SUPPLIER_ID) {
    showSupplierModal.value = true;
    return;
  }
  purchaseSupplier.value =
    suppliersStore.list.find((item) => item.id === s.id) ?? s;
}
async function reloadPurchaseSuppliers(): Promise<void> {
  await suppliersStore.fetchSuppliers(true);
}
function onPurchaseSupplierCreated(s: Supplier | null | undefined): void {
  if (s?.id)
    purchaseSupplier.value =
      suppliersStore.list.find((item) => item.id === s.id) ?? s;
}
const purchaseSupplierRef = ref("");
const purchaseKey = ref("");
const purchaseNote = ref("");
const purchaseName = computed(
  () => productsStore.list.find((p) => p.id === purchaseId.value)?.name ?? "",
);
const purchaseCount = computed(
  () =>
    productsStore.list.find((p) => p.id === purchaseId.value)?.stock_quantity ??
    null,
);
const purchaseCountText = computed(() => {
  const product = productsStore.list.find((p) => p.id === purchaseId.value);
  return product ? stockQuantityLabel(product, purchaseCount.value) : "—";
});
// Shortages dialog state (dialog content lands in S4).
const shortagesOpen = ref(false);
const importOpen = ref(false);
const shortageCount = computed(() => productsStore.shortageUnitCount);
async function refreshAfterPurchase(): Promise<void> {
  await Promise.all([productsStore.fetchProducts(), cashbox.fetchCashbox()]);
}

// FLAG [B4-FIXED]: no mutation inside computed; watcher resets page.
watch(searchText, () => {
  currentPage.value = 1;
});

const prodsList = computed<Product[]>(() => {
  const q = searchText.value?.trim().toLowerCase();
  if (!q) return [...productsStore.list];
  return productsStore.list.filter((prod) =>
    prod.name?.toLowerCase().includes(q),
  );
});
const familyRows = computed(() => {
  const query = searchText.value?.trim().toLocaleLowerCase();
  return groupProductVariants([...productsStore.list].sort((a, b) => (toDateSafe(b.date)?.getTime() ?? 0) - (toDateSafe(a.date)?.getTime() ?? 0)))
    .filter((group) => !query || group.name.toLocaleLowerCase().includes(query) || group.variants.some((variant) => variant.variant_name?.toLocaleLowerCase().includes(query) || variant.pack_size_name?.toLocaleLowerCase().includes(query)))
    .map((group) => ({ ...group, complex: group.variants.length > 1 || group.variants.some((variant) => unitsForProduct(variant).filter((unit) => !unit.archived).length > 1) }));
});
function simplePrice(product: Product): string {
  const unit = unitsForProduct(product).find((unit) => !unit.archived);
  return unit?.selling_price == null ? "غير محدد" : `${formatePrice(unit.selling_price)} ج`;
}
const paginateArray = computed(() => familyRows.value.slice((currentPage.value - 1) * currentPerPage.value, currentPage.value * currentPerPage.value));
const detailsOpen = ref(false);
const detailMode = ref<"prices" | "quantities">("prices");
const detailId = ref("");
const detailGroup = computed(() => familyRows.value.find((group) => group.id === detailId.value));
const detailTypes = computed(() => groupProductsByVariant(detailGroup.value?.variants || []));
function showDetails(id: string, mode: "prices" | "quantities"): void {
  detailId.value = id;
  detailMode.value = mode;
  detailsOpen.value = true;
}
const variantChoiceOpen = ref(false);
const actionId = ref("");
const variantAction = ref<"purchase" | "adjust">("purchase");
const actionGroup = computed(() => familyRows.value.find((group) => group.id === actionId.value));
const actionTypes = computed(() => groupProductsByVariant(actionGroup.value?.variants || []));
function chooseVariant(id: string, action: "purchase" | "adjust"): void {
  actionId.value = id;
  variantAction.value = action;
  if (actionGroup.value?.variants.length === 1) runVariantAction(actionGroup.value.variants[0]?.id);
  else variantChoiceOpen.value = true;
}
function runVariantAction(id?: string): void {
  variantChoiceOpen.value = false;
  if (variantAction.value === "purchase") openPurchase(id);
  else openAdjust(id);
}
function groupSelected(variants: Product[]): boolean {
  return variants.every((variant) => variant.id && selectProducts.value.includes(variant.id));
}
function toggleGroup(variants: Product[]): void {
  const selected = groupSelected(variants);
  const ids = new Set(variants.flatMap((variant) => variant.id ? [variant.id] : []));
  selectProducts.value = selected ? selectProducts.value.filter((id) => !ids.has(id)) : [...new Set([...selectProducts.value, ...ids])];
}
/** Select every product matching the current search (across all pages). */
function selectAllFiltered(): void {
  selectProducts.value = familyRows.value.flatMap((group) => group.variants)
    .map((p) => p.id)
    .filter((id): id is string => !!id);
}
const bulkSelectedProducts = computed(() => {
  const selected = new Set(selectProducts.value);
  return productsStore.list.filter((p) => p.id && selected.has(p.id));
});
function editProduct(product: { id?: string }): void {
  const prod = productsStore.list.find((el) => el.id === product.id);
  if (prod) productForm.value = { ...prod };
  productFormState.value = true;
}
// Stock purchase / manual adjustment (F8/F34) — audited flows via useInventory.
const inventory = useInventory();
const cashbox = useCashbox();
const cashBalance = computed(() => cashbox.balance);
const { notify: notifyToast } = useAppToast();
const stockBusy = ref(false);
const stockSubmitError = ref("");
// Live field errors: empty = untouched (no red); message only when truly invalid.
const purchaseQtyError = computed(() => {
  if (purchaseQty.value === undefined || purchaseQty.value === null) return "";
  if (!(purchaseQty.value > 0)) return "الكمية يجب أن تكون أكبر من صفر.";
  if (Math.abs(round4(purchaseQty.value) - purchaseQty.value) > 1e-9)
    return "الكمية تقبل أربع منازل عشرية كحد أقصى.";
  if (purchaseUnit.value?.allows_fractional !== true && !Number.isInteger(purchaseQty.value))
    return "هذه الوحدة لا تقبل كميات كسرية.";
  return "";
});
const purchaseCostError = computed(() => {
  if (purchaseCost.value === undefined || purchaseCost.value === null)
    return "";
  return purchaseCost.value >= 0 ? "" : "سعر التكلفة غير صالح.";
});
const purchasePriceError = computed(() => {
  if (!priceFieldShown.value || purchasePrice.value === undefined || purchasePrice.value === null)
    return "";
  return purchasePrice.value >= 0 ? "" : "سعر البيع غير صالح.";
});
const purchasePaidError = computed(() => {
  if (purchasePaid.value === undefined || purchasePaid.value === null)
    return "";
  if (!(purchasePaid.value >= 0)) return "المدفوع غير صالح.";
  if (
    purchasePaid.value - purchaseTotal.value > 1e-9 &&
    !purchaseSupplier.value?.id
  )
    return "اختر المورد لتسجيل الزيادة كسلفة.";
  if (purchasePaid.value - cashBalance.value > 1e-9)
    return "المدفوع يتجاوز رصيد الخزنة المتاح.";
  return "";
});
const adjustNewError = computed(() => {
  if (adjustNew.value === undefined || adjustNew.value === null) return "";
  if (!Number.isFinite(adjustNew.value) || adjustNew.value < 0) return "الكمية الجديدة غير صالحة.";
  if (Math.abs(round4(adjustNew.value) - adjustNew.value) > 1e-9)
    return "الكمية تقبل أربع منازل عشرية كحد أقصى.";
  if (adjustBucket.value === "package" && !Number.isInteger(adjustNew.value))
    return "عدد العبوات المغلقة يجب أن يكون رقمًا صحيحًا.";
  return "";
});
const purchaseTotal = computed(() =>
  round2((purchaseQty.value || 0) * (purchaseCost.value || 0)),
);
watch([purchaseTotal, cashBalance], ([amount, balance]) => {
  if (!purchasePaidTouched.value)
    purchasePaid.value = Math.min(amount, balance);
});
function setPurchasePaid(value: number | undefined): void {
  purchasePaidTouched.value = true;
  purchasePaid.value = value;
}
// Live pricing-policy preview: SAME canonical helpers as the transaction.
// All money on this card is in the SELECTED unit's terms; stock/average math
// is always in base terms (qty × factor, cost ÷ factor).
const purchaseProduct = computed(() =>
  productsStore.list.find((p) => p.id === purchaseId.value),
);
const purchaseCurrentCost = computed(() =>
  toNum(purchaseProduct.value?.cost_price),
);
const purchaseFactor = computed(() => {
  const f = Number(purchaseUnit.value?.factor);
  return Number.isFinite(f) && f > 0 ? f : 0;
});
const purchaseBaseQty = computed(() =>
  purchaseFactor.value > 0 ? round4(toNum(purchaseQty.value ?? 0) * purchaseFactor.value) : 0,
);
const purchaseBaseCost = computed(() =>
  purchaseFactor.value > 0 ? toNum(purchaseCost.value ?? 0) / purchaseFactor.value : 0,
);
const purchasePreviewAvg = computed(() =>
  round4(
    purchasePreviewAverage(
      purchaseProduct.value?.stock_quantity,
      purchaseCurrentCost.value,
      purchaseBaseQty.value,
      purchaseBaseCost.value,
    ),
  ),
);
const purchaseInputsReady = computed(
  () => purchaseQty.value !== undefined && purchaseCost.value !== undefined,
);
// The selected unit's own price (null = never priced) and sellability.
const purchaseUnitOldPrice = computed(() => {
  const product = purchaseProduct.value;
  const unit = purchaseUnit.value;
  if (!product || !unit) return null;
  return unitSellingPrice(product, unit);
});
const purchaseUnitSellable = computed(
  () => !purchaseUnit.value || purchaseUnit.value.can_sell !== false,
);
// Recorded average, scaled to the selected unit.
const purchaseOldUnitAvg = computed(() =>
  round4(purchaseCurrentCost.value * purchaseFactor.value),
);
// System suggestion (base terms): quantity-weighted when stock history
// exists; a plain midpoint when only a recorded average exists (no quantity
// to weight with); otherwise the entered cost itself.
const suggestedAvgBase = computed(() => {
  return purchasePreviewAvg.value;
});
const suggestedAvgUnit = computed(() =>
  round4(suggestedAvgBase.value * purchaseFactor.value),
);
const automaticPrices = computed(() => {
  const product = purchaseProduct.value;
  if (!product || !purchaseInputsReady.value || purchaseCostError.value || purchaseQtyError.value || purchaseFactor.value <= 0) return [];
  return repriceUnits(product, purchaseBaseCost.value);
});
const effectiveProposal = computed(() => {
  const unit = purchaseUnit.value;
  const price = automaticPrices.value.find((entry) => entry.id === unit?.id);
  return { rate: price?.profit_margin ?? null, proposed: price?.selling_price ?? null };
});
const priceFieldShown = computed(
  () => purchaseUnitSellable.value && purchasePriceEnabled.value,
);
function syncPurchaseSuggestions(): void {
  if (!purchasePriceTouched.value) purchasePrice.value = purchasePriceEnabled.value && purchaseUnitSellable.value
    ? effectiveProposal.value.proposed ?? undefined
    : undefined;
}
watch([purchaseQty, purchaseCost, purchaseUnitId, purchaseId], () => {
  syncPurchaseSuggestions();
});
watch(purchasePriceEnabled, (enabled) => {
  purchasePriceTouched.value = false;
  purchasePrice.value = enabled && purchaseUnitSellable.value
    ? effectiveProposal.value.proposed ?? undefined
    : undefined;
});
const adjustOpen = ref(false);
const adjustId = ref<string | null>(null);
const adjustComponentKey = ref("loose");
const adjustNew = ref<number | undefined>(undefined);
const adjustReason = ref("");
const adjustProduct = computed(() => productsStore.list.find((p) => p.id === adjustId.value));
const adjustPackageUnits = computed(() => adjustProduct.value ? unitsForProduct(adjustProduct.value).filter((unit) => unit.stock_kind === "package" && !unit.archived) : []);
const adjustComponentOptions = computed(() => [
  { label: `${adjustProduct.value?.inventory_mode === "independent" ? "عبوات مفردة" : "كمية مفتوحة"} · ${adjustProduct.value?.base_unit_name || "الوحدة الأساسية"}`, value: "loose" },
  ...adjustPackageUnits.value.map((unit) => ({ label: `عبوات مغلقة · ${unit.name}`, value: `package:${unit.id}` })),
]);
const adjustBucket = computed(() => adjustComponentKey.value === "loose" ? "loose" : "package");
const adjustUnitId = computed(() => adjustComponentKey.value.startsWith("package:") ? adjustComponentKey.value.slice("package:".length) : null);
const adjustComponentLabel = computed(() => adjustComponentOptions.value.find((option) => option.value === adjustComponentKey.value)?.label || "مكوّن المخزون");
const adjustName = computed(
  () => adjustProduct.value?.name ?? "",
);
const adjustCount = computed(() => {
  const inventory = adjustProduct.value?.inventory;
  if (!inventory) return null;
  return adjustBucket.value === "loose"
    ? round4(toNum(inventory.loose_base_quantity))
    : toNum(inventory.closed_packages[adjustUnitId.value || ""]);
});
const adjustCountText = computed(() => adjustCount.value === null ? "غير مُدخل" : `${adjustCount.value} · ${adjustComponentLabel.value}`);
function openPurchase(id?: string): void {
  if (!id) return;
  const p = productsStore.list.find((x) => x.id === id);
  purchaseId.value = id;
  purchaseQty.value = undefined;
  const purchaseOptions = p ? purchasableUnitsForProduct(p) : [];
  const baseUnit =
    purchaseOptions.find((unit) => unit.is_base) ?? purchaseOptions[0];
  purchaseCost.value =
    (p && baseUnit ? unitPurchasePrice(p, baseUnit) : null) ??
    p?.cost_price ??
    undefined;
  purchaseUnitId.value = baseUnit?.id ?? "";
  purchasePriceEnabled.value = false;
  purchasePrice.value = undefined;
  purchasePriceTouched.value = false;
  purchasePaid.value = undefined;
  purchasePaidTouched.value = false;
  purchaseSupplier.value = undefined;
  purchaseSupplierRef.value = "";
  purchaseNote.value = "";
  stockSubmitError.value = "";
  purchaseKey.value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  void cashbox.fetchCashbox();
  void suppliersStore.fetchSuppliers();
  purchaseOpen.value = true;
}
function openAdjust(id?: string): void {
  if (!id) return;
  adjustId.value = id;
  adjustComponentKey.value = "loose";
  adjustNew.value = undefined;
  adjustReason.value = "";
  stockSubmitError.value = "";
  adjustOpen.value = true;
}
async function doPurchase(): Promise<void> {
  stockSubmitError.value = "";
  if (!purchaseId.value) return;
  if (
    purchaseQtyError.value ||
    purchaseCostError.value ||
    purchasePriceError.value ||
    purchasePaidError.value
  )
    return;
  if (purchaseQty.value === undefined || purchaseCost.value === undefined) {
    stockSubmitError.value = "أدخل الكمية وسعر التكلفة أولاً.";
    return;
  }
  if (!purchaseUnit.value || !(Number(purchaseUnit.value.factor) > 0)) {
    stockSubmitError.value = "وحدة الشراء أو معاملها غير صالح.";
    return;
  }
  const basis = {
    stock: round4(toNum(purchaseProduct.value?.stock_quantity)),
    cost: purchaseProduct.value?.cost_price == null ? 0 : round4(toNum(purchaseCurrentCost.value)),
  };
  let pricing: PriceDecision;
  if (priceFieldShown.value) {
    const proposal = effectiveProposal.value;
    if (purchasePrice.value === undefined) {
      stockSubmitError.value =
        proposal.proposed === null
          ? "أدخل سعر البيع يدويًا (لا يوجد هامش سابق)."
          : "أدخل سعر البيع الجديد أولاً.";
      return;
    }
    pricing = { mode: "custom", price: purchasePrice.value, approvedProposed: proposal.proposed, averageBasis: basis };
  } else {
    pricing = { mode: "auto", averageBasis: basis };
  }
  if (purchasePaid.value !== undefined && purchasePaid.value !== null) {
    const t = round2(
      round2((purchaseQty.value ?? 0) * (purchaseCost.value ?? 0)),
    );
    if (purchasePaid.value - t > 1e-9 && !purchaseSupplier.value?.id) {
      stockSubmitError.value = "اختر المورد لتسجيل الزيادة كسلفة.";
      return;
    }
  }
  stockBusy.value = true;
  try {
    const res = await inventory.purchaseStock({
      product_id: purchaseId.value,
      quantity: purchaseQty.value ?? 0,
      unit_cost: purchaseCost.value ?? 0,
      unit_id: purchaseUnit.value?.id,
      unit_name: purchaseUnit.value?.name,
      unit_factor: purchaseUnit.value.factor,
      pricing,
      paidNow: purchasePaid.value ?? undefined,
      supplier_id: purchaseSupplier.value?.id ?? null,
      supplier_name: purchaseSupplier.value?.name ?? null,
      supplier_ref: purchaseSupplierRef.value.trim() || null,
      idempotencyKey:
        purchaseKey.value || `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      note: purchaseNote.value.trim() || null,
    });
    if (!res.ok) {
      stockSubmitError.value = res.error ?? "تعذر تسجيل الشراء.";
      if ("stale" in res && res.stale) {
        await productsStore.fetchProducts();
        syncPurchaseSuggestions();
        stockSubmitError.value =
          "تغيّرت بيانات المنتج أثناء الحفظ — أُعيد حساب المقترح، راجع القيم ثم أكد مجددًا.";
      }
      return;
    }
    if (res.remaining !== undefined && res.remaining > 0) {
      notifyToast(
        `تم تسجيل فاتورة شراء بباقٍ مستحق ${formatePrice(res.remaining)} ج.`,
        "success",
      );
    } else {
      notifyToast(
        "تم تسجيل عملية الشراء مدفوعة بالكامل وخصم قيمتها من الخزنة.",
        "success",
      );
    }
    purchaseOpen.value = false;
  } finally {
    stockBusy.value = false;
  }
}
async function doAdjust(): Promise<void> {
  stockSubmitError.value = "";
  if (!adjustId.value) return;
  if (adjustBucket.value === "package" && !adjustUnitId.value) {
    stockSubmitError.value = "حدد العبوة المغلقة أولًا.";
    return;
  }
  if (adjustNewError.value) return;
  if (adjustNew.value === undefined) {
    stockSubmitError.value = "أدخل الكمية الجديدة أولاً.";
    return;
  }
  stockBusy.value = true;
  try {
    const res = await inventory.adjustStock({
      product_id: adjustId.value,
      bucket: adjustBucket.value,
      unit_id: adjustUnitId.value,
      new_quantity: adjustNew.value ?? -1,
      note: adjustReason.value,
    });
    if (!res.ok) {
      stockSubmitError.value = res.error;
      return;
    }
    notifyToast("تم تعديل المخزون بنجاح.", "success");
    adjustOpen.value = false;
  } finally {
    stockBusy.value = false;
  }
}
const clearConfirm = ref(false);
const bulkDeleteOpen = ref(false);
const bulkBusy = ref(false);
async function runBulkArchive(): Promise<void> {
  const ids = [...selectProducts.value];
  if (!ids.length || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      const res = await productsStore.archiveProduct(id);
      if (res.ok) ok++;
      else failed++;
    }
    selectProducts.value = [];
    bulkDeleteOpen.value = false;
    await loadProds();
    if (failed > 0)
      notifyToast(`تمت أرشفة ${ok} منتج، وفشل ${failed}.`, "error");
    else
      notifyToast(`تمت أرشفة ${ok} منتج مع حفظ سجلها المحاسبي.`, "success");
  } finally {
    bulkBusy.value = false;
  }
}
async function bulkArchiveConfirmed(): Promise<void> {
  await runBulkArchive();
}
interface ProductRow {
  ids?: string[];
  id?: string;
  name: string;
}
const confirmDelete = ref<ProductRow | null>(null);
const deleteOpen = computed({
  get: () => confirmDelete.value !== null,
  set: (v: boolean) => {
    if (!v) confirmDelete.value = null;
  },
});
const deleteTarget = computed(() =>
  productsStore.list.find((p) => p.id === confirmDelete.value?.id),
);
async function loadProds(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    await productsStore.fetchProducts();
  } catch {
    loadError.value = "تعذر تحميل المنتجات. حاول مرة أخرى.";
  } finally {
    loading.value = false;
  }
}
async function retryProducts(): Promise<void> {
  productsStore.stopInventorySubscription();
  if (isAdmin.value) productsStore.ensureInventorySubscription();
  loading.value = true;
  loadError.value = "";
  try {
    await productsStore.fetchProducts(undefined, true);
  } catch {
    loadError.value = "تعذر تحميل المنتجات. حاول مرة أخرى.";
  } finally {
    loading.value = false;
  }
}
async function archiveConfirmed(): Promise<void> {
  const id = confirmDelete.value?.id;
  if (!id) return;
  deleting.value = true;
  try {
    const res = await productsStore.archiveProduct(id, confirmDelete.value?.ids || [id]);
    if (!res.ok) {
      notifyToast(res.error, "error");
      return;
    }
    notifyToast("تمت أرشفة المنتج مع حفظ سجله المحاسبي.", "success");
    await loadProds();
  } finally {
    deleting.value = false;
    confirmDelete.value = null;
  }
}
function createInvoiceFromSelectedProducts(): void {
  const products = selectProducts.value.flatMap((id) => {
    const product = productsStore.list.find((prod) => prod.id === id);
    if (!product) return [];
    const base = (product.units ?? []).find((u) => u.is_base) ?? (product.units ?? [])[0];
    return [
      {
        product_name: product.name,
        product_price: Number(base?.selling_price ?? 0),
        product_cost_price: Number(product.cost_price ?? 0),
        product_quantity: 1,
        total: 0,
        option: "",
        product_id: product.id,
      },
    ];
  });
  invoiceStore.invoiceToEdit = {
    customer_name: null,
    customer_phone: null,
    debt: null,
    delivery_price: null,
    discount_percentage: false,
    discount: null,
    discount_for: null,
    amount_of_animal_feeds: null,
    amount_of_mahros: null,
    products,
  } as Invoice;
  void navigateTo("/");
}
onMounted(async () => {
  hydrated.value = true;
  const authed = await useAuthReady();
  if (!authed) {
    loading.value = false;
    return; // layout redirects to /login
  }
  if (isAdmin.value) productsStore.ensureInventorySubscription();
  await loadProds();
});
</script>
