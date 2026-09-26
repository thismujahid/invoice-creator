<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">المنتجات</h2>
      <div class="flex flex-wrap items-center gap-2">
        <!-- HOME delta: no products export (as in home branch). -->
        <FormsProduct
          :hide-cost="!viewCost"
          @close="productForm = undefined"
          :refresher="loadProds"
          v-model="productFormState"
          :edit="productForm"
        >
          <UButton icon="i-lucide-plus" color="success"
            >إضافة منتج جديد</UButton
          >
          <template #cost-input-place>
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              :icon="viewCost ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              @click="handleViewCostClick"
              >{{ viewCost ? "إخفاء القيمة" : "عرض القيمة" }}</UButton
            >
          </template>
        </FormsProduct>
        <UButton
          color="success"
          variant="soft"
          :icon="viewCost ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          @click="handleViewCostClick"
          >{{ viewCost ? "إخفاء القيمة" : "عرض القيمة" }}</UButton
        >
        <FormsAuthScreen
          @close="() => (startView = false)"
          @success="(value) => (viewCost = value)"
          v-if="startView"
          success-text="تم التحقق من الهوية بنجاح... تم عرض القيمة بنجاح"
          title="برجاء تأكيد هويتك لتتمكن من عرض القيمة"
          />
      </div>
    </div>
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
    <USkeleton v-if="loading" class="h-24 w-full" />
    <template v-else>
      <!-- Desktop table -->
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th class="w-10 p-2"></th>
              <th class="p-2 text-start font-medium">الاسم</th>
              <th class="p-2 text-start font-medium">سعر البيع</th>
              <th v-if="viewCost" class="p-2 text-start font-medium">
                سعر التكلفة
              </th>
              <th class="p-2 text-start font-medium">العدد</th>
              <th class="p-2 text-start font-medium">المخزون</th>
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
              <td class="p-2 font-medium">{{ p.name }}</td>
              <td class="p-2">{{ p.price }}</td>
              <td v-if="viewCost" class="p-2 text-gray-600">
                {{ p.cost_price }}
              </td>
              <td class="p-2">{{ p.count }}</td>
              <td class="p-2 font-semibold" :class="p.stock === null ? 'text-gray-400' : ''">{{ p.stock ?? "—" }}</td>
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
                  <span v-if="viewCost">| تكلفة: {{ p.cost_price }}</span>
                </div>
                <div class="text-xs" :class="p.stock === null ? 'text-gray-400' : 'text-gray-500'">
                  المخزون: {{ p.stock ?? "غير مُدخل" }}
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
    <UiAppDialog v-model:open="deleteOpen" title="هل أنت متأكد">
      <p class="mb-4 text-gray-600">
        أنت علي وشك حذف المنتج {{ confirmDelete?.name }}
      </p>
      <label
        v-if="deleteStock > 0"
        class="mb-4 flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2.5"
      >
        <UCheckbox v-model="recoverToCashbox" class="mt-0.5" />
        <span class="text-sm">
          استرداد قيمة الكمية المتبقية ({{ deleteStock }}) للخزنة —
          <strong>{{ formatePrice(deleteRecoverValue) }}</strong>
          <span class="block text-xs text-gray-500">عملية "استرجاع منتجات للمورد" تُسجل في الخزنة</span>
        </span>
      </label>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton
            color="error"
            block
            :loading="deleting"
            @click="deleteConfirmed"
            >حذف</UButton
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
    <UiAppDialog v-model:open="purchaseOpen" :title="`شراء مخزون — ${purchaseName}`">
      <div class="space-y-3">
        <UAlert color="info" variant="soft" :title="`المخزون الحالي: ${purchaseCountText}`" />
        <UAlert color="neutral" variant="soft" title="هذه العملية ستزيد كمية المخزون وسيتم خصم إجمالي تكلفة الشراء من الخزنة." />
        <UFormField label="الكمية المشتراة" required :error="purchaseQtyError || undefined">
          <UInputNumber v-model="purchaseQty" :min="0" :step="1" size="lg" class="w-full" />
        </UFormField>
        <UFormField label="سعر تكلفة الوحدة" required :error="purchaseCostError || undefined">
          <UInputNumber v-model="purchaseCost" :min="0" size="lg" class="w-full" />
        </UFormField>
        <div class="text-sm font-bold">إجمالي تكلفة الشراء: {{ formatePrice(purchaseTotal) }} ج — سيتم خصمها من الخزنة</div>
        <UCheckbox v-model="purchaseUpdatePrice" label="تحديث سعر البيع الحالي بهذا السعر" />
        <UFormField v-if="purchaseUpdatePrice" label="سعر البيع الجديد" required :error="purchasePriceError || undefined">
          <UInputNumber v-model="purchasePrice" :min="0" size="lg" class="w-full" />
        </UFormField>
        <UFormField label="ملاحظة">
          <UInput v-model="purchaseNote" placeholder="مثال: فاتورة مورد" size="lg" class="w-full" />
        </UFormField>
        <UAlert v-if="stockSubmitError" color="error" variant="soft" :title="stockSubmitError" />
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="success" class="min-h-11 flex-1" :loading="stockBusy" icon="i-lucide-package-plus" @click="doPurchase">تأكيد الشراء</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="stockBusy" @click="purchaseOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
    <!-- Manual stock adjustment (no cash) -->
    <UiAppDialog v-model:open="adjustOpen" :title="`تعديل مخزون — ${adjustName}`">
      <div class="space-y-3">
        <UAlert color="warning" variant="soft" title="هذا التعديل سيغيّر كمية المخزون فقط ولن يؤثر على رصيد الخزنة." />
        <UFormField label="الكمية الحالية">
          <UInput :model-value="adjustCountText" readonly size="lg" class="w-full" />
        </UFormField>
        <UFormField label="الكمية الجديدة" required :error="adjustNewError || undefined">
          <UInputNumber v-model="adjustNew" :min="0" :step="1" size="lg" class="w-full" />
        </UFormField>
        <UFormField label="سبب التعديل" required>
          <UInput v-model="adjustReason" placeholder="مثال: جرد فعلي" size="lg" class="w-full" />
        </UFormField>
        <UAlert v-if="stockSubmitError" color="error" variant="soft" :title="stockSubmitError" />
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="success" class="min-h-11 flex-1" :loading="stockBusy" @click="doAdjust">حفظ التعديل</UButton>
          <UButton color="neutral" variant="soft" class="min-h-11 flex-1" :disabled="stockBusy" @click="adjustOpen = false">إلغاء</UButton>
        </div>
      </template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Invoice, Product } from "~/types";
