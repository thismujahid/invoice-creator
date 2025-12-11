<template>
  <div class="bg-white px-4 py-4 rounded">
    <div class="d-flex align-center mb-4 justify-between">
      <h2>المنتجات</h2>
      <div class="d-flex items-center" style="gap: 10px">
        <v-btn v-if="isAdmin" @click="exportToExcel" flat color="success"
          ><v-icon icon="mdi-export" />تصدير المنتجات</v-btn
        >
        <FormsProduct
          :hide-cost="!viewCost && productForm"
          @close="productForm = undefined"
          :refresher="loadProds"
          v-model="productFormState"
          :edit="productForm"
        >
          <v-btn flat color="success"
            ><v-icon icon="mdi-plus" />إضافة منتج جديد</v-btn
          >
          <template #cost-input-place>
            <v-btn
              flat
              density="compact"
              size="small"
              class="!h-[25px]"
              color="primary"
              @click="handleViewCostClick"
              :prepend-icon="`mdi-eye${viewCost ? '-off-' : '-'}outline`"
              >{{ viewCost ? "إخفاء القيمة" : "عرض القيمة" }}</v-btn
            >
          </template>
        </FormsProduct>
        <v-btn
          flat
          color="success"
          @click="handleViewCostClick"
          :prepend-icon="`mdi-eye${viewCost ? '-off-' : '-'}outline`"
          >{{ viewCost ? "إخفاء القيمة" : "عرض القيمة" }}</v-btn
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
    <div class="d-flex justify-between">
      <v-text-field
        max-width="350"
        label="بحث"
        variant="outlined"
        v-model="searchText"
      ></v-text-field>
      <div v-if="selectProducts.length > 0" class="d-flex ga-4">
        <v-btn @click="createInvoiceFromSelectedProducts" flat color="success"
          ><v-icon icon="mdi-file-plus" />إنشاء فاتورة بالمنتجات المحددة ({{
            selectProducts.length
          }})</v-btn
        >
        <v-dialog :loading="fillingProducts" max-width="400" persistent>
          <template #activator="{ props }">
            <v-btn v-bind="props" flat color="error"
              ><v-icon icon="mdi-close" />إلغاء تحديد الكل</v-btn
            >
          </template>
          <template #default="{ isActive }">
            <div class="bg-white rounded py-4 px-4 text-center">
              <p class="py-2">
                أنت علي وشك إلغاء المنتجات المحددة، هل أنت متاكد؟
              </p>
              <div class="d-flex ga-4 justify-center">
                <v-btn
                  color="error"
                  @click="
                    selectProducts = [];
                    isActive.value = true;
                  "
                  flat
                  >تاكيد</v-btn
                >
                <v-btn
                  color="black"
                  @click="isActive.value = false"
                  variant="outlined"
                  flat
                  >إلغاء</v-btn
                >
              </div>
            </div>
          </template>
        </v-dialog>
      </div>
    </div>
    <hr v-if="productsStore.list.length > 0" />
    <v-data-table
      :loading="loading"
      no-data-text="لا توجد منتجات حتى الأن"
      :items-length="prodsList.length || 0"
      :hide-default-header="prodsList.length === 0"
      :items-per-page="currentPerPage"
      :page="currentPage"
      hide-default-footer
      :items="paginateArray"
      hover
    >
      <template v-slot:headers="{ columns, isSorted, getSortIcon, toggleSort }">
        <tr class="header-row">
          <template
            v-for="column in columns.filter(
              (el) => !['id', !viewCost ? 'cost_price' : ''].includes(el.key)
            )"
            :key="column.key"
          >
            <td>
              <span
                class="mr-2 cursor-pointer"
                v-if="column.title"
                @click="() => toggleSort(column)"
                >{{ formateHeaderTitle(column.title) }}</span
              >
              <template v-if="isSorted(column)">
                <v-icon :icon="getSortIcon(column)"></v-icon>
              </template>
            </td>
          </template>
          <td>
            <span> الأدوات </span>
          </td>
        </tr>
      </template>

      <template v-slot:item="data">
        <tr class="cursor-pointer">
          <template v-for="(value, key, i) of data.item">
            <td
              @click="
                () => {
                  data.item.select = !isSelected(data.item);
                  toggleSelect(data.item);
                }
              "
              v-if="
                !['id', 'select', !viewCost ? 'cost_price' : ''].includes(key)
              "
            >
              {{ value }}
            </td>
            <td
              @click="
                () => {
                  data.item.select = !isSelected(data.item);
                  toggleSelect(data.item);
                }
              "
              v-else-if="key == 'select'"
            >
              <v-checkbox
                hide-details
                :model-value="isSelected(data.item)"
                readonly
              />
            </td>
          </template>
          <td>
            <div class="d-flex ga-3">
              <v-btn
                size="30"
                @click="editProduct(data.item)"
                flat
                variant="tonal"
                color="success"
                ><v-icon icon="mdi-pencil" size="25"
              /></v-btn>
              <v-dialog persistent max-width="300px">
                <template #activator="{ props }">
                  <v-btn
                    flat
                    size="30"
                    v-bind="props"
                    variant="tonal"
                    color="error"
                    ><v-icon icon="mdi-delete-outline" size="30"
                  /></v-btn>
                </template>
                <template #default="{ isActive }">
                  <div class="bg-white py-4 px-4 rounded">
                    <h4>هل أنت متأكد</h4>
                    <p class="mb-4">
                      أنت علي وشك حذف المنتج {{ data.item.name }}
                    </p>
                    <v-btn
                      @click="deleteProd(data.item.id)"
                      block
                      :loading="deleting"
                      color="error"
                      flat
                      >حذف</v-btn
                    >
                    <v-btn
                      :disabled="deleting"
                      block
                      @click="isActive.value = false"
                      color="black"
                      variant="plain"
                      flat
                      >إلغاء</v-btn
                    >
                  </div>
                </template>
              </v-dialog>
            </div>
          </td>
        </tr>
      </template>
    </v-data-table>
    <div class="d-flex align-items" style="justify-content: space-between">
      <div class="app-table__footer__per-page">
        <v-menu :disabled="loading">
          <template v-slot:activator="{ props }">
            <v-btn
              class="main"
              color="gray"
              append-icon="mdi-chevron-down"
              :text="String(currentPerPage)"
              variant="tonal"
              v-bind="props"
            />
          </template>
          <v-list>
            <v-list-item
              v-for="item in [10, 25, 50, 100, 150]"
              @click="currentPerPage = item"
              >{{ item }}</v-list-item
            >
          </v-list>
        </v-menu>
      </div>
      <v-pagination
        size="30"
        total-visible="5"
        v-model="currentPage"
        :length="Math.ceil(prodsList.length / currentPerPage) || 0"
        active-color="primary"
        :total-visible="7"
        variant="flat"
      ></v-pagination>
    </div>
  </div>
