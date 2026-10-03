<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">المنتجات</h2>
      <div class="flex flex-wrap items-center gap-2">
        <UButton
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
          >المنتجات قليلة الكمية ({{ lowStockCount }})</UButton
        >
        <!-- HOME delta: no products export (as in home branch). -->
        <FormsProduct
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
    <ProductsLowStockDialog
      v-model:open="shortagesOpen"
      :products="productsStore.list"
      :show-cost="true"
    />
    <ProductsPurchaseImportDialog
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
      <div v-if="selectProducts.length > 0" class="flex flex-wrap gap-2">
        <UButton
          icon="i-lucide-file-plus"
          color="success"
          @click="createInvoiceFromSelectedProducts"
          >إنشاء فاتورة بالمنتجات المحددة ({{ selectProducts.length }})</UButton
        >
        <UButton
          icon="i-lucide-x"
          color="error"
          variant="soft"
          @click="clearConfirm = true"
          >إلغاء تحديد الكل</UButton
        >
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
    <UiAppTableSkeleton v-if="loading" />
    <template v-else>
      <!-- Desktop table -->
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th class="w-10 p-2"></th>
              <th class="p-2 text-start font-medium">الاسم</th>
              <th class="p-2 text-start font-medium">سعر البيع</th>
              <th class="p-2 text-start font-medium">
                متوسط التكلفة
              </th>
              <th class="p-2 text-start font-medium">العدد</th>
              <th class="p-2 text-start font-medium">المخزون (أساسية)</th>
              <th class="p-2 text-start font-medium">الأدوات</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in paginateArray"
              :key="p.id"
              class="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50"
              :class="p.id && isSelected({ id: p.id }) ? 'bg-emerald-50' : ''"
              @click="p.id && toggleSelect({ id: p.id })"
            >
              <td class="p-2" @click.stop>
                <UCheckbox
                  :model-value="p.id ? isSelected({ id: p.id }) : false"
                  @update:model-value="p.id && toggleSelect({ id: p.id })"
                />
              </td>
              <td class="p-2 font-medium">{{ p.name }}<div v-if="p.cost_detail" class="text-[11px] font-normal text-gray-400">{{ p.cost_detail }}</div></td>
              <td class="p-2">{{ p.price }}</td>
              <td class="p-2 text-gray-600">
                {{ p.cost_price }}
              </td>
              <td class="p-2">{{ p.count }}</td>
              <td
                class="p-2 font-semibold"
                :class="p.stock === null ? 'text-gray-400' : ''"
              >
                {{ p.stock ?? "—" }} {{ p.base_name }}
              </td>
              <td class="p-2" @click.stop>
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
          :class="p.id && isSelected({ id: p.id }) ? '!border-emerald-500' : ''"
          @click="p.id && toggleSelect({ id: p.id })"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <UCheckbox
                :model-value="p.id ? isSelected({ id: p.id }) : false"
                @click.stop
                @update:model-value="p.id && toggleSelect({ id: p.id })"
              />
              <div class="min-w-0">
                <div class="truncate font-bold">{{ p.name }}</div>
                <div class="text-sm text-gray-500">
                  بيع: {{ p.price }}
                  <span>| {{ p.cost_price }}</span>
                </div>
                <div
                  class="text-xs"
                  :class="p.stock === null ? 'text-gray-400' : 'text-gray-500'"
                >
                  {{ p.stock_label }}
                </div>
              </div>
            </div>
            <div class="flex shrink-0 gap-1.5" @click.stop>
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
        dir="ltr"
        v-model:page="currentPage"
        :total="prodsList.length"
        :items-per-page="currentPerPage"
        :sibling-count="1"
        size="sm"
      />
    </div>
    <UiAppDialog v-model:open="deleteOpen" title="أرشفة / حذف المنتج">
      <p class="mb-2 text-gray-600">
        {{ confirmDelete?.name }} — الأرشفة تحفظ السجل المحاسبي (مفضلة للمنتجات ذات الفواتير/الحركات).
      </p>
      <p v-if="deleteStock > 0" class="mb-4 text-xs text-gray-500">
        المخزون المتبقي: {{ deleteStock }} {{ deleteTarget?.base_unit_name || "وحدة أساسية" }} — الحذف لا ينشئ نقدًا؛ إرجاع المورد عملية مالية مستقلة.
      </p>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton color="warning" block :loading="deleting" @click="archiveConfirmed">أرشفة (موصى به)</UButton>
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
          <USelectMenu :model-value="purchaseUnit" :items="purchaseUnits" label-key="name" by="id" :search-input="false" class="w-full" @update:model-value="(unit) => selectPurchaseUnit(unit)" />
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
        <div class="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <div class="flex justify-between">
            <span>إجمالي الشراء</span
            ><b>{{ formatePrice(purchaseTotal) }} ج</b>
          </div>
          <div class="flex justify-between">
            <span>رصيد الخزنة</span><b>{{ formatePrice(cashBalance) }} ج</b>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span>المدفوع الآن</span>
            <UInputNumber
              :model-value="purchasePaid"
              :min="0"
              :max="Math.min(purchaseTotal, cashBalance)"
              :step="0.01"
              size="sm"
              class="w-40"
              @update:model-value="setPurchasePaid"
            />
          </div>
          <p v-if="purchasePaidError" class="text-xs text-red-600">{{ purchasePaidError }}</p>
          <div class="flex justify-between">
            <span>الباقي المستحق</span
            ><b class="text-amber-700"
              >{{ formatePrice(purchaseTotal - (purchasePaid ?? 0)) }} ج</b
            >
          </div>
        </div>
        <!-- Selling-price policy: shown only when the new average exceeds price -->
        <div
          v-if="pricePolicyApplies"
          class="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
        >
          <p class="text-sm font-bold">
            المتوسط الجديد ({{ formatePrice(purchasePreviewAvg) }}) أعلى من سعر
            البيع الحالي ({{ formatePrice(purchaseCurrentPrice) }})
          </p>
          <div class="grid grid-cols-2 gap-2 text-xs text-gray-600">
            <span
              >سعر البيع القديم: {{ formatePrice(purchaseCurrentPrice) }}</span
            >
            <span
              >متوسط التكلفة القديم:
              {{ formatePrice(purchaseCurrentCost) }}</span
            >
            <span>نسبة الربح القديمة: {{ purchaseMarkupText }}</span>
            <span
              >الفرق:
              {{
                formatePrice(
                  (purchasePreview.proposed ?? 0) - purchaseCurrentPrice,
                )
              }}</span
            >
          </div>
          <div v-if="purchaseProposals.length > 1" class="space-y-1 rounded-lg bg-white/70 p-2 text-xs">
            <div class="font-bold">المقترح لكل وحدة قابلة للبيع:</div>
            <div v-for="p in purchaseProposals" :key="p.unitId" class="flex justify-between gap-2">
              <span>{{ p.unitName }} ×{{ p.factor }}: {{ p.oldPrice === null ? "—" : formatePrice(p.oldPrice) }} → {{ p.proposed === null ? "يدوي" : formatePrice(p.proposed) }} ج</span>
              <span class="text-gray-500">هامش {{ p.rate === null ? "—" : `${Math.round(p.rate * 10000) / 100}%` }}</span>
            </div>
          </div>
          <URadioGroup
            v-model="priceChoice"
            legend="قرار سعر البيع"
            :items="priceChoiceItems"
          />
          <UFormField
            v-if="priceChoice === 'custom'"
            label="سعر بيع مخصص"
            required
            :error="purchasePriceError || undefined"
          >
            <UInputNumber
              v-model="purchasePrice"
              :min="0"
              :step="0.01"
              size="lg"
              class="w-full"
            />
          </UFormField>
          <UFormField
            v-else
            label="السعر المقترح (قابل للتعديل)"
            hint="السعر القديم ظاهر كمرجع أعلاه."
          >
            <UInputNumber
              v-model="purchasePrice"
              :min="0"
              :step="0.01"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <UFormField label="المورد (اختياري)">
            <USelectMenu
              :model-value="(purchaseSupplier ?? null) as Supplier | undefined"
              :items="supplierMenuItems"
              label-key="name"
              by="id"
              placeholder="اختر المورد"
              :search-input="{ placeholder: 'بحث عن مورد...', icon: 'i-lucide-search' }"
              class="w-full"
              @update:model-value="(s) => onPickPurchaseSupplier(s)"
            />
            <FormsSupplier v-model="showSupplierModal" :refresher="reloadPurchaseSuppliers" @done="onPurchaseSupplierCreated" />
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
import { useSuppliersStore } from "~/stores/suppliers";
import { toDateSafe } from "~/types";

