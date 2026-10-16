<template>
  <div class="space-y-4">
    <UiAppPageHeader title="الموردون" description="سجل مستقل للموردين ومشترياتهم">
      <template #actions>
      <UButton color="success" icon="i-lucide-plus" @click="openEditor()">إضافة مورد</UButton>
      </template>
    </UiAppPageHeader>
    <UInput v-model="search" icon="i-lucide-search" aria-label="بحث عن مورد" placeholder="ابحث عن مورد" class="w-full sm:max-w-sm" />
    <UAlert v-if="store.fetchError || loadError" color="error" variant="soft" :title="store.fetchError || loadError"><template #actions><UButton color="error" variant="soft" @click="loadSuppliers">إعادة المحاولة</UButton></template></UAlert>
    <UiAppCardsSkeleton v-if="loading" />
    <template v-else>
    <div class="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white lg:block">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-600"><tr><th class="p-3 text-start">المورد</th><th class="p-3 text-start">فواتير شراء</th><th class="p-3 text-start">إجمالي المشتريات</th><th class="p-3 text-start">مستحق للمورد</th><th class="p-3 text-start">سلفة لنا</th><th class="p-3 text-start">الإجراءات</th></tr></thead>
        <tbody><tr v-for="supplier in filtered" :key="supplier.id" class="border-t border-slate-100 hover:bg-slate-50">
          <td class="p-3"><div class="font-semibold">{{ supplier.name }}</div><bdi dir="ltr" class="text-xs text-slate-600">{{ supplier.phone || '—' }}</bdi></td>
          <td class="p-3">{{ summaries[supplier.id || '']?.initialized ? summaries[supplier.id || '']?.count : '—' }}</td>
          <td class="p-3"> <UiAppMoneyDisplay v-if="summaries[supplier.id || '']?.initialized" :text="formatePrice(summaries[supplier.id || '']?.total)" /><span v-else>—</span></td>
          <td class="p-3 text-red-700"><UiAppMoneyDisplay v-if="summaries[supplier.id || '']?.initialized" :text="formatePrice(summaries[supplier.id || '']?.remaining)" /><span v-else>—</span></td>
          <td class="p-3 text-blue-700"><UiAppMoneyDisplay v-if="summaries[supplier.id || '']?.initialized" :text="formatePrice(summaries[supplier.id || '']?.advance)" /><span v-else>—</span></td>
          <td class="p-3"><div class="flex flex-wrap gap-1"><UButton size="sm" color="neutral" variant="soft" :to="`/supplier-invoices?supplier=${supplier.id}`">الفواتير</UButton><UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="`تعديل ${supplier.name}`" @click="openEditor(supplier)" /><UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`حذف ${supplier.name}`" @click="deleteTarget = supplier" /></div></td>
        </tr></tbody>
      </table>
    </div>
    <div class="grid gap-3 md:grid-cols-2 lg:hidden">
      <UCard v-for="supplier in filtered" :key="supplier.id" variant="outline">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0"><h2 class="truncate font-bold">{{ supplier.name }}</h2><bdi dir="ltr" class="block text-sm text-gray-500">{{ supplier.phone || '—' }}</bdi></div>
          <div class="flex gap-1"><UButton size="xs" color="neutral" variant="soft" icon="i-lucide-pencil" class="min-h-11 min-w-11" :aria-label="`تعديل ${supplier.name}`" @click="openEditor(supplier)" /><UButton size="xs" color="error" variant="soft" icon="i-lucide-trash-2" class="min-h-11 min-w-11" :aria-label="`حذف ${supplier.name}`" :disabled="deleting === supplier.id" @click="deleteTarget = supplier" /></div>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2 border-t border-gray-100 pt-3 text-center text-xs sm:grid-cols-4">
          <div><b class="block text-sm">{{ summaries[supplier.id || '']?.initialized ? summaries[supplier.id || '']?.count : '—' }}</b><span class="text-gray-500">فواتير شراء</span></div>
          <div><b class="block text-sm"><UiAppMoneyDisplay v-if="summaries[supplier.id || '']?.initialized" :text="formatePrice(summaries[supplier.id || '']?.total)" /><span v-else>—</span></b><span class="text-gray-500">إجمالي المشتريات</span></div>
          <div><b class="block text-sm text-red-600"><UiAppMoneyDisplay v-if="summaries[supplier.id || '']?.initialized" :text="formatePrice(summaries[supplier.id || '']?.remaining)" /><span v-else>—</span></b><span class="text-gray-500">مستحق للمورد</span></div>
          <div><b class="block text-sm text-blue-700"><UiAppMoneyDisplay v-if="summaries[supplier.id || '']?.initialized" :text="formatePrice(summaries[supplier.id || '']?.advance)" /><span v-else>—</span></b><span class="text-gray-500">سلفة مستحقة لنا</span></div>
        </div>
        <p v-if="summaries[supplier.id || '']?.initialized" class="mt-2 text-xs text-gray-600">فرق تكلفة مرتجعات المورد: <UiAppMoneyDisplay :text="formatePrice(summaries[supplier.id || '']?.variance)" /></p>
        <div class="mt-3 flex gap-2"><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-files" class="min-h-11 flex-1" :to="`/supplier-invoices?supplier=${supplier.id}`">عرض الفواتير</UButton><UButton size="sm" color="success" variant="soft" icon="i-lucide-plus" class="min-h-11 flex-1" :to="`/supplier-invoices?supplier=${supplier.id}&new=1`">فاتورة جديدة</UButton></div>
      </UCard>
    </div>
    <UEmpty v-if="!filtered.length && !store.fetchError && !loadError" icon="i-lucide-truck" title="لا يوجد موردون" description="أضف الموردين لتسجيل فواتير الشراء بصورة منظمة." />
    </template>
    <FormsSupplier v-model="editorOpen" :edit="editing" :refresher="loadSuppliers" />
    <UiAppDialog :open="!!deleteTarget" title="تأكيد حذف المورد" @update:open="(open) => { if (!open) deleteTarget = null; }">
      <p>هل تريد حذف {{ deleteTarget?.name }}؟ لا يمكن حذف مورد مرتبط بفواتير شراء.</p>
      <template #footer><div class="flex w-full gap-2"><UButton color="error" class="flex-1" :loading="!!deleting" @click="confirmSupplierDelete">تأكيد الحذف</UButton><UButton color="neutral" variant="soft" class="flex-1" @click="deleteTarget = null">إلغاء</UButton></div></template>
    </UiAppDialog>
  </div>
