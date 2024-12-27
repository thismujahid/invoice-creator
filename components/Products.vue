<template>
  <v-dialog max-width="800px">
    <template #activator="{ props }">
      <v-btn color="info" flat v-bind="props">المنتجات</v-btn>
    </template>
    <div
      style="max-height: 80vh; overflow: auto"
      class="bg-white px-4 py-4 rounded"
    >
      <div class="d-flex align-center mb-4 justify-between">
        <h2>المنتجات</h2>

        <v-dialog max-width="350px" v-model="productFormState">
          <template #activator="{ props }">
            <v-btn flat color="success" v-bind="props"
              ><v-icon icon="mdi-plus" />إضافة منتج جديد</v-btn
            >
          </template>
          <template #default="{ isActive }">
            <div class="bg-white px-4 py-4 rounded">
              <h2 class="mb-4">
                {{ productForm?.id ? "تعديل المنتج" : "إضافة منتج جديد" }}
              </h2>
              <v-text-field
                v-model="productForm.name"
                variant="outlined"
                color="primary"
                label="اسم المنتج"
              ></v-text-field>
              <v-text-field
                v-model="productForm.cost_price"
                variant="outlined"
                color="primary"
                label="سعر التكلفة"
              ></v-text-field>
              <v-text-field
                v-model="productForm.price"
                variant="outlined"
                color="primary"
                label="سعر البيع"
              ></v-text-field>
              <v-text-field
                v-model="productForm.count"
                variant="outlined"
                color="primary"
                label="العدد"
              ></v-text-field>
              <div class="d-flex ga-3">
                <v-btn @click="saveProduct(isActive)" flat color="success"
                  ><v-icon icon="mdi-content-save" />حفظ</v-btn
                >
                <v-btn
                  @click="isActive.value = false"
                  flat
                  color="black"
                  variant="outlined"
                  >إلغاء</v-btn
                >
              </div>
            </div>
          </template>
        </v-dialog>
      </div>
      <v-text-field
        label="بحث"
        variant="outlined"
        v-model="searchText"
      ></v-text-field>
      <hr v-if="productsStore.list.length > 0" />
      <v-data-table
        no-data-text="لا توجد منتجات حتى الأن"
        :search="searchText"
        :items-length="productsStore.list.length"
        :hide-default-header="productsStore.list.length === 0"
        :items-per-page="currentPerPage"
        :page="currentPage"
        hide-default-footer
        :items="paginateArray"
        hover
        enable-search
      >
        <template
          v-slot:headers="{ columns, isSorted, getSortIcon, toggleSort }"
        >
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
            <td>
              <div class="d-flex ga-3">
                <v-btn
                  size="40"
                  @click="editProduct(data.item)"
                  flat
                  color="primary"
                  ><v-icon icon="mdi-pencil"
                /></v-btn>
                <v-dialog max-width="300px">
                  <template #activator="{ props }">
                    <v-btn flat size="40" v-bind="props" color="error"
                      ><v-icon icon="mdi-delete"
                    /></v-btn>
                  </template>
                  <template #default="{ isActive }">
                    <div class="bg-white py-4 px-4 rounded">
                      <h4>هل أنت متأكد</h4>
                      <p class="mb-4">
                        أنت علي وشك حذف المنتج {{ data.item.name }}
                      </p>
                      <v-btn
                        @click="
                          productsStore.list.splice(index, 1);
                          isActive.value = false;
                        "
                        block
                        color="error"
                        flat
                        >حذف</v-btn
                      >
                      <v-btn
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
          :length="productsStore.list.length / currentPerPage"
          active-color="primary"
          :total-visible="7"
          variant="flat"
        ></v-pagination>
      </div>
    </div>
  </v-dialog>
</template>

<script setup>
const productFormState = ref(false);
const productsStore = useProductsStore()
const paginateArray = computed(() => {
  // Calculate starting and ending indices
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  const endIndex = startIndex + currentPerPage.value;

  // Return the slice of the array for the current page
  return productsStore.list
    .slice(startIndex, endIndex)
    .map((prod) => ({ ...prod, id: Math.floor(Math.random() * 99999) }));
});
const searchText = ref();
const productForm = ref({
  name: "",
  price: 0,
  cost_price: 0,
  count: 0,
});
const currentPage = ref(1);
const currentPerPage = ref(10);
function saveProduct(isActive) {
  const isInList = productsStore.list.findIndex(
    (p) => p.id === productForm.value.id
  );
  if (isInList > -1) {
    productsStore.list[isInList] = { ...productForm.value };
  } else {
    productsStore.list.push({
      ...productForm.value,
      id: Math.floor(Math.random() * 999999999),
    });
  }
  productForm.value = {
    name: "",
    price: 0,
    cost_price: 0,
    count: 0,
  };
  isActive.value = false;
}
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
  if (text === "Name") return "الأسم";
  else if (text === "Price") return "سعر البيع";
  else if (text === "Cost Price") return "سعر التكلفة";
  else if (text === "Count") return "العدد";
  else return "";
}
</script>
