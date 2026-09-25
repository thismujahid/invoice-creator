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
              </div>
            </div>
            <div class="flex shrink-0 gap-2" @click.stop>
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
  </div>
</template>

<script setup lang="ts">
import type { Invoice, Product } from "~/types";
import { toDateSafe } from "~/types";

definePageMeta({ title: "المنتجات", middleware: "admin-only" });
const searchText = ref<string>("");
const { formatePrice } = useHelpers();
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
const clearConfirm = ref(false);
interface ProductRow {
  id?: string;
  name: string;
  price: string;
  cost_price: string;
  count?: number | null;
}
const confirmDelete = ref<ProductRow | null>(null);
const deleteOpen = computed({
  get: () => confirmDelete.value !== null,
  set: (v: boolean) => {
    if (!v) confirmDelete.value = null;
  },
});
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
    await productsStore.deleteProduct(id);
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
