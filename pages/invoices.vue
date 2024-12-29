<template>
  <div
    style="max-height: 80vh; overflow: auto"
    class="bg-white px-4 py-4 rounded"
  >
    <div class="d-flex align-center mb-4 justify-between">
      <h2>الفواتير</h2>
      <!-- <forms-customer
        v-model="customerFormState"
        :edit="customerForm"
        :refresher="loadInvoices"
      >
        <v-btn flat color="success" v-bind="props"
          ><v-icon icon="mdi-plus" />إضافة عميل جديد</v-btn
        >
      </forms-customer> -->
    </div>
    <v-text-field
      max-width="350"
      label="بحث"
      variant="outlined"
      v-model="searchText"
    ></v-text-field>
    <hr v-if="invoicesStore.list.length > 0" />
    <v-data-table
      no-data-text="لا يوجد فواتير حتى الأن"
      :search="searchText"
      :items-length="invoicesStore.list.length"
      :hide-default-header="invoicesStore.list.length === 0"
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
              v-if="!['id','invoice','created_at_object'].includes(column.key)"
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
            <td v-if="!['created_at_object','id','invoice'].includes(key)">
              {{ value }}
            </td>
          </template>
          <td class="pt-4 pb-4">
            <div class="d-flex ga-3">
              <v-dialog persistent max-width="500px">
                <template #activator="{ props }">
                  <v-btn
                    v-tooltip:top="'عرض الفاتورة'"
                    variant="tonal"
                    flat
                    size="40"
                    v-bind="props"
                    color="success"
                    ><v-icon size="30" icon="mdi-file-eye-outline"
                  /></v-btn>
                </template>
                <template #default="{ isActive }">
                  <div v-if="isActive.value" class="bg-white invoice-creator-view px-2 py-2 rounded-lg">
                    <Invoice :viewMode="true" @close="isActive.value = false" :invoice-data="{
                      ...data.item.invoice,
                      customer:{
                        name:data.item.name,
                      },
                      products: data.item.invoice?.products.map(prod=>{
                        return {
                          product: {name:prod.name},
                          product_quantity:prod.quantity,
                          product_price:prod.price,
                        }
                      }),
                      phone:data.item.phone,
                      date:data.item.created_at_object,
                      old_money:data.item.invoice.debt,
                      time:data.item.created_at_object,
                    }" />
                    </div>
                </template>
              </v-dialog> 
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
                      أنت علي وشك حذف الفاتورة الخاصة بـ {{ data.item.name }}
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
        :length="invoicesStore.list.length / currentPerPage"
        active-color="primary"
        :total-visible="7"
        variant="flat"
      ></v-pagination>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "الفواتير",
});
function formatTimestamp(seconds, returnObject) {
  const date = new Date(seconds * 1000);
  if(returnObject) return date;
  const formattedDate = date.toLocaleDateString("ar-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("ar-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formattedDate} ${formattedTime}`;
}
const {formatePrice} =useHelpers()
const customerFormState = ref(false);
const invoicesStore = useInvoicesStore();
const paginateArray = computed(() => {
  // Calculate starting and ending indices
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  const endIndex = startIndex + currentPerPage.value;
  // Return the slice of the array for the current page
  return invoicesStore.list.slice(startIndex, endIndex).map((invoice) => ({
    id: invoice.id,
    name: invoice.customer_name,
    phone: invoice.customer_phone,
    products_count: invoice.products?.length||0,
    total: formatePrice(invoice.total),
    created_at: formatTimestamp(invoice.date?.seconds),
    invoice: invoice,
    created_at_object: formatTimestamp(invoice.date?.seconds, true)
  }));
});
const searchText = ref();
const customerForm = ref({
  name: "",
  phone: null,
});
const currentPage = ref(1);
const currentPerPage = ref(10);
const loading = ref(false);
const deleting = ref(false);
async function loadInvoices() {
  loading.value = true;
  await invoicesStore.fetchInvoices();
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
  else if (text === "Products Count") return "عدد المنتجات";
  else if (text === "Total") return "الإجمالي";
  else if (text === "Created At") return "تاريخ الإنشاء";
  else return "";
}
async function deleteCustomer(id) {
  deleting.value = true;
  await invoicesStore.deleteInvoice(id);
  await loadInvoices();
  deleting.value = false;
}
loadInvoices();
</script>
