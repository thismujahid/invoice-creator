<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div><h1 class="text-xl font-bold">الموردون</h1><p class="text-sm text-gray-500">سجل مستقل للموردين ومشترياتهم.</p></div>
      <UButton color="success" icon="i-lucide-plus" @click="openEditor()">إضافة مورد</UButton>
    </header>
    <UInput v-model="search" icon="i-lucide-search" placeholder="ابحث عن مورد" class="w-full sm:max-w-sm" />
    <USkeleton v-if="loading" class="h-24 w-full" />
    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <UCard v-for="supplier in filtered" :key="supplier.id" variant="outline">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0"><h2 class="truncate font-bold">{{ supplier.name }}</h2><p class="text-sm text-gray-500" dir="ltr">{{ supplier.phone || '—' }}</p></div>
          <div class="flex gap-1"><UButton size="xs" color="neutral" variant="soft" icon="i-lucide-pencil" aria-label="تعديل" @click="openEditor(supplier)" /><UButton size="xs" color="error" variant="soft" icon="i-lucide-trash-2" aria-label="حذف" :disabled="deleting === supplier.id" @click="removeSupplier(supplier)" /></div>
        </div>
        <div class="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 text-center text-xs">
          <div><b class="block text-sm">{{ summaries[supplier.id || '']?.count ?? 0 }}</b><span class="text-gray-500">فواتير شراء</span></div>
          <div><b class="block text-sm">{{ formatePrice(summaries[supplier.id || '']?.total ?? 0) }} ج</b><span class="text-gray-500">إجمالي المشتريات</span></div>
          <div><b class="block text-sm text-red-600">{{ formatePrice(summaries[supplier.id || '']?.remaining ?? 0) }} ج</b><span class="text-gray-500">مستحق للمورد</span></div>
        </div>
        <div class="mt-3 flex gap-2"><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-files" class="flex-1" :to="`/supplier-invoices?supplier=${supplier.id}`">عرض الفواتير</UButton><UButton size="sm" color="success" variant="soft" icon="i-lucide-plus" class="flex-1" :to="`/supplier-invoices?supplier=${supplier.id}&new=1`">فاتورة جديدة</UButton></div>
      </UCard>
      <UEmpty v-if="!filtered.length" class="col-span-full" icon="i-lucide-truck" title="لا يوجد موردون" description="أضف الموردين لتسجيل فواتير الشراء بصورة منظمة." />
    </div>
    <UiAppDialog v-model:open="editorOpen" :title="editing?.id ? 'تعديل المورد' : 'إضافة مورد'">
      <div class="space-y-3"><UFormField label="اسم المورد" required><UInput v-model="form.name" class="w-full" /></UFormField><UFormField label="الهاتف"><UInput v-model="form.phone" dir="ltr" class="w-full" /></UFormField><UFormField label="العنوان"><UInput v-model="form.address" class="w-full" /></UFormField><UFormField label="ملاحظات"><UTextarea v-model="form.notes" class="w-full" /></UFormField><UAlert v-if="error" color="error" variant="soft" :title="error" /></div>
      <template #footer><div class="flex w-full gap-2"><UButton color="success" class="flex-1" :loading="saving" :disabled="!form.name.trim()" @click="save">حفظ المورد</UButton><UButton color="neutral" variant="soft" class="flex-1" :disabled="saving" @click="editorOpen = false">إلغاء</UButton></div></template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Supplier, PurchaseInvoice } from "~/types/finance";
import { toNum } from "~/composables/finance";
import { useSuppliersStore } from "~/stores/suppliers";

definePageMeta({ title: "الموردون" });
const store = useSuppliersStore();
const purchasing = usePurchasing();
const { formatePrice } = useHelpers();
const { notify } = useAppToast();
const loading = ref(true);
const saving = ref(false);
const deleting = ref("");
const search = ref("");
const invoices = ref<PurchaseInvoice[]>([]);
const editorOpen = ref(false);
const editing = ref<Supplier | null>(null);
const error = ref("");
const form = reactive({ name: "", phone: "", address: "", notes: "" });
const filtered = computed(() => store.list.filter((supplier) => !search.value || supplier.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const summaries = computed(() => {
  const result: Record<string, { count: number; total: number; remaining: number }> = {};
  for (const invoice of invoices.value) {
    const supplierId = invoice.supplier_id || store.list.find((supplier) => supplier.name.trim().toLocaleLowerCase() === String(invoice.supplier_name ?? "").trim().toLocaleLowerCase())?.id;
    if (!supplierId) continue;
    const sum = result[supplierId] ??= { count: 0, total: 0, remaining: 0 };
    sum.count += 1;
    sum.total += toNum(invoice.total_amount);
    sum.remaining += toNum(invoice.remaining_amount);
  }
  return result;
});
function openEditor(supplier?: Supplier): void {
  editing.value = supplier ?? null;
  form.name = supplier?.name ?? "";
  form.phone = supplier?.phone ?? "";
  form.address = supplier?.address ?? "";
  form.notes = supplier?.notes ?? "";
  error.value = "";
  editorOpen.value = true;
}
async function save(): Promise<void> {
  if (!form.name.trim() || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const payload = { name: form.name.trim(), phone: form.phone.trim() || null, address: form.address.trim() || null, notes: form.notes.trim() || null };
    if (editing.value?.id) await store.updateSupplier(editing.value.id, payload);
    else await store.addSupplier(payload);
    await store.fetchSuppliers();
    editorOpen.value = false;
  } catch {
    error.value = "تعذر حفظ بيانات المورد.";
  } finally { saving.value = false; }
}
async function removeSupplier(supplier: Supplier): Promise<void> {
  if (!supplier.id || deleting.value) return;
  deleting.value = supplier.id;
  try {
    const ok = await store.deleteSupplier(supplier.id);
    if (!ok) notify("لا يمكن حذف مورد مرتبط بفواتير شراء.", "error");
    else await store.fetchSuppliers();
  } finally { deleting.value = ""; }
}
onMounted(async () => {
  loading.value = true;
  try { await Promise.all([store.fetchSuppliers(), purchasing.fetchPurchaseInvoices().then((value) => invoices.value = value)]); }
  finally { loading.value = false; }
});
</script>
