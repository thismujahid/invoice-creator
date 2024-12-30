<template>
  <div
    style="max-height: 80vh; overflow: auto"
    class="bg-white px-4 py-4 rounded"
  >
    <div class="d-flex align-center mb-4 justify-between">
      <h2>المنتجات</h2>
      <FormsProduct
        :refresher="loadProds"
        v-model="productFormState"
        :edit="productForm"
      >
        <v-btn flat color="success" v-bind="props"
          ><v-icon icon="mdi-plus" />إضافة منتج جديد</v-btn
        >
      </FormsProduct>
    </div>
    <v-text-field
      max-width="350"
      label="بحث"
      variant="outlined"
      v-model="searchText"
    ></v-text-field>
    <hr v-if="productsStore.list.length > 0" />
    <v-data-table
      :loading="loading"
      no-data-text="لا توجد منتجات حتى الأن"
      :items-length="productsStore.list.length"
      :hide-default-header="productsStore.list.length === 0"
      :items-per-page="currentPerPage"
      :page="currentPage"
      :search="searchText"
      hide-default-footer
      :items="paginateArray"
      hover
      enable-search
    >
      <template v-slot:headers="{ columns, isSorted, getSortIcon, toggleSort }">
        <tr class="header-row">
          <template v-for="column in columns" :key="column.key">
            <td
              v-if="!['id'].includes(column.key)"
              :class="{ 'b-dashed': dashedTd }"
            >
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
        <tr>
          <template v-for="(value, key, i) of data.item">
            <td v-if="key !== 'id'">
              {{ value }}
            </td>
          </template>
          <td class="pt-4 pb-4">
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
                  <v-btn flat size="30" v-bind="props" variant="tonal" color="error"
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
              :text="currentPerPage"
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
        :length="Math.ceil(productsStore.list.length / currentPerPage)"
        active-color="primary"
        :total-visible="7"
        variant="flat"
      ></v-pagination>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "المنتجات",
});
const searchText = ref();
const {formatePrice}=useHelpers()
const productFormState = ref(false);
const productsStore = useProductsStore();
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const paginateArray = computed(() => {
  // Calculate starting and ending indices
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  const endIndex = startIndex + currentPerPage.value;

  // Return the slice of the array for the current page
  return productsStore.list.slice(startIndex, endIndex).map((prod) => ({
    id: prod.id,
    name: prod.name,
    price: formatePrice(prod.price),
    cost_price: formatePrice(prod.cost_price),
    count: prod.count,
  }));
});
const productForm = ref();
const currentPage = ref(1);
const currentPerPage = ref(10);
function editProduct(product) {
  productForm.value = {
    ...product,
  };
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
  else return "";
}
async function loadProds() {
  loading.value = true;
  setTimeout(async () => {
    await productsStore.fetchProducts({ name: searchText.value });
    loading.value = false;
  }, 100);
}
async function deleteProd(id) {
  deleting.value = true;
  await productsStore.deleteProduct(id);
  await loadProds();
  deleting.value = false;
}
loadProds();
</script>