</template>

<script setup lang="ts">
import type { Supplier } from "~/types/finance";
import { collection, getDocs } from "firebase/firestore";
import { useSuppliersStore } from "~/stores/suppliers";

definePageMeta({ title: "الموردون" });
const store = useSuppliersStore();
const { formatePrice } = useHelpers();
const { notify } = useAppToast();
const loading = ref(true);
const deleting = ref("");
const deleteTarget = ref<Supplier | null>(null);
const search = ref("");
const summaries = ref<Record<string, { count: number; total: number; remaining: number; advance: number; variance: number; initialized: boolean }>>({});
const editorOpen = ref(false);
const editing = ref<Supplier | null>(null);
const loadError = ref("");
const filtered = computed(() => store.list.filter((supplier) => {
  const query = search.value.trim().toLocaleLowerCase();
  return !query || supplier.name.toLocaleLowerCase().includes(query) || String(supplier.phone ?? "").includes(query);
}));
function openEditor(supplier?: Supplier): void {
  editing.value = supplier ?? null;
  editorOpen.value = true;
}
async function removeSupplier(supplier: Supplier): Promise<boolean> {
  if (!supplier.id || deleting.value) return false;
  deleting.value = supplier.id;
  try {
    const ok = await store.deleteSupplier(supplier.id);
    if (!ok) {
      notify("تعذر حذف المورد. قد يكون مرتبطًا بفواتير شراء؛ تحقق ثم أعد المحاولة.", "error");
      return false;
    }
    await store.fetchSuppliers();
    return true;
  } catch (error) {
    console.error(error);
    notify("تعذر حذف المورد. أعد المحاولة.", "error");
    return false;
  } finally { deleting.value = ""; }
}
async function confirmSupplierDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  if (await removeSupplier(target)) deleteTarget.value = null;
}
async function loadSuppliers(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    const { db } = useFirebase();
    const [_, snapshot] = await Promise.all([store.fetchSuppliers(), getDocs(collection(db, "supplier_summaries"))]);
    if (store.fetchError) return;
    const result: typeof summaries.value = {};
    for (const item of snapshot.docs) {
      const data = item.data();
      result[data.supplier_id || item.id] = {
        count: Math.max(0, Number(data.invoice_count) || 0),
        total: Math.max(0, Number(data.total_purchases) || 0),
        remaining: Math.max(0, Number(data.outstanding_payable) || 0),
        advance: Math.max(0, Number(data.advance_receivable) || 0),
        variance: Number(data.return_cost_variance) || 0,
        initialized: data.initialized === true,
      };
    }
    summaries.value = result;
  } catch {
    loadError.value = "تعذر تحميل ملخصات الموردين. أعد المحاولة.";
  }
  finally { loading.value = false; }
}
onMounted(async () => {
  const authed = await useAuthReady();
  if (!authed) return;
  await loadSuppliers();
});
</script>
