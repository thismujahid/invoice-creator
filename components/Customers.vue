<template>
  <v-dialog max-width="800px">
    <template #activator="{ props }">
      <v-btn color="info" flat v-bind="props">العملاء</v-btn>
    </template>
    <div
      style="max-height: 80vh; overflow: auto"
      class="bg-white px-4 py-4 rounded"
    >
      <div class="d-flex align-center mb-4 justify-between">
        <h2>العملاء</h2>

        <v-dialog @after-leave="customerForm={name:'',phone:null}" max-width="350px" v-model="customerFormState">
          <template #activator="{ props }">
            <v-btn flat color="success" v-bind="props"
              ><v-icon icon="mdi-plus" />إضافة عميل جديد</v-btn
            >
          </template>
          <template #default="{ isActive }">
            <div class="bg-white px-4 py-4 rounded">
              <h2 class="mb-4">
                {{ customerForm?.id ? "تعديل العميل  " : "إضافة عميل جديد" }}
              </h2>
              <v-text-field
                v-model="customerForm.name"
                variant="outlined"
                color="primary"
                label="اسم العميل"
              ></v-text-field>
              <v-text-field
                v-model="customerForm.phone"
                variant="outlined"
                type="number"
                color="primary"
                label="رقم هاتف العميل"
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
      <hr v-if="customersStore.list.length > 0" />
      <v-data-table
        no-data-text="لا يوجد عملاء حتى الأن"
        :search="searchText"
        :items-length="customersStore.list.length"
        :hide-default-header="customersStore.list.length === 0"
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
                  @click="editCustomer(data.item)"
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
                        أنت علي وشك حذف العميل {{ data.item.name }}
                      </p>
                      <v-btn
                        @click="
                          customersStore.list.splice(index, 1);
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
          :length="customersStore.list.length / currentPerPage"
          active-color="primary"
          :total-visible="7"
          variant="flat"
        ></v-pagination>
      </div>
    </div>
  </v-dialog>
</template>

<script setup>
const customerFormState = ref(false);
const customersStore = useCustomers()
const paginateArray = computed(() => {
  // Calculate starting and ending indices
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  const endIndex = startIndex + currentPerPage.value;

  // Return the slice of the array for the current page
  return customersStore.list
    .slice(startIndex, endIndex)
    .map((prod) => ({ ...prod, id: Math.floor(Math.random() * 99999) }));
});
const searchText = ref();
const customerForm = ref({
  name: "",
  phone: null,
});
const currentPage = ref(1);
const currentPerPage = ref(10);
function saveProduct(isActive) {
  const isInList = customersStore.list.findIndex(
    (p) => p.id === customerForm.value.id
  );
  if (isInList > -1) {
    customersStore.list[isInList] = { ...customerForm.value };
  } else {
    customersStore.list.push({
      ...customerForm.value,
      id: Math.floor(Math.random() * 999999999),
    });
  }
  customerForm.value = {
    name: "",
    phone: null,
  };
  isActive.value = false;
}
function editCustomer(customer) {
  customerForm.value = {
    ...customer,
  };
  customerFormState.value = true;
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
  else if (text === "Phone") return "الهاتف";
  else return "";
}
</script>