</template>

<script setup>
import * as XLSX from "xlsx";

definePageMeta({
  title: "المنتجات",
  middleware: "admin-only",
});
const searchText = ref();
const { formatePrice } = useHelpers();
const productFormState = ref(false);
const productsStore = useProductsStore();
const startView = ref(false);
const viewCost = ref(false);
const loading = ref(false);
const deleting = ref(false);
const prodsList = computed(() => {
  return productsStore.list.filter((prod) => {
    if (searchText.value) {
      currentPage.value = 1;
      if (prod.name.toLowerCase().includes(searchText.value.toLowerCase()))
        return true;
      else return false;
    } else return true;
  });
});
function exportToExcel() {
  // Optionally, set column headers order
  const headers = ["name", "cost_price", "price", "count"];
  const orderedData = prodsList.value.map((item) => {
    const obj = {};
    headers.forEach((h) => (obj[h] = item[h] || ""));
    return obj;
  });

  const finalSheet = XLSX.utils.json_to_sheet(orderedData, { header: headers });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, finalSheet, "Sheet1");

  XLSX.writeFile(workbook, "المنتجات.xlsx");
}
const paginateArray = computed(() => {
  // Calculate starting and ending indices
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  const endIndex = startIndex + currentPerPage.value;

  // Return the slice of the array for the current page
  return prodsList.value
    .sort((a, b) => {
      if (a.date) {
        return (
          new Date((b.date?.seconds || 0) * 1000) -
          new Date((a.date?.seconds || 0) * 1000)
        );
      } else return false;
    })
    .slice(startIndex, endIndex)
    .map((prod) => ({
      id: prod.id,
      select: false,
      name: prod.name,
      price: formatePrice(prod.price),
      cost_price: formatePrice(prod.cost_price),
      count: prod.count,
    }));
});
const productForm = ref();
const currentPage = ref(1);
const currentPerPage = ref(10);
const selectProducts = ref([]);
const invoiceStore = useInvoicesStore();
function isSelected(item) {
  return selectProducts.value.includes(item.id);
}
function handleViewCostClick() {
  if (viewCost.value) {
    startView.value = false;
    viewCost.value = false;
  } else {
    startView.value = true;
  }
}
function toggleSelect(item) {
  const index = selectProducts.value.indexOf(item.id);
  if (index > -1) {
    selectProducts.value.splice(index, 1);
  } else {
    selectProducts.value.push(item.id);
  }
}
function editProduct(product) {
  const prod = prodsList.value.find((el) => el.id == product.id);
  if (prod) {
    productForm.value = {
      ...prod,
    };
  }
  productFormState.value = true;
}
function formateHeaderTitle(title) {
  const text = title
    .split("_")
    .map((word) => {
      const string = word.charAt(0).toUpperCase() + word.slice(1);
      return string;
    })
    .join(" ");
  if (text === "Name") return "الاسم";
  else if (text === "Price") return "سعر البيع";
  else if (text === "Cost Price") return "سعر التكلفة";
  else if (text === "Count") return "العدد";
  else if (text === "Select") return "تحديد";
  else return "";
}
async function loadProds() {
  loading.value = true;
  setTimeout(async () => {
    await productsStore.fetchProducts();
    loading.value = false;
  }, 100);
}
async function deleteProd(id) {
  deleting.value = true;
  await productsStore.deleteProduct(id);
  await loadProds();
  deleting.value = false;
}
function createInvoiceFromSelectedProducts() {
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
    products: selectProducts.value.map((id) => {
      const product = prodsList.value.find((prod) => prod.id == id);
      return {
        product_name: product.name,
        product_price: product.price,
        product_cost_price: product.cost_price,
        product_quantity: 1,
        total: 0,
        option: "",
        product_id: product.id,
      };
    }),
  };
  navigateTo("/");
}
loadProds();
</script>
