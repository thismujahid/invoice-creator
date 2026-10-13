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
            icon="i-lucide-trash-2"
            color="error"
            variant="soft"
            @click="bulkDeleteOpen = true"
            >حذف المحدد ({{ selectProducts.length }})</UButton
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
      <!-- Desktop table -->
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th v-if="isAdmin" class="w-10 p-2"></th>
              <th class="p-2 text-start font-medium">الاسم</th>
              <th class="p-2 text-start font-medium">الكمية المتاحة</th>
              <th class="p-2 text-start font-medium">أسعار البيع</th>
              <th v-if="isAdmin" class="p-2 text-start font-medium">الأدوات</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in paginateArray"
              :key="p.id"
              class="border-b border-gray-100 last:border-0 hover:bg-gray-50"
              :class="p.id && isSelected({ id: p.id }) ? 'bg-emerald-50' : ''"
              @click="isAdmin && p.id && toggleSelect({ id: p.id })"
            >
              <td v-if="isAdmin" class="p-2" @click.stop>
                <UCheckbox
                  :model-value="p.id ? isSelected({ id: p.id }) : false"
                  @update:model-value="p.id && toggleSelect({ id: p.id })"
                />
              </td>
              <td class="p-2 font-medium">{{ p.name }}</td>
              <td
                class="p-2 font-semibold"
                :class="p.stock === null ? 'text-gray-400' : ''"
              >
                {{ p.stock_label }}
              </td>
              <td class="p-2">
                <div class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="unit in p.selling_units"
                    :key="unit.id"
                    color="neutral"
                    variant="soft"
                    >{{ unit.name }}: {{ unit.price }}</UBadge
                  >
                </div>
              </td>
              <td v-if="isAdmin" class="p-2" @click.stop>
                <div class="flex gap-2">
                  <UButton
                    icon="i-lucide-pencil"
                    color="success"
                    variant="soft"
                    size="xs"
                    aria-label="تعديل"
                    @click="editProduct({ id: p.id })"
                    class="flex items-center justify-center"
                  />
                  <UTooltip text="شراء / إضافة مخزون">
                    <UButton
                      icon="i-lucide-package-plus"
                      color="info"
                      variant="soft"
                      size="xs"
                      aria-label="شراء مخزون"
                      @click="openPurchase(p.id)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UTooltip text="تعديل مخزون يدوي">
                    <UButton
                      icon="i-lucide-clipboard-list"
                      color="neutral"
                      variant="soft"
                      size="xs"
                      aria-label="تعديل المخزون"
                      @click="openAdjust(p.id)"
                      class="flex items-center justify-center"
                  /></UTooltip>
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="soft"
                    size="xs"
                    aria-label="حذف"
                    @click="confirmDelete = p"
                    class="flex items-center justify-center"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-layout-grid"
          title="لا توجد منتجات حتى الأن"
        />
      </div>
      <!-- Mobile cards -->
      <div class="grid gap-2 md:hidden">
        <UCard
          v-for="p in paginateArray"
          :key="p.id"
          variant="outline"
          :class="p.id && isSelected({ id: p.id }) ? 'border-emerald-500!' : ''"
          @click="isAdmin && p.id && toggleSelect({ id: p.id })"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <UCheckbox
                v-if="isAdmin"
                :model-value="p.id ? isSelected({ id: p.id }) : false"
                @click.stop
                @update:model-value="p.id && toggleSelect({ id: p.id })"
              />
              <div class="min-w-0">
                <div class="truncate font-bold">{{ p.name }}</div>
                <div
                  class="text-xs"
                  :class="p.stock === null ? 'text-gray-400' : 'text-gray-500'"
                >
                  {{ p.stock_label }}
                </div>
                <div class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="unit in p.selling_units"
                    :key="unit.id"
                    color="neutral"
                    variant="soft"
                    >{{ unit.name }}: {{ unit.price }}</UBadge
                  >
                </div>
              </div>
            </div>
            <div v-if="isAdmin" class="flex shrink-0 gap-1.5" @click.stop>
              <UButton
                icon="i-lucide-pencil"
                color="success"
                variant="soft"
                size="xs"
                aria-label="تعديل"
                @click="editProduct({ id: p.id })"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-package-plus"
                color="info"
                variant="soft"
                size="xs"
                aria-label="شراء مخزون"
                @click="openPurchase(p.id)"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-clipboard-list"
                color="neutral"
                variant="soft"
                size="xs"
                aria-label="تعديل المخزون"
                @click="openAdjust(p.id)"
                class="flex items-center justify-center"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="soft"
                size="xs"
                aria-label="حذف"
                @click="confirmDelete = p"
                class="flex items-center justify-center"
              />
            </div>
          </div>
        </UCard>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-layout-grid"
          title="لا توجد منتجات حتى الأن"
        />
      </div>
    </template>
    <div class="mt-3 flex items-center justify-between gap-2">
      <USelect
        v-model="currentPerPage"
        :items="[10, 25, 50, 100, 150]"
        size="sm"
        class="w-24"
      />
      <UPagination
        v-model:page="currentPage"
        :total="prodsList.length"
        :items-per-page="currentPerPage"
        :sibling-count="1"
        size="sm"
      />
    </div>
    <UiAppDialog v-model:open="deleteOpen" title="أرشفة / حذف المنتج">
      <p class="mb-2 text-gray-600">
        {{ confirmDelete?.name }} — الأرشفة تحفظ السجل المحاسبي (مفضلة للمنتجات
        ذات الفواتير/الحركات).
      </p>
      <p v-if="deleteStock > 0" class="mb-4 text-xs text-gray-500">
        المخزون المتبقي:
        {{ deleteTarget ? stockQuantityLabel(deleteTarget) : "—" }} — الحذف لا
        ينشئ نقدًا؛ إرجاع المورد عملية مالية مستقلة.
      </p>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton
            color="warning"
            block
            :loading="deleting"
            @click="archiveConfirmed"
            >أرشفة (موصى به)</UButton
          >
          <UButton
            color="error"
            variant="soft"
            block
            :loading="deleting"
            @click="deleteConfirmed"
            >حذف نهائي</UButton
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
    <UiAppDialog v-model:open="bulkDeleteOpen" title="أرشفة / حذف المنتجات المحددة">
      <p class="mb-2 text-gray-600">
        سيتم تطبيق الإجراء على {{ selectProducts.length }} منتج محدد —
        الأرشفة تحفظ السجل المحاسبي (موصى به للمنتجات ذات الفواتير/الحركات)،
        والحذف النهائي لا ينشئ نقدًا.
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
            >أرشفة المحدد (موصى به)</UButton
          >
          <UButton
            color="error"
            variant="soft"
            block
            :loading="bulkBusy"
            @click="bulkDeleteConfirmed"
            >حذف نهائي للمحدد</UButton
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
            :min="1"
            :step="1"
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
        <div
          v-if="costCardShown"
          class="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3"
        >
          <UFormField
            label="متوسط التكلفة الجديد"
            :hint="`سعر التكلفة القديم: ${formatePrice(purchaseOldUnitAvg)} ج`"
            :error="purchaseAvgError || undefined"
          >
            <UInputNumber
              v-model="purchaseAvg"
              :min="0"
              :step="0.01"
              size="lg"
              class="w-full"
            />
          </UFormField>
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
        <UFormField label="الكمية الحالية">
          <UInput
            :model-value="adjustCountText"
            readonly
            size="lg"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="الكمية الجديدة"
          required
          :error="adjustNewError || undefined"
        >
          <UInputNumber
            v-model="adjustNew"
            :min="0"
            :step="1"
            size="lg"
            class="w-full"
          />
        </UFormField>
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
  proposedSellingPrice,
  sellableUnitsForProduct,
  unitSellingPrice,
  purchasableUnitsForProduct,
  convertUnitPrice,
  unitPurchasePrice,
  purchaseLineBaseQuantity,
  purchaseLineBaseCost,
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
  const product = prodsList.value.find((item) => item.id === purchaseId.value);
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
  const currentFactor =
    Number(currentUnit?.factor) > 0 ? Number(currentUnit?.factor) : 1;
  purchaseUnitId.value = unit.id;
  const product = prodsList.value.find((item) => item.id === purchaseId.value);
  // سعر الشراء يتبع الوحدة المختارة نفسها (آخر سعر شراء مسجل عليها)，
  // وليس تحويلاً من المتوسط الحالي.
  const unitLastCost = product ? unitPurchasePrice(product, unit) : null;
  if (unitLastCost !== null && unitLastCost !== undefined) {
    purchaseCost.value = unitLastCost;
    return;
  }
  purchaseCost.value = convertUnitPrice(
    purchaseCost.value ?? purchaseCurrentCost.value,
    currentFactor,
    unit.factor,
  );
}
const purchasePrice = ref<number | undefined>(undefined);
const purchasePriceTouched = ref(false);
// Editable middle average, in the selected purchase unit's terms (the saved
// average stays in base terms). Synced from the suggestion while qty/cost/
// unit change; free for the user to override afterwards.
const purchaseAvg = ref<number | undefined>(undefined);
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
  () => prodsList.value.find((p) => p.id === purchaseId.value)?.name ?? "",
);
const purchaseCount = computed(
  () =>
    prodsList.value.find((p) => p.id === purchaseId.value)?.stock_quantity ??
    null,
);
const purchaseCountText = computed(() =>
  stockQuantityLabel(
    prodsList.value.find((p) => p.id === purchaseId.value) ?? {
      name: "",
      price: null,
      cost_price: null,
    },
    purchaseCount.value,
  ),
);
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
const paginateArray = computed(() => {
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  return [...prodsList.value]
    .sort(
      (a, b) =>
        (toDateSafe(b.date)?.getTime() ?? 0) -
        (toDateSafe(a.date)?.getTime() ?? 0),
    )
    .slice(startIndex, startIndex + currentPerPage.value)
    .map((prod) => {
      const sellingUnits = sellableUnitsForProduct(prod).map((unit) => ({
        id: unit.id,
        name: unit.name,
        price:
          unit.selling_price == null &&
          !unit.is_base &&
          unit.id !== prod.base_unit_id
            ? "غير محدد"
            : unitSellingPrice(prod, unit) == null
              ? "غير محدد"
              : `${formatePrice(unitSellingPrice(prod, unit))} ج`,
      }));
      return {
        id: prod.id,
        select: false,
        name: prod.name,
        selling_units: sellingUnits,
        stock: prod.stock_quantity ?? null,
        stock_label: stockQuantityLabel(prod),
      };
    });
});
function isSelected(item: { id?: string }): boolean {
  return !!item.id && selectProducts.value.includes(item.id);
}
function toggleSelect(item: { id?: string }): void {
  if (!item.id) return;
  const index = selectProducts.value.indexOf(item.id);
  if (index > -1) selectProducts.value.splice(index, 1);
  else selectProducts.value.push(item.id);
}
/** Select every product matching the current search (across all pages). */
function selectAllFiltered(): void {
  selectProducts.value = prodsList.value
    .map((p) => p.id)
    .filter((id): id is string => !!id);
}
const bulkSelectedProducts = computed(() => {
  const selected = new Set(selectProducts.value);
  return prodsList.value.filter((p) => p.id && selected.has(p.id));
});
function editProduct(product: { id?: string }): void {
  const prod = prodsList.value.find((el) => el.id === product.id);
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
  if (!Number.isInteger(purchaseQty.value))
    return "الكمية يجب أن تكون رقمًا صحيحًا.";
  return "";
});
const purchaseCostError = computed(() => {
  if (purchaseCost.value === undefined || purchaseCost.value === null)
    return "";
  return purchaseCost.value >= 0 ? "" : "سعر التكلفة غير صالح.";
});
const purchasePriceError = computed(() => {
  if (purchasePrice.value === undefined || purchasePrice.value === null)
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
  if (!(adjustNew.value >= 0)) return "الكمية الجديدة غير صالحة.";
  if (!Number.isInteger(adjustNew.value))
    return "الكمية يجب أن تكون رقمًا صحيحًا.";
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
const purchaseProduct = computed(() =>
  prodsList.value.find((p) => p.id === purchaseId.value),
);
const purchaseCurrentCost = computed(() =>
  toNum(purchaseProduct.value?.cost_price),
);
const purchaseBaseQty = computed(() =>
  purchaseLineBaseQuantity(
    purchaseQty.value ?? 0,
    purchaseUnit.value?.factor ?? 1,
  ),
);
const purchaseBaseCost = computed(() =>
  purchaseLineBaseCost(
    purchaseCost.value ?? 0,
    purchaseUnit.value?.factor ?? 1,
  ),
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
// Factor of the selected purchase unit (all card money is shown in its terms).
const purchaseFactor = computed(() => purchaseUnit.value?.factor ?? 1);
const purchaseHasHistory = computed(
  () => toNum(purchaseProduct.value?.stock_quantity) > 0,
);
const purchaseHasRecordedAvg = computed(() => purchaseCurrentCost.value > 0);
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
  if (!purchaseInputsReady.value) return purchasePreviewAvg.value;
  if (purchaseHasHistory.value) return purchasePreviewAvg.value;
  if (
    purchaseHasRecordedAvg.value &&
    Math.abs(purchaseBaseCost.value - purchaseCurrentCost.value) > 1e-9
  )
    return round4((purchaseCurrentCost.value + purchaseBaseCost.value) / 2);
  return purchasePreviewAvg.value;
});
const suggestedAvgUnit = computed(() =>
  round4(suggestedAvgBase.value * purchaseFactor.value),
);
// True when the entered cost actually moves the average.
const blendingCase = computed(
  () =>
    purchaseInputsReady.value &&
    Math.abs(purchaseBaseCost.value - purchaseCurrentCost.value) > 1e-9 &&
    (purchaseHasHistory.value || purchaseHasRecordedAvg.value),
);
// Effective average the save will use (user-edited when blending, else the
// system value). The selling-price suggestion preserves the selected unit's
// own margin over THIS value — up or down.
const effectiveAvgUnit = computed(() =>
  blendingCase.value &&
  purchaseAvg.value !== undefined &&
  purchaseAvg.value !== null
    ? toNum(purchaseAvg.value)
    : suggestedAvgUnit.value,
);
const effectiveProposal = computed(() => {
  if (purchaseUnitOldPrice.value === null)
    return { rate: null, proposed: null };
  return proposedSellingPrice(
    purchaseOldUnitAvg.value,
    purchaseUnitOldPrice.value,
    effectiveAvgUnit.value,
  );
});
const priceOnlyCase = computed(
  () =>
    purchaseInputsReady.value &&
    !blendingCase.value &&
    purchaseUnitSellable.value &&
    suggestedAvgUnit.value - (purchaseUnitOldPrice.value ?? 0) > 1e-9,
);
const costCardShown = computed(() => blendingCase.value || priceOnlyCase.value);
const priceFieldShown = computed(
  () => costCardShown.value && purchaseUnitSellable.value,
);
// Default selling price for the selected unit: new average + old margin;
// never-priced unit starts from the average itself; otherwise keep old price.
function defaultUnitPrice(avgUnit: number): number | undefined {
  const old = purchaseUnitOldPrice.value;
  if (old === null) return round2(avgUnit);
  const { rate, proposed } = proposedSellingPrice(
    purchaseOldUnitAvg.value,
    old,
    avgUnit,
  );
  return rate !== null && proposed !== null ? proposed : old;
}
const purchaseAvgError = computed(() => {
  if (!costCardShown.value) return "";
  if (purchaseAvg.value === undefined || purchaseAvg.value === null) return "";
  return purchaseAvg.value >= 0 ? "" : "متوسط التكلفة غير صالح.";
});

// Suggestion sync: while qty/cost/unit/product change, refill both editable
// fields from the system suggestion; manual edits persist until then.
function syncPurchaseSuggestions(): void {
  purchaseAvg.value = purchaseInputsReady.value
    ? suggestedAvgUnit.value
    : undefined;
  purchasePriceTouched.value = false;
  purchasePrice.value =
    costCardShown.value && purchaseUnitSellable.value
      ? defaultUnitPrice(suggestedAvgUnit.value)
      : undefined;
}
watch([purchaseQty, purchaseCost, purchaseUnitId, purchaseId], () => {
  syncPurchaseSuggestions();
});
// Editing the average re-derives the price suggestion (unless the user already
// typed a price manually).
watch(purchaseAvg, () => {
  if (purchasePriceTouched.value) return;
  if (!priceFieldShown.value) return;
  purchasePrice.value = defaultUnitPrice(effectiveAvgUnit.value);
});
const adjustOpen = ref(false);
const adjustId = ref<string | null>(null);
const adjustNew = ref<number | undefined>(undefined);
const adjustReason = ref("");
const adjustName = computed(
  () => prodsList.value.find((p) => p.id === adjustId.value)?.name ?? "",
);
const adjustCount = computed(
  () =>
    prodsList.value.find((p) => p.id === adjustId.value)?.stock_quantity ??
    null,
);
const adjustCountText = computed(() =>
  stockQuantityLabel(
    prodsList.value.find((p) => p.id === adjustId.value) ?? {
      name: "",
      price: null,
      cost_price: null,
    },
    adjustCount.value,
  ),
);
function openPurchase(id?: string): void {
  if (!id) return;
  const p = prodsList.value.find((x) => x.id === id);
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
  purchaseAvg.value = undefined;
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
    purchaseAvgError.value ||
    purchasePriceError.value ||
    purchasePaidError.value
  )
    return;
  if (purchaseQty.value === undefined || purchaseCost.value === undefined) {
    stockSubmitError.value = "أدخل الكمية وسعر التكلفة أولاً.";
    return;
  }
  // Single visible average (selected-unit terms) + the snapshot it rests on;
  // the transaction re-checks the snapshot before saving the approved value,
  // and touches ONLY the purchased unit's selling price.
  const card = costCardShown.value;
  const showPrice = priceFieldShown.value;
  const basis = {
    stock: round2(toNum(purchaseProduct.value?.stock_quantity)),
    cost: round4(toNum(purchaseCurrentCost.value)),
  };
  let pricing: PriceDecision;
  if (!card) {
    pricing = { mode: "keep" };
  } else {
    if (purchaseAvg.value === undefined) {
      stockSubmitError.value = "أدخل متوسط التكلفة الجديد أولاً.";
      return;
    }
    const proposal = effectiveProposal.value;
    if (showPrice && purchasePrice.value === undefined) {
      stockSubmitError.value =
        proposal.price === null
          ? "أدخل سعر البيع يدويًا (لا يوجد هامش سابق)."
          : "أدخل سعر البيع الجديد أولاً.";
      return;
    }
    const avgBase = round4(toNum(purchaseAvg.value) / purchaseFactor.value);
    pricing = showPrice
      ? {
          mode: "custom" as const,
          price: purchasePrice.value ?? 0,
          approvedProposed: proposal.price,
          approvedAverage: avgBase,
          averageBasis: basis,
          singleUnit: true,
        }
      : {
          mode: "keep",
          approvedAverage: avgBase,
          averageBasis: basis,
          singleUnit: true,
        };
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
      unit_factor: purchaseUnit.value?.factor ?? 1,
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
  if (adjustNewError.value) return;
  if (adjustNew.value === undefined) {
    stockSubmitError.value = "أدخل الكمية الجديدة أولاً.";
    return;
  }
  stockBusy.value = true;
  try {
    const res = await inventory.adjustStock({
      product_id: adjustId.value,
      new_stock_quantity: adjustNew.value ?? -1,
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
async function runBulkDelete(mode: "archive" | "delete"): Promise<void> {
  const ids = [...selectProducts.value];
  if (!ids.length || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      if (mode === "archive") {
        const res = await productsStore.archiveProduct(id);
        if (res.ok) ok++;
        else failed++;
      } else {
        // No cash is ever created by deletion; supplier returns are separate.
        if (await productsStore.deleteProduct(id)) ok++;
        else failed++;
      }
    }
    selectProducts.value = [];
    bulkDeleteOpen.value = false;
    await loadProds();
    const action = mode === "archive" ? "أرشفة" : "حذف";
    if (failed > 0)
      notifyToast(`تم ${action} ${ok} منتج، وفشل ${failed}.`, "error");
    else if (mode === "archive")
      notifyToast(`تمت أرشفة ${ok} منتج مع حفظ سجلها المحاسبي.`, "success");
    else notifyToast(`تم حذف ${ok} منتج نهائيًا (بدون أثر نقدي).`, "success");
  } finally {
    bulkBusy.value = false;
  }
}
async function bulkArchiveConfirmed(): Promise<void> {
  await runBulkDelete("archive");
}
async function bulkDeleteConfirmed(): Promise<void> {
  await runBulkDelete("delete");
}
interface ProductRow {
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
  prodsList.value.find((p) => p.id === confirmDelete.value?.id),
);
const deleteStock = computed(() => toNum(deleteTarget.value?.stock_quantity));
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
    const res = await productsStore.archiveProduct(id);
    if (!res.ok) {
      stockSubmitError.value = res.error;
      return;
    }
    notifyToast("تمت أرشفة المنتج مع حفظ سجله المحاسبي.", "success");
    await loadProds();
  } finally {
    deleting.value = false;
    confirmDelete.value = null;
  }
}
async function deleteConfirmed(): Promise<void> {
  const id = confirmDelete.value?.id;
  if (!id) return;
  deleting.value = true;
  try {
    // No cash is ever created by deletion; supplier returns are separate.
    await productsStore.deleteProduct(id);
    notifyToast("تم حذف المنتج نهائيًا (بدون أثر نقدي).", "success");
    await loadProds();
  } finally {
    deleting.value = false;
    confirmDelete.value = null;
  }
}
function createInvoiceFromSelectedProducts(): void {
  const products = selectProducts.value.flatMap((id) => {
    const product = prodsList.value.find((prod) => prod.id === id);
    if (!product) return [];
    return [
      {
        product_name: product.name,
        product_price: Number(product.price ?? 0),
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
