<template>
  <div class="bg-white px-4 py-4 rounded">
    <div class="d-flex align-center mb-4 justify-between">
      <h2>الفواتير</h2>
    </div>
    <div class="d-flex items-center justify-between">
      <div class="d-flex" style="gap: 10px">
        <v-text-field
          min-width="250"
          label="بحث"
          variant="outlined"
          v-model="searchText"
        ></v-text-field>
        <!-- <v-autocomplete
          item-title="label"
          v-if="isAdmin"
          item-value="value"
          min-width="250"
          label="قريتي"
          variant="outlined"
          v-model="activeUser"
          :items="usersList"
          @update:model-value="loadInvoices"
        ></v-autocomplete> -->
        <v-menu
          ref="menu"
          v-model="dateMenu"
          :close-on-content-click="false"
          transition="scale-transition"
        >
          <template #activator="{ props }">
            <v-text-field
              v-model="displayDate"
              label="تاريخ الفاتورة"
              readonly
              min-width="250px"
              variant="outlined"
              v-bind="props"
              append-inner-icon="mdi-calendar"
              @update:model-value="loadInvoices"
              @click:clear="() => ((selectedDate = null), loadInvoices())"
              clearable
            />
          </template>

          <v-card>
            <v-date-picker v-model="selectedDate" hide-header></v-date-picker>

            <v-card-actions>
              <v-spacer />
              <v-btn text @click="dateMenu = false">إلغاء</v-btn>
              <v-btn text @click="applyDate">موافق</v-btn>
            </v-card-actions>
          </v-card>
        </v-menu>
      </div>
      <div>
        <v-btn
          prepend-icon="mdi-export-variant"
          @click="startExport = true"
          color="info"
          v-if="isAdmin"
          :loading="exporting"
          :disabled="loading"
          >تصدير البيانات</v-btn
        >
        <FormsAuthScreen
          @close="() => (startExport = false)"
          @success="handleSuccess"
          v-if="startExport && isAdmin"
          success-text="تم التحقق من الهوية بنجاح... جاري تصدير الفواتير"
          title="برجاء تأكيد هويتك لتتمكن من تصدير الفواتير"
        />
      </div>
    </div>
    <v-alert
      color="success"
      variant="tonal"
      v-if="isAdmin"
      class="mb-4 d-flex align-center"
    >
      إجمالي مبيعات الفواتير المعروضة:
      <strong v-if="!hideTotal">
        {{
          formatePrice(
            filteredInvoices.reduce(
              (total, inv) => total + (calcTotal(inv) - discountAmount(inv)),
              0
            )
          )
        }}
        ج.م
      </strong>
      <strong v-else> *********** </strong>
      <v-icon
        @click="!hideTotal ? (hideTotal = true) : (startViewTotal = true)"
        :icon="hideTotal ? 'mdi-eye-off' : 'mdi-eye'"
      />
      <FormsAuthScreen
        @close="() => (startViewTotal = false)"
        @success="
          (val) =>
            val ? ((hideTotal = !hideTotal), (startViewTotal = false)) : false
        "
        v-if="startViewTotal && isAdmin"
        success-text="تم التحقق من الهوية بنجاح... تم عرض إجمالي مبيعات الفواتير المعروضة بنجاح"
        title="برجاء تأكيد هويتك لتتمكن من عرض إجمالي مبيعات الفواتير المعروضة"
      />
    </v-alert>
    <hr v-if="filteredInvoices.length > 0" />
    <v-data-table
      no-data-text=" لا يوجد فواتير مسجلة بالمستخدم الحالي حتى الأن"
      :items-length="filteredInvoices.length || 0"
      :hide-default-header="filteredInvoices.length === 0"
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
              v-if="
                !['id', 'invoice', 'created_at_object'].includes(column.key)
              "
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
            <td
              v-if="
                !['created_at_object', 'id', 'invoice', 'created_by'].includes(
                  key
                )
              "
            >
              {{ value }}
            </td>
              <!-- <td v-else-if="['created_by'].includes(key)">
                {{ formateActiveUserKey(value).name }}
              </td> -->
          </template>
          <td class="pt-4 pb-4">
            <div class="d-flex ga-3">
              <v-btn
                v-tooltip:top="'نسخ الفاتورة'"
                variant="tonal"
                flat
                size="40"
                @click="
                  () => {
                    delete data.item.invoice.id;
                    invoicesStore.invoiceToEdit = data.item.invoice;
                    $router.push({
                      name: 'index',
                    });
                  }
                "
                color="success"
                ><v-icon size="30" icon="mdi-content-copy"
              /></v-btn>
              <v-btn
                v-tooltip:top="'تعديل الفاتورة'"
                variant="tonal"
                flat
                size="40"
                @click="
                  invoicesStore.invoiceToEdit = data.item.invoice;
                  $router.push({
                    name: 'index',
                  });
                "
                color="success"
                ><v-icon size="30" icon="mdi-file-edit-outline"
              /></v-btn>
              <v-dialog eager persistent max-width="520px">
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
                  <div
                    style="
                      max-height: 95vh;
                      overflow-y: auto;
                      overflow-x: hidden;
                      border-radius: 10px;
                    "
                    class="custom-scrollbar"
                  >
                    <div
                      v-if="isActive.value"
                      class="bg-white invoice-creator-view py-2 rounded-lg mx-auto custom-scrollbar"
                      style="overflow-x: auto"
                    >
                      <Invoice
                        class="mx-auto"
                        :viewMode="true"
                        @close="isActive.value = false"
                        :invoice-data="{
                          ...data.item.invoice,
                          date: data.item.created_at_object,
                          time: data.item.created_at_object,
                        }"
                      />
                    </div>
                  </div>
                </template>
              </v-dialog>
              <v-dialog v-if="isAdmin" persistent max-width="300px">
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
        :length="filteredInvoices.length / currentPerPage || 0"
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
const hideTotal = ref(true);
const authStore = useAuth();
const activeUser = ref(
  authStore.currentUserKey === "su" ? undefined : authStore.currentUserKey
);
const dateMenu = ref(false);
const startExport = ref(false);
const selectedDate = ref(null);
const displayDate = ref("");
const startViewTotal = ref(false);
function applyDate() {
  dateMenu.value = false;
  displayDate.value = selectedDate.value
    ? selectedDate.value.toLocaleDateString()
    : "";
  loadInvoices();
}