definePageMeta({ title: "المنتجات" });
const searchText = ref<string>("");
const { formatePrice } = useHelpers();
const { round2, round4, toNum, movingAverageCost, proposedSellingPrice, isLowStock, unitsForProduct, purchasableUnitsForProduct, convertUnitPrice, unitPurchasePrice, purchaseLineBaseQuantity, purchaseLineBaseCost, purchasePreviewAverage, purchaseUnitProposals } =
  useFinance();
const productFormState = ref(false);
const productsStore = useProductsStore();
const loading = ref(true);
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
const purchaseUnit = computed(() => purchaseUnits.value.find((unit) => unit.id === purchaseUnitId.value) ?? purchaseUnits.value[0]);
function selectPurchaseUnit(unit?: ProductUnit): void {
  if (!unit) return;
  const currentUnit = purchaseUnits.value.find((candidate) => candidate.id === purchaseUnitId.value);
  const currentFactor = Number(currentUnit?.factor) > 0 ? Number(currentUnit?.factor) : 1;
  purchaseUnitId.value = unit.id;
  const product = prodsList.value.find((item) => item.id === purchaseId.value);
  // سعر الشراء يتبع الوحدة المختارة نفسها (آخر سعر شراء مسجل عليها)،
  // وليس تحويلاً من المتوسط الحالي.
  const unitLastCost = product ? unitPurchasePrice(product, unit) : null;
  if (unitLastCost !== null && unitLastCost !== undefined) {
    purchaseCost.value = unitLastCost;
    return;
  }
  purchaseCost.value = convertUnitPrice(purchaseCost.value ?? purchaseCurrentCost.value, currentFactor, unit.factor);
}
const priceChoice = ref<"proposed" | "custom">("proposed");
const purchasePrice = ref<number | undefined>(undefined);
const purchaseApproved = ref<number | null>(null);
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
  purchaseSupplier.value = suppliersStore.list.find((item) => item.id === s.id) ?? s;
}
async function reloadPurchaseSuppliers(): Promise<void> {
  await suppliersStore.fetchSuppliers(true);
}
function onPurchaseSupplierCreated(s: Supplier | null | undefined): void {
  if (s?.id) purchaseSupplier.value = suppliersStore.list.find((item) => item.id === s.id) ?? s;
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
  purchaseCount.value === null ? "غير مُدخل" : String(purchaseCount.value),
);
// Shortages dialog state (dialog content lands in S4).
const shortagesOpen = ref(false);
const importOpen = ref(false);
const lowStockCount = computed(
  () => productsStore.list.filter((p) => isLowStock(p)).length,
);
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
      const baseName = prod.base_unit_name?.trim() || prod.units?.find((u) => u.is_base)?.name || "وحدة";
      const units = unitsForProduct(prod);
      const derived = units
        .filter((u) => !u.is_base && u.id !== prod.base_unit_id)
        .slice(0, 3)
        .map((u) => `${u.name} ×${u.factor}: ${formatePrice((prod.cost_price ?? 0) * Number(u.factor || 1))}`)
        .join(" · ");
      return {
        id: prod.id,
        select: false,
        name: prod.name,
        price: `${formatePrice(prod.price)} ج / ${baseName}`,
        cost_price: `متوسط ${formatePrice(prod.cost_price)} ج / ${baseName}`,
        cost_detail: derived,
        count: prod.count,
        stock: prod.stock_quantity ?? null,
        stock_label: `المخزون: ${prod.stock_quantity ?? "غير مُدخل"} ${baseName}`,
        base_name: baseName,
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
  if (!Number.isInteger(purchaseQty.value)) return "الكمية يجب أن تكون رقمًا صحيحًا.";
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
  if (purchasePaid.value - purchaseTotal.value > 1e-9)
    return "المدفوع لا يجوز أن يتجاوز الإجمالي.";
  if (purchasePaid.value - cashBalance.value > 1e-9)
    return "المدفوع يتجاوز رصيد الخزنة المتاح.";
  return "";
});
const adjustNewError = computed(() => {
  if (adjustNew.value === undefined || adjustNew.value === null) return "";
  if (!(adjustNew.value >= 0)) return "الكمية الجديدة غير صالحة.";
  if (!Number.isInteger(adjustNew.value)) return "الكمية يجب أن تكون رقمًا صحيحًا.";
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
const purchaseProduct = computed(() => prodsList.value.find((p) => p.id === purchaseId.value));
const purchaseCurrentCost = computed(() => toNum(purchaseProduct.value?.cost_price));
const purchaseCurrentPrice = computed(() => toNum(purchaseProduct.value?.price));
const purchaseBaseQty = computed(() => purchaseLineBaseQuantity(purchaseQty.value ?? 0, purchaseUnit.value?.factor ?? 1));
const purchaseBaseCost = computed(() => purchaseLineBaseCost(purchaseCost.value ?? 0, purchaseUnit.value?.factor ?? 1));
const purchasePreviewAvg = computed(() =>
  round4(purchasePreviewAverage(purchaseProduct.value?.stock_quantity, purchaseCurrentCost.value, purchaseBaseQty.value, purchaseBaseCost.value)),
);
const purchaseProposals = computed(() =>
  purchaseProduct.value ? purchaseUnitProposals(purchaseProduct.value, purchasePreviewAvg.value) : [],
);
const purchasePreview = computed(() =>
  proposedSellingPrice(
    purchaseCurrentCost.value,
    purchaseCurrentPrice.value,
    purchasePreviewAvg.value,
  ),
);
const pricePolicyApplies = computed(
  () =>
    purchasePreviewAvg.value - purchaseCurrentPrice.value > 1e-9 &&
    purchaseQty.value !== undefined &&
    purchaseCost.value !== undefined,
);
const purchaseMarkupText = computed(() =>
  purchasePreview.value.rate === null
    ? "لا توجد"
    : `${round2(purchasePreview.value.rate * 100)}%`,
);
const priceChoiceItems: { label: string; value: "proposed" | "custom" }[] = [
  { label: "اعتماد السعر المقترح", value: "proposed" },
  { label: "سعر مخصص", value: "custom" },
];

watch([purchaseQty, purchaseCost], () => {
  if (priceChoice.value === "proposed")
    purchasePrice.value = purchasePreview.value.proposed ?? undefined;
});
watch(priceChoice, (choice) => {
  if (choice === "proposed")
    purchasePrice.value = purchasePreview.value.proposed ?? undefined;
});
watch([purchaseCurrentCost, purchaseCurrentPrice, purchasePreviewAvg], () => {
  if (priceChoice.value === "proposed")
    purchasePrice.value = purchasePreview.value.proposed ?? undefined;
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
  adjustCount.value === null ? "غير مُدخل" : String(adjustCount.value),
);
function openPurchase(id?: string): void {
  if (!id) return;
  const p = prodsList.value.find((x) => x.id === id);
  purchaseId.value = id;
  purchaseQty.value = undefined;
  const purchaseOptions = p ? purchasableUnitsForProduct(p) : [];
  const baseUnit = purchaseOptions.find((unit) => unit.is_base) ?? purchaseOptions[0];
  purchaseCost.value = (p && baseUnit ? unitPurchasePrice(p, baseUnit) : null) ?? p?.cost_price ?? undefined;
  purchaseUnitId.value = baseUnit?.id ?? "";
  priceChoice.value = "proposed";
  purchasePrice.value = undefined;
  purchaseApproved.value = null;
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
    purchasePriceError.value ||
    purchasePaidError.value
  )
    return;
  if (purchaseQty.value === undefined || purchaseCost.value === undefined) {
    stockSubmitError.value = "أدخل الكمية وسعر التكلفة أولاً.";
    return;
  }
  // Snapshot the approved proposed price for the concurrency check (§2.3).
  purchaseApproved.value = purchasePreview.value.proposed;
  const pricing =
    pricePolicyApplies.value && priceChoice.value === "custom"
      ? {
          mode: "custom" as const,
          price: purchasePrice.value ?? 0,
          approvedProposed: purchasePreview.value.proposed,
        }
      : pricePolicyApplies.value
        ? {
          mode: "proposed" as const,
          approvedProposed:
              purchasePreview.value.proposed ?? 0,
          price: purchasePrice.value ?? purchasePreview.value.proposed ?? 0,
          }
        : { mode: "keep" as const };
  if (pricePolicyApplies.value && purchasePrice.value === undefined) {
    stockSubmitError.value =
      priceChoice.value === "custom"
        ? "أدخل سعر البيع المخصص أولاً."
        : "السعر المقترح غير صالح؛ أدخل سعرًا يدويًا.";
    return;
  }
  if (purchasePaid.value !== undefined && purchasePaid.value !== null) {
    const t = round2(
      round2((purchaseQty.value ?? 0) * (purchaseCost.value ?? 0)),
    );
    if (purchasePaid.value - t > 1e-9) {
      stockSubmitError.value =
        "المدفوع الآن لا يجوز أن يتجاوز إجمالي الفاتورة.";
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
      new_count: adjustNew.value ?? -1,
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
interface ProductRow {
  id?: string;
  name: string;
  price: string;
  cost_price: string;
  count?: number | null;
  stock?: number | null;
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
  try {
    await productsStore.fetchProducts();
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
  const authed = await useAuthReady();
  if (!authed) {
    loading.value = false;
    return; // layout redirects to /login
  }
  await loadProds();
});
</script>
