<template>
  <div class="rounded-xl bg-white p-3 shadow-sm sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-bold text-gray-900">الفواتير</h2>
      <div>
        <UButton
          icon="i-lucide-download"
          color="info"
          variant="soft"
          v-if="isAdmin"
          :loading="exporting"
          :disabled="loading"
          @click="startExport = true"
          >تصدير البيانات</UButton
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
    <div class="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <UInput
        v-model="searchText"
        placeholder="بحث بالاسم أو الهاتف"
        icon="i-lucide-search"
        size="lg"
        class="w-full"
        />
      <USelect
        v-if="isAdmin"
        v-model="activeUser"
        :items="userOptions"
        value-key="value"
        placeholder="منشئ الفواتير"
        size="lg"
        class="w-full"
        @update:model-value="loadInvoices"
        />
      <div class="flex gap-2">
        <UiAppDateField
          v-model="selectedDate"
          label="تاريخ الفاتورة"
          class="flex-1"
          />
        <UButton
          v-if="selectedDate"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="flex shrink-0 items-center justify-center"
          aria-label="مسح التاريخ"
          @click="
            selectedDate = null;
            loadInvoices();
          "
        />
      </div>
    </div>
    <UAlert
      v-if="isAdmin"
      color="success"
      variant="soft"
      class="mb-3"
      title="إجمالي مبيعات الفواتير المعروضة"
      :description="hideTotal ? '***********' : `${totalSales} ج.م`"
      :actions="[
        {
          label: hideTotal ? 'عرض' : 'إخفاء',
          icon: hideTotal ? 'i-lucide-eye' : 'i-lucide-eye-off',
          color: 'success',
          variant: 'ghost',
          onClick: toggleTotal,
        },
      ]"
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
    <USkeleton v-if="loading" class="h-24 w-full" />
    <template v-else>
      <!-- Desktop table -->
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th class="p-2 text-start font-medium">الأسم</th>
              <th class="p-2 text-start font-medium">الهاتف</th>
              <th class="p-2 text-start font-medium">منشئ الفاتورة</th>
              <th class="p-2 text-start font-medium">عدد المنتجات</th>
              <th class="p-2 text-start font-medium">الإجمالي</th>
              <th class="p-2 text-start font-medium">تاريخ الإنشاء</th>
              <th class="p-2 text-start font-medium">الأدوات</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in paginateArray"
              :key="row.id"
              class="border-b border-gray-100 last:border-0 hover:bg-gray-50"
            >
              <td class="p-2 font-medium">{{ row.name }}</td>
              <td class="p-2 text-gray-600" dir="ltr">{{ row.phone }}</td>
              <td class="p-2">{{ creatorName(row.created_by) }}</td>
              <td class="p-2">{{ row.products_count }}</td>
              <td class="p-2 font-semibold">{{ row.total }}</td>
              <td class="p-2 text-gray-600">{{ row.created_at }}</td>
              <td class="p-2">
                <div class="flex gap-1.5">
                  <UTooltip text="نسخ الفاتورة"
                    ><UButton
                      icon="i-lucide-copy"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="نسخ الفاتورة"
                      @click="copyInvoiceForEdit(row.invoice, true)"
                      class="flex items-center justify-center"
                    /></UTooltip>
                  <UTooltip text="تعديل الفاتورة"
                    ><UButton
                      icon="i-lucide-pencil"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="تعديل الفاتورة"
                      @click="copyInvoiceForEdit(row.invoice, false)"
                      class="flex items-center justify-center"
                    /></UTooltip>
                  <UTooltip text="عرض الفاتورة"
                    ><UButton
                      icon="i-lucide-eye"
                      color="success"
                      variant="soft"
                      size="xs"
                      aria-label="عرض الفاتورة"
                      @click="viewRow = row"
                      class="flex items-center justify-center"
                    /></UTooltip>
                  <UTooltip v-if="isAdmin" text="حذف"
                    ><UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="soft"
                      size="xs"
                      aria-label="حذف"
                      @click="confirmDelete = row"
                      class="flex items-center justify-center"
                    /></UTooltip>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-files"
          title="لا يوجد فواتير مسجلة بالمستخدم الحالي حتى الأن"
          />
      </div>
      <!-- Mobile cards -->
      <div class="grid gap-2 md:hidden">
        <UCard
          v-for="row in paginateArray"
          :key="row.id"
          variant="outline"
          @click="viewRow = row"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-bold">{{ row.name }}</div>
              <div class="text-xs text-gray-500" dir="ltr">{{ row.phone }}</div>
              <div class="mt-1 text-xs text-gray-500">
                {{ row.created_at }} • {{ row.products_count }} منتجات
              </div>
              <div class="mt-1 font-bold text-emerald-700">{{ row.total }}</div>
            </div>
            <div class="flex shrink-0 gap-1.5" @click.stop>
              <UButton
                icon="i-lucide-copy"
                color="success"
                variant="soft"
                size="xs"
                aria-label="نسخ"
                @click="copyInvoiceForEdit(row.invoice, true)"
                class="flex items-center justify-center"
                />
              <UButton
                icon="i-lucide-pencil"
                color="success"
                variant="soft"
                size="xs"
                aria-label="تعديل"
                @click="copyInvoiceForEdit(row.invoice, false)"
                class="flex items-center justify-center"
                />
              <UButton
                v-if="isAdmin"
                icon="i-lucide-trash-2"
                color="error"
                variant="soft"
                size="xs"
                aria-label="حذف"
                @click="confirmDelete = row"
                class="flex items-center justify-center"
                />
            </div>
          </div>
        </UCard>
        <UEmpty
          v-if="!paginateArray.length"
          icon="i-lucide-files"
          title="لا يوجد فواتير مسجلة بالمستخدم الحالي حتى الأن"
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
        :total="filteredInvoices.length"
        :items-per-page="currentPerPage"
        :sibling-count="1"
        size="sm"
        />
    </div>
    <!-- View invoice -->
    <UiAppDialog v-model:open="viewOpen" title="عرض الفاتورة">
      <div
        v-if="viewRow"
        class="invoice-creator-view max-h-[80vh] overflow-auto"
      >
        <Invoice
          class="mx-auto"
          :view-mode="true"
          :invoice-data="{
            ...viewRow.invoice,
            date: viewRow.created_at_object,
            time: viewRow.created_at_object,
          }"
          @close="viewRow = null"
          />
      </div>
    </UiAppDialog>
    <!-- Delete confirm -->
    <UiAppDialog v-model:open="deleteOpen" title="هل أنت متأكد">
      <p class="mb-4 text-gray-600">
        أنت علي وشك حذف الفاتورة الخاصة بـ {{ confirmDelete?.name }}
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
import type { Invoice } from "~/types";
import { toDateSafe } from "~/types";