import { toDateSafe } from "~/types";

definePageMeta({ title: "المنتجات", middleware: "admin-only" });
const searchText = ref<string>("");
const { formatePrice } = useHelpers();
const { round2, toNum } = useFinance();
const productFormState = ref(false);
const productsStore = useProductsStore();
const startView = ref(false);
const viewCost = ref(false);
const loading = ref(false);
const deleting = ref(false);
const currentPage = ref(1);
const currentPerPage = ref(10);
const productForm = ref<Product | undefined>(undefined);
const selectProducts = ref<string[]>([]);
const invoiceStore = useInvoicesStore();

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
    .map((prod) => ({
      id: prod.id,
      select: false,
      name: prod.name,
      price: formatePrice(prod.price),
      cost_price: formatePrice(prod.cost_price),
      count: prod.count,
      stock: prod.stock_quantity ?? null,
    }));
});
function isSelected(item: { id?: string }): boolean {
  return !!item.id && selectProducts.value.includes(item.id);
}
function handleViewCostClick() {
  if (viewCost.value) {
    startView.value = false;
    viewCost.value = false;
  } else {
    startView.value = true;
  }
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
const { notify: notifyToast } = useAppToast();
const stockBusy = ref(false);
const stockSubmitError = ref("");
// Live field errors: empty = untouched (no red); message only when truly invalid.
const purchaseQtyError = computed(() => {
  if (purchaseQty.value === undefined || purchaseQty.value === null) return "";
  return purchaseQty.value > 0 ? "" : "الكمية يجب أن تكون أكبر من صفر.";
});
const purchaseCostError = computed(() => {
  if (purchaseCost.value === undefined || purchaseCost.value === null) return "";
  return purchaseCost.value >= 0 ? "" : "سعر التكلفة غير صالح.";
});
const purchasePriceError = computed(() => {
  if (!purchaseUpdatePrice.value) return "";
  if (purchasePrice.value === undefined || purchasePrice.value === null) return "";
  return purchasePrice.value >= 0 ? "" : "سعر البيع غير صالح.";
});
const adjustNewError = computed(() => {
  if (adjustNew.value === undefined || adjustNew.value === null) return "";
  return adjustNew.value >= 0 ? "" : "الكمية الجديدة غير صالحة.";
});
const purchaseTotal = computed(() => round2((purchaseQty.value || 0) * (purchaseCost.value || 0)));
const purchaseOpen = ref(false);
const purchaseId = ref<string | null>(null);
const purchaseQty = ref<number | undefined>(undefined);
const purchaseCost = ref<number | undefined>(undefined);
const purchaseUpdatePrice = ref(false);
const purchasePrice = ref<number | undefined>(undefined);
const purchaseNote = ref("");
const purchaseName = computed(() => prodsList.value.find((p) => p.id === purchaseId.value)?.name ?? "");
const purchaseCount = computed(() => prodsList.value.find((p) => p.id === purchaseId.value)?.stock_quantity ?? null);
const purchaseCountText = computed(() => (purchaseCount.value === null ? 'غير مُدخل' : String(purchaseCount.value)));
const adjustOpen = ref(false);
const adjustId = ref<string | null>(null);
const adjustNew = ref<number | undefined>(undefined);
const adjustReason = ref("");
const adjustName = computed(() => prodsList.value.find((p) => p.id === adjustId.value)?.name ?? "");
const adjustCount = computed(() => prodsList.value.find((p) => p.id === adjustId.value)?.stock_quantity ?? null);
const adjustCountText = computed(() => (adjustCount.value === null ? 'غير مُدخل' : String(adjustCount.value)));
function openPurchase(id?: string): void {
  if (!id) return;
  const p = prodsList.value.find((x) => x.id === id);
  purchaseId.value = id;
  purchaseQty.value = undefined;
  purchaseCost.value = p?.cost_price ?? undefined;
  purchaseUpdatePrice.value = false;
  purchasePrice.value = undefined;
  purchaseNote.value = "";
  stockSubmitError.value = "";
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
  if (purchaseQtyError.value || purchaseCostError.value || purchasePriceError.value) return;
  if (purchaseQty.value === undefined || purchaseCost.value === undefined) {
    stockSubmitError.value = "أدخل الكمية وسعر التكلفة أولاً.";
    return;
  }
  stockBusy.value = true;
  try {
    const res = await inventory.purchaseStock({
      product_id: purchaseId.value,
      quantity: purchaseQty.value ?? 0,
      unit_cost: purchaseCost.value ?? 0,
      update_price: purchaseUpdatePrice.value,
      new_price: purchaseUpdatePrice.value ? (purchasePrice.value ?? null) : null,
      note: purchaseNote.value.trim() || null,
    });
    if (!res.ok) {
      stockSubmitError.value = res.error;
      return;
    }
    notifyToast("تم تسجيل عملية الشراء وخصم قيمتها من الخزنة.", "success");
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
// Recovery option state (reset on every open).
const recoverToCashbox = ref(false);
watch(confirmDelete, () => {
  recoverToCashbox.value = false;
});
const deleteTarget = computed(() =>
  prodsList.value.find((p) => p.id === confirmDelete.value?.id),
);
const deleteStock = computed(() => toNum(deleteTarget.value?.stock_quantity));
const deleteRecoverValue = computed(() =>
  round2(deleteStock.value * toNum(deleteTarget.value?.cost_price)),
);
async function loadProds(): Promise<void> {
  loading.value = true;
  try {
    await productsStore.fetchProducts();
  } finally {
    loading.value = false;
  }
}
async function deleteConfirmed(): Promise<void> {
  const id = confirmDelete.value?.id;
  if (!id) return;
  deleting.value = true;
  try {
    if (recoverToCashbox.value && deleteStock.value > 0) {
      const res = await productsStore.deleteProductWithRecovery(id, true);
      if (!res.ok) {
        notifyToast(res.error, "error");
        return;
      }
      if (res.recovered > 0) {
        notifyToast(`تم حذف المنتج واسترداد ${formatePrice(res.recovered)} للخزنة.`, "success");
      }
    } else {
      await productsStore.deleteProduct(id);
    }
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
void loadProds();
</script>
