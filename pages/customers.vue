<template>
  <div
    class="bg-white px-4 py-4 rounded"
  >
    <div class="d-flex align-center mb-4 justify-between">
      <h2>العملاء</h2>
      <forms-customer
        v-model="customerFormState"
        :edit="customerForm"
        :refresher="loadCustomers"
      >
        <v-btn flat color="success" v-bind="props"
          ><v-icon icon="mdi-plus" />إضافة عميل جديد</v-btn
        >
      </forms-customer>
    </div>
    <v-text-field
      max-width="350"
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
      :loading="loading"
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
                size="40"
                flat
                variant="tonal"
                color="primary"
                v-tooltip:top="'فواتير العميل (قريبا)'"
                ><v-icon size="30" icon="mdi-file-eye-outline"
              /></v-btn>
              <v-btn
                size="40"
                @click="editCustomer(data.item)"
                variant="tonal"
                flat
                color="success"
                v-tooltip:top="'تعديل'"
                ><v-icon size="30" icon="mdi-pencil"
              /></v-btn>
              <v-dialog persistent max-width="300px">
                <template #activator="{ props }">
                  <v-btn
                    v-tooltip:top="'حذف'"
                    variant="tonal"
                    flat
                    size="40"
                    v-bind="props"
                    color="error"
                    ><v-icon size="30" icon="mdi-delete-outline"
                  /></v-btn>
                </template>
                <template #default="{ isActive }">
                  <div class="bg-white py-4 px-4 rounded">
                    <h4>هل أنت متأكد</h4>
                    <p class="mb-4">
                      أنت علي وشك حذف العميل {{ data.item.name }}
                    </p>
                    <v-btn
                      @click="deleteCustomer(data.item.id)"
                      block
                      color="error"
                      :loading="deleting"
                      flat
                      >حذف</v-btn
                    >
                    <v-btn
                      block
                      :disabled="deleting"
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
</template>

<script setup>
definePageMeta({
  title: "العملاء",
});
const customerFormState = ref(false);
const customersStore = useCustomersStore();
const paginateArray = computed(() => {
  // Calculate starting and ending indices
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  const endIndex = startIndex + currentPerPage.value;

  // Return the slice of the array for the current page
  return customersStore.list.slice(startIndex, endIndex).map((customer) => ({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
  }));
});
const searchText = ref();
const customerForm = ref({
  name: "",
  phone: null,
});
const currentPage = ref(1);
const currentPerPage = ref(10);
const saving = ref(false);
const loading = ref(false);
const deleting = ref(false);
async function saveProduct(isActive) {
  saving.value = true;
  if (customerForm.value.id) {
    await customersStore.updateCustomer(customerForm.value.id, {
      ...customerForm.value,
    });
  } else {
    await customersStore.addCustomer({ ...customerForm.value });
  }
  await loadCustomers();
  customerForm.value = {
    name: "",
    phone: null,
  };
  saving.value = false;
  isActive.value = false;
}
async function loadCustomers() {
  loading.value = true;
  await customersStore.fetchCustomers();
  loading.value = false;
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
async function deleteCustomer(id) {
  deleting.value = true;
  await customersStore.deleteCustomer(id);
  await loadCustomers();
  deleting.value = false;
}
loadCustomers();
</script>