definePageMeta({ title: "الفواتير" });
const hideTotal = ref(true);
const authStore = useAuth();
const activeUser = ref<string | null | undefined>(
  authStore.currentUserKey === "su"
    ? undefined
    : (authStore.currentUserKey as string | null | undefined),
);
const startExport = ref(false);
const selectedDate = ref<Date | null>(null);
const startViewTotal = ref(false);
const searchText = ref<string>("");
const currentPage = ref(1);
const currentPerPage = ref(10);
const loading = ref(false);
const exporting = ref(false);
const deleting = ref(false);

const userOptions = computed(() => usersList.value ?? []);

// Native date input applies immediately.
watch(selectedDate, () => {
  currentPage.value = 1;
  void loadInvoices();
});

// FLAG [B4-FIXED]: page reset moved to watcher — no side-effects inside computed.
watch(searchText, () => {
  currentPage.value = 1;
});

function formatTimestamp(
  seconds: number | undefined,
  returnObject?: false,
): string;
function formatTimestamp(seconds: number | undefined, returnObject: true): Date;
function formatTimestamp(
  seconds: number | undefined,
  returnObject?: boolean,
): string | Date {
  if (seconds === undefined || seconds === null)
    return returnObject ? new Date(0) : "-";
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
const filteredInvoices = computed<Invoice[]>(() => {
  const q = searchText.value?.trim();
  if (!q) return [...invoicesStore.list];
  return invoicesStore.list.filter(
    (invoice) =>
      invoice.customer_name?.includes(q) ||
      String(invoice.customer_phone ?? "").includes(q),
  );
});
function discountAmount(invoice: Invoice): number {
  if (invoice.discount && invoice.discount_percentage) {
    return (calcTotal(invoice) * Number(invoice.discount)) / 100;
  }
  return Number(invoice.discount || 0);
}
const sortedInvoices = computed<Invoice[]>(() =>
  [...filteredInvoices.value].sort((a, b) => {
    const da = toDateSafe(a.date)?.getTime() ?? 0;
    const db = toDateSafe(b.date)?.getTime() ?? 0;
    return db - da;
  }),
);
const paginateArray = computed(() => {
  const startIndex = (currentPage.value - 1) * currentPerPage.value;
  return sortedInvoices.value
    .slice(startIndex, startIndex + currentPerPage.value)
    .map((invoice) => ({
      id: invoice.id,
      name: invoice.customer_name,
      created_by: invoice.created_by,
      phone: invoice.customer_phone,
      products_count: invoice.products?.length || 0,
      total: formatePrice(calcTotal(invoice) - discountAmount(invoice)),
      created_at: formatTimestamp(
        (invoice.date as { seconds?: number })?.seconds,
      ),
      invoice,
      created_at_object: formatTimestamp(
        (invoice.date as { seconds?: number })?.seconds,
        true,
      ),
    }));
});
// FLAG [B1-FIXED]: clone before stripping id — never mutate the store row.
// NOTE: Firestore Timestamp class instances are NOT structuredClone-able
// (DataCloneError), so unwrap Vue reactivity with toRaw() and fall back
// to JSON on failure. Dates/Timestamps survive as ISO strings or
// {seconds,nanoseconds} plain objects — both handled by toDateSafe().
function copyInvoiceForEdit(source: Invoice, stripId: boolean): void {
  const raw = toRaw(source) as Invoice;
  let clone: Invoice;
  try {
    clone = structuredClone(raw);
  } catch {
    clone = JSON.parse(JSON.stringify(raw)) as Invoice;
  }
  if (stripId) delete clone.id;
  invoicesStore.invoiceToEdit = clone;
  navigateTo("/");
}
async function loadInvoices() {
  loading.value = true;
  try {
    await invoicesStore.fetchInvoices({
      created_by: activeUser.value ?? undefined,
      date: selectedDate.value ?? undefined,
    });
  } finally {
    loading.value = false;
  }
}
function creatorName(key: unknown): string {
  return formateActiveUserKey(key).name;
}
function toggleTotal(): void {
  if (!hideTotal.value) hideTotal.value = true;
  else startViewTotal.value = true;
}
const totalSales = computed(() =>
  formatePrice(
    filteredInvoices.value.reduce(
      (total, inv) => total + (calcTotal(inv) - discountAmount(inv)),
      0,
    ),
  ),
);
type InvoiceRow = {
  id?: string;
  name: string | null;
  created_by?: unknown;
  phone?: string | number | null;
  products_count: number;
  total: string;
  created_at: string;
  invoice: Invoice;
  created_at_object: Date;
};
const viewRow = ref<InvoiceRow | null>(null);
const viewOpen = computed({
  get: () => viewRow.value !== null,
  set: (v: boolean) => {
    if (!v) viewRow.value = null;
  },
});
const confirmDelete = ref<InvoiceRow | null>(null);
const deleteOpen = computed({
  get: () => confirmDelete.value !== null,
  set: (v: boolean) => {
    if (!v) confirmDelete.value = null;
  },
});
async function deleteConfirmed() {
  const id = confirmDelete.value?.id;
  if (!id) return;
  deleting.value = true;
  try {
    await invoicesStore.deleteInvoice(id);
  } catch (err) {
    authStore.snackBarColor = "error";
    authStore.snackBarText = String(err);
  } finally {
    await loadInvoices();
    deleting.value = false;
    confirmDelete.value = null;
  }
}
async function handleSuccess(isSuccess: boolean) {
  if (!isSuccess) {
    startExport.value = false;
    return;
  }
  exporting.value = true;
  try {
    const res = await invoicesStore.exportInvoicesToExcel(
      filteredInvoices.value,
    );
    authStore.snackBarText = res;
    authStore.snackBarColor = "success";
  } catch (err) {
    authStore.snackBarText = String(err);
    authStore.snackBarColor = "error";
  } finally {
    exporting.value = false;
    startExport.value = false;
  }
}
void loadInvoices();
</script>