watch(selectedDate, (val) => {
  displayDate.value = val ? val.toLocaleDateString() : "";
});
function formatTimestamp(seconds, returnObject) {
  const date = new Date(seconds * 1000);
  if (returnObject) return date;
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
const { formatePrice, calcTotal } = useHelpers();
const invoicesStore = useInvoicesStore();
const filteredInvoices = computed(() => {
  return invoicesStore.list.filter((invoice) => {
    if (searchText.value) {
      currentPage.value = 1;
      return (
        invoice.customer_name?.includes(searchText.value) ||
        invoice.customer_phone?.includes(searchText.value)
      );
    } else return true;
  });
});
function discountAmount(invoice) {
  if (invoice.discount && invoice.discount_percentage) {
    return (calcTotal(invoice) * invoice.discount) / 100;
  } else return invoice.discount || 0;
}
const paginateArray = computed(() => {
  // Calculate starting and ending indices
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  const endIndex = startIndex + currentPerPage.value;
  // Return the slice of the array for the current page
  return filteredInvoices.value
    .sort((a, b) => {
      if (a.date) {
        return (
          new Date((b.date?.seconds || 0) * 1000) -
          new Date((a.date?.seconds || 0) * 1000)
        );
      } else return false;
    })
    .slice(startIndex, endIndex)
    .map((invoice) => ({
      id: invoice.id,
      name: invoice.customer_name,
      // created_by: invoice.created_by,
      phone: invoice.customer_phone,
      products_count: invoice.products?.length || 0,
      total: formatePrice(calcTotal(invoice) - discountAmount(invoice)),
      created_at: formatTimestamp(invoice.date?.seconds),
      invoice: invoice,
      created_at_object: formatTimestamp(invoice.date?.seconds, true),
    }));
});
const searchText = ref();
const currentPage = ref(1);
const currentPerPage = ref(10);
const loading = ref(false);
const exporting = ref(false);
const deleting = ref(false);
async function loadInvoices() {
  loading.value = true;
  await invoicesStore.fetchInvoices({
    // created_by: activeUser.value,
    date: selectedDate.value,
  });
  loading.value = false;
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
  // else if (text === "Created By") return "منشئ الفاتورة";
  else if (text === "Products Count") return "عدد المنتجات";
  else if (text === "Total") return "الإجمالي";
  else if (text === "Created At") return "تاريخ الإنشاء";
  else return "";
}
async function deleteCustomer(id) {
  deleting.value = true;
  try {
    await invoicesStore.deleteInvoice(id);
  } catch (err) {
    authStore.snackBarColor = "error";
    authStore.snackBarText = err.toString();
  }
  await loadInvoices();
  deleting.value = false;
}
async function handleSuccess(isSuccess) {
  if (isSuccess) {
    exporting.value = true;
    invoicesStore
      .exportInvoicesToExcel(filteredInvoices.value)
      .then((res) => {
        authStore.snackBarText = res;
        authStore.snackBarColor = "success";
        exporting.value = false;
      })
      .catch((err) => {
        authStore.snackBarText = err;
        exporting.value = false;
        authStore.snackBarColor = "error";
      });
  }
}
loadInvoices();
</script>
