<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">العملاء</h2>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="isAdmin"
          icon="i-lucide-download"
          color="neutral"
          variant="soft"
          @click="exportToExcel"
          >تصدير العملاء</UButton
        >
        <FormsCustomer
          v-model="customerFormState"
          :edit="customerForm"
          :refresher="loadCustomers"
        >
          <UButton icon="i-lucide-plus" color="success"
            >إضافة عميل جديد</UButton
          >
        </FormsCustomer>
      </div>
    </div>
    <UInput
      v-model="searchText"
      placeholder="بحث"
      icon="i-lucide-search"
      size="lg"
      class="mb-3 w-full sm:max-w-xs"
      />
    <USkeleton v-if="loading" class="h-24 w-full" />
    <template v-else>
      <!-- Desktop table -->
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th class="p-2 text-start font-medium">الأسم</th>
              <th class="p-2 text-start font-medium">الهاتف</th>
              <th class="p-2 text-start font-medium">الأدوات</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in paginateArray"
              :key="c.id ?? String(c.phone ?? '')"
              class="border-b border-gray-100 last:border-0 hover:bg-gray-50"
            >
              <td class="p-2 font-medium">{{ c.name }}</td>
              <td class="p-2 text-gray-600" dir="ltr">{{ c.phone }}</td>
              <td class="p-2">
                <div class="flex gap-2">
                  <UButton
                    icon="i-lucide-pencil"
                    color="success"
                    variant="soft"
                    size="xs"
                    aria-label="تعديل"
                    @click="editCustomer(c)"
                    class="flex items-center justify-center"
                    />
                  <UButton
                    v-if="isAdmin"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="soft"
                    size="xs"
                    aria-label="حذف"
                    @click="confirmDelete = c"
                    class="flex items-center justify-center"
                    />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-users"
          title="لا يوجد عملاء حتى الأن"
          />
      </div>
      <!-- Mobile cards -->
      <div class="grid gap-2 md:hidden">
        <UCard
          v-for="c in paginateArray"
          :key="c.id ?? String(c.phone ?? '')"
          variant="outline"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-bold">{{ c.name }}</div>
              <div class="text-sm text-gray-500" dir="ltr">{{ c.phone }}</div>
            </div>
            <div class="flex shrink-0 gap-2">
              <UButton
                icon="i-lucide-pencil"
                color="success"
                variant="soft"
                size="xs"
                aria-label="تعديل"
                @click="editCustomer(c)"
                class="flex items-center justify-center"
                />
              <UButton
                v-if="isAdmin"
                icon="i-lucide-trash-2"
                color="error"
                variant="soft"
                size="xs"
                aria-label="حذف"
                @click="confirmDelete = c"
                class="flex items-center justify-center"
                />
            </div>
          </div>
        </UCard>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-users"
          title="لا يوجد عملاء حتى الأن"
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
        :total="filteredItems.length"
        :items-per-page="currentPerPage"
        :sibling-count="1"
        size="sm"
        />
    </div>
    <UiAppDialog v-model:open="deleteOpen" title="هل أنت متأكد">
      <p class="mb-4 text-gray-600">
        أنت علي وشك حذف العميل {{ confirmDelete?.name }}
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
import * as XLSX from "xlsx";
import type { Customer } from "~/types";

definePageMeta({ title: "العملاء" });
function exportToExcel(): void {
  const headers = ["name", "phone"] as const;
  const orderedData = customersStore.list.map((item) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h) => (obj[h] = item[h] ?? ""));
    return obj;
  });
  const finalSheet = XLSX.utils.json_to_sheet(orderedData, {
    header: [...headers],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, finalSheet, "Sheet1");
  XLSX.writeFile(workbook, "العملاء.xlsx");
}
const customerFormState = ref(false);
const customersStore = useCustomersStore();
const searchText = ref<string>("");
const customerForm = ref<Customer>({ name: "", phone: null });
const currentPage = ref(1);
const currentPerPage = ref(10);
const saving = ref(false);
const loading = ref(false);
const deleting = ref(false);

// FLAG [B4-FIXED]: watcher instead of side-effect in computed.
watch(searchText, () => {
  currentPage.value = 1;
});

const filteredItems = computed<Customer[]>(() => {
  const q = searchText.value?.trim();
  if (!q) return [...customersStore.list];
  return customersStore.list.filter(
    (customer) =>
      customer.name?.includes(q) || String(customer.phone ?? "").includes(q),
  );
});
const paginateArray = computed(() => {
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  return filteredItems.value
    .slice(startIndex, startIndex + currentPerPage.value)
    .map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
    }));
});
async function saveProduct(isActive: { value: boolean }) {
  saving.value = true;
  try {
    if (customerForm.value.id) {
      await customersStore.updateCustomer(customerForm.value.id, {
        ...customerForm.value,
      });
    } else {
      await customersStore.addCustomer({ ...customerForm.value });
    }
    await loadCustomers();
    customerForm.value = { name: "", phone: null };
    isActive.value = false;
  } finally {
    saving.value = false;
  }
}
async function loadCustomers(): Promise<void> {
  loading.value = true;
  try {
    await customersStore.fetchCustomers();
  } finally {
    loading.value = false;
  }
}
function editCustomer(customer: Customer): void {
  customerForm.value = { ...customer };
  customerFormState.value = true;
}
const confirmDelete = ref<Customer | null>(null);
const deleteOpen = computed({
  get: () => confirmDelete.value !== null,
  set: (v: boolean) => {
    if (!v) confirmDelete.value = null;
  },
});
async function deleteConfirmed(): Promise<void> {
  const id = confirmDelete.value?.id;
  if (!id) return;
  deleting.value = true;
  try {
    await customersStore.deleteCustomer(id);
    await loadCustomers();
  } finally {
    deleting.value = false;
    confirmDelete.value = null;
  }
}
void loadCustomers();
</script>
