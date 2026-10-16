<template>
  <span class="inline-flex" @click="open = true"><slot /></span>
  <UiAppDialog v-model:open="open" :title="edit ? 'تعديل المنتج' : 'إضافة منتج'" width="sm:max-w-[760px]">
    <div class="space-y-5">
      <UFormField label="اسم المنتج" required :error="nameError || undefined">
        <UInput v-model="name" placeholder="مثال: شاي" size="lg" class="w-full" :disabled="saving" />
      </UFormField>
      <div class="space-y-3 rounded-lg border border-slate-200 p-3">
        <UFormField :error="modeError || undefined">
          <URadioGroup :model-value="inventoryMode" :items="inventoryModeItems" legend="طريقة المخزون" variant="card" size="sm" color="success" :disabled="saving || hasRecordedActivity" :ui="{ fieldset: 'grid grid-cols-1 gap-2 sm:grid-cols-2', item: 'min-h-16 p-3' }" @update:model-value="changeInventoryMode" />
        </UFormField>
        <p v-if="hasRecordedActivity" class="text-xs text-amber-700">طريقة المخزون ثابتة بعد تسجيل حركة.</p>
        <div class="border-t border-slate-100 pt-3">
          <USwitch :model-value="usesVariants" @update:model-value="changeVariantMode" label="أنواع متعددة للمنتج" :disabled="saving || typeCount > 1" />
        </div>
      </div>

      <template v-if="inventoryMode === 'convertible'">
        <template v-if="usesVariants">
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-semibold">الأنواع</h3>
            <UButton icon="i-lucide-plus" :disabled="saving || variants.length >= 40" @click="editVariant()">إضافة نوع</UButton>
          </div>
          <UEmpty v-if="!variants.length" title="لا توجد أنواع بعد" description="أضف نوعًا وحدد وحداته وأسعاره." />
          <div v-for="(variant, index) in variants" :key="variant.id || index" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
            <div><h4 class="font-semibold">{{ variant.variant_name }}</h4><p class="text-xs text-gray-500">{{ activeUnitNames(variant) }}</p></div>
            <div class="flex flex-wrap gap-2"><UButton variant="soft" color="neutral" icon="i-lucide-pencil" :disabled="saving" @click="editVariant(index)">تعديل النوع</UButton><UButton v-if="!variant.id" variant="ghost" color="error" :disabled="saving" @click="variants.splice(index, 1)">إزالة</UButton></div>
          </div>
        </template>
        <FormsProductVariant v-else :key="editorKey" ref="defaultEditor" embedded :edit="variants[0]" :initial-family-name="name" inventory-mode="convertible" />
      </template>

      <template v-else>
        <div class="flex items-center justify-between gap-2">
          <h3 class="font-semibold">{{ usesVariants ? 'الأنواع وأحجام العبوات' : 'أحجام العبوات' }}</h3>
          <UButton v-if="usesVariants" class="shrink-0 whitespace-nowrap" icon="i-lucide-plus" :disabled="saving || typeDrafts.length >= 40" @click="editType()">إضافة نوع</UButton>
          <UButton v-else icon="i-lucide-plus" :disabled="saving || variants.length >= 40" @click="editPack('default')">إضافة حجم</UButton>
        </div>
        <UEmpty v-if="usesVariants && !typeDrafts.length" title="لا توجد أنواع بعد" description="أضف نوعًا ثم حجم عبوة له." />
        <section v-for="type in visibleTypes" :key="type.key" class="space-y-3 rounded-xl border border-gray-200 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div><h4 v-if="usesVariants" class="font-semibold">{{ type.name }}</h4><p v-if="usesVariants" class="text-xs text-gray-500">{{ type.products.length === 1 ? 'حجم عبوة واحد' : `${type.products.length} أحجام عبوات` }}</p></div>
            <div class="flex flex-wrap gap-2">
              <UButton v-if="usesVariants" size="sm" icon="i-lucide-plus" @click="editPack(type.key)">إضافة حجم</UButton>
              <UButton v-if="usesVariants" size="sm" color="neutral" variant="soft" icon="i-lucide-pencil" @click="editType(type.key)">تعديل الاسم</UButton>
              <UButton v-if="usesVariants && type.products.every(product => !product.id)" size="sm" color="error" variant="ghost" @click="removeType(type.key)">إزالة</UButton>
            </div>
          </div>
          <UEmpty v-if="!type.products.length" title="لا توجد أحجام" description="أضف حجم عبوة واحدًا على الأقل لهذا النوع." />
          <div v-for="product in type.products" :key="product.id || `${type.key}-${product.pack_size_name}`" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 p-3">
            <div><h5 class="font-semibold">{{ product.pack_size_name }}</h5><p class="text-xs text-gray-500">{{ activeUnitNames(product) }}</p></div>
            <div class="flex flex-wrap gap-2"><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-pencil" @click="editPack(type.key, variants.indexOf(product))">تعديل الحجم</UButton><UButton v-if="!product.id" size="sm" color="error" variant="ghost" @click="variants.splice(variants.indexOf(product), 1)">إزالة</UButton></div>
          </div>
        </section>
      </template>
      <UAlert v-if="error" color="error" :title="error" />
    </div>
    <template #footer><div class="flex w-full gap-2"><UButton class="min-h-11 flex-1" :loading="saving" :disabled="variantOpen || packOpen || typeOpen" icon="i-lucide-save" @click="save">حفظ المنتج</UButton><UButton class="min-h-11 flex-1" color="neutral" variant="soft" :disabled="saving" @click="open = false">إلغاء</UButton></div></template>
  </UiAppDialog>

  <FormsProductVariant v-if="variantOpen" v-model="variantOpen" :edit="variantDraft" :initial-family-name="name" :taken-names="variants.filter((_, index) => index !== variantIndex).map(variant => variant.variant_name || '')" inventory-mode="convertible" @done="acceptVariant" />
  <FormsProductVariant v-if="packOpen" v-model="packOpen" :edit="packDraft" :initial-family-name="name" :taken-names="packNamesFor(packTypeKey, packIndex)" editor-kind="pack_size" inventory-mode="independent" @done="acceptPack" />
  <UiAppDialog v-model:open="typeOpen" :title="typeEditingKey ? 'تعديل النوع' : 'إضافة نوع'" :z-index="60">
    <UFormField label="اسم النوع" required :error="typeError || undefined"><UInput v-model="typeName" placeholder="مثال: أخضر" size="lg" class="w-full" /></UFormField>
    <template #footer><div class="flex w-full gap-2"><UButton class="flex-1" color="success" @click="acceptType">حفظ النوع</UButton><UButton class="flex-1" color="neutral" variant="soft" @click="typeOpen = false">إلغاء</UButton></div></template>
  </UiAppDialog>
</template>

<script setup lang="ts">
import type { InventoryMode, Product } from "~/types";
import { cloneVariantSettings, groupProductsByVariant, productFamilyKey } from "~/utils/productVariants";

const props = defineProps<{ edit?: Product | null; refresher: () => Promise<unknown> | unknown; modelValue?: boolean }>();
const emit = defineEmits<{ done: [product?: Product]; close: []; "update:modelValue": [value: boolean] }>();
const store = useProductsStore();
const internalOpen = ref(false);
const saving = ref(false);
const name = ref("");
const inventoryMode = ref<InventoryMode>("convertible");
const usesVariants = ref(false);
const variants = ref<Product[]>([]);
const typeDrafts = ref<Array<{ key: string; name: string }>>([]);
const nameError = ref("");
const modeError = ref("");
const error = ref("");
const variantOpen = ref(false);
const variantDraft = ref<Product>();
const variantIndex = ref<number | null>(null);
const packOpen = ref(false);
const packDraft = ref<Product>();
const packIndex = ref<number | null>(null);
const packTypeKey = ref("default");
const typeOpen = ref(false);
const typeName = ref("");
const typeError = ref("");
const typeEditingKey = ref<string | null>(null);
const editorKey = ref(0);
const defaultEditor = ref<{ getDraft: () => Product | null } | null>(null);
const inventoryModeItems = [
  { label: "رصيد مشترك", description: "وحدات مختلفة من نفس المخزون", value: "convertible" },
  { label: "أحجام مستقلة", description: "لكل حجم رصيد وسعر خاص", value: "independent" },
];
const open = computed({ get: () => props.modelValue ?? internalOpen.value, set: (value: boolean) => { if (saving.value) return; internalOpen.value = value; emit("update:modelValue", value); if (!value) emit("close"); } });
function copy(product: Product): Product { return JSON.parse(JSON.stringify(product)) as Product; }
function newTypeKey(): string { return typeof crypto !== "undefined" && "randomUUID" in crypto ? `type_${crypto.randomUUID()}` : `type_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
function activeUnitNames(product: Product): string { return product.units?.filter(unit => !unit.archived).map(unit => unit.name).join(" · ") || "لا توجد وحدات"; }
const hasRecordedActivity = computed(() => variants.value.some(product => Math.abs(Number(product.stock_quantity || 0)) > 1e-9 || product.last_inventory_transaction_id || product.last_purchase_invoice_id || product.units?.some(unit => !!unit.purchase_price_history)));
const typeCount = computed(() => inventoryMode.value === "independent" ? typeDrafts.value.length : variants.value.length);
const visibleTypes = computed(() => {
  if (!usesVariants.value) return [{ key: "default", name: "أساسي", products: variants.value.filter(product => (product.variant_key || "default") === "default") }];
  const grouped = new Map(groupProductsByVariant(variants.value).map(group => [group.key, group.products]));
  return typeDrafts.value.map(type => ({ ...type, products: grouped.get(type.key) || [] }));
});

watch(open, (value) => {
  if (!value) return;
  const existing = props.edit;
  name.value = existing?.family_name || existing?.name || "";
  variants.value = existing ? store.list.filter(product => productFamilyKey(product) === productFamilyKey(existing)).sort((a, b) => (a.variant_order ?? 0) - (b.variant_order ?? 0) || (a.pack_size_order ?? 0) - (b.pack_size_order ?? 0)).map(copy) : [];
  inventoryMode.value = existing?.inventory_mode === "independent" ? "independent" : "convertible";
  usesVariants.value = existing ? existing.uses_variants !== false : false;
  typeDrafts.value = inventoryMode.value === "independent" && usesVariants.value ? groupProductsByVariant(variants.value).map(group => ({ key: group.key, name: group.name })) : [];
  error.value = ""; nameError.value = ""; modeError.value = ""; editorKey.value++;
}, { immediate: true });

function changeInventoryMode(value: unknown): void {
  if (value !== "convertible" && value !== "independent") return;
  if (hasRecordedActivity.value && value !== inventoryMode.value) { modeError.value = "لا يمكن تغيير طريقة المخزون بعد تسجيل رصيد أو حركة."; return; }
  modeError.value = "";
  if (value === inventoryMode.value) return;
  if (value === "independent") {
    const keyByName = new Map<string, string>();
    variants.value = variants.value.map((product, index) => {
      const typeName = usesVariants.value ? product.variant_name || `نوع ${index + 1}` : "أساسي";
      const key = usesVariants.value ? keyByName.get(typeName) || newTypeKey() : "default";
      keyByName.set(typeName, key);
      const base = product.units?.find(unit => unit.id === product.base_unit_id) || product.units?.[0];
      return { ...copy(product), inventory_mode: "independent", variant_key: key, pack_size_name: product.pack_size_name || product.base_unit_name || "عبوة", pack_size_order: 0, base_unit_name: "عبوة", units: base ? [{ ...base, name: "عبوة", factor: 1, stock_kind: "loose", allows_fractional: false, is_base: true }] : [] };
    });
    typeDrafts.value = usesVariants.value ? [...keyByName].map(([typeName, key]) => ({ key, name: typeName })) : [];
  } else {
    if (usesVariants.value && typeDrafts.value.some(type => variants.value.filter(product => product.variant_key === type.key).length > 1)) { modeError.value = "لكل نوع أكثر من حجم عبوة. أزل الأحجام الزائدة قبل العودة للمخزون القابل للتحويل."; return; }
    variants.value = visibleTypes.value.flatMap(type => type.products.slice(0, 1).map(product => ({ ...copy(product), inventory_mode: "convertible", variant_key: null, pack_size_name: null, pack_size_order: undefined, variant_name: usesVariants.value ? type.name : "أساسي", name: usesVariants.value ? type.name : name.value })));
    typeDrafts.value = [];
  }
  inventoryMode.value = value; editorKey.value++;
}

function changeVariantMode(value: boolean): void {
  if (!value && typeCount.value > 1) return;
  if (inventoryMode.value === "convertible") {
    if (value && defaultEditor.value) { const draft = defaultEditor.value.getDraft(); if (draft && (variants.value.length || draft.units?.some(unit => unit.name !== "وحدة" || unit.selling_price != null))) variants.value = [{ ...draft, variant_name: draft.variant_name === "أساسي" ? "" : draft.variant_name }]; }
    usesVariants.value = value;
    if (value && variants.value.length === 1 && !variants.value[0]?.variant_name) editVariant(0);
    return;
  }
  if (value) {
    usesVariants.value = true;
    if (variants.value.length) { const key = newTypeKey(); typeDrafts.value = [{ key, name: "" }]; variants.value = variants.value.map(product => ({ ...product, variant_key: key, variant_name: "" })); editType(key); }
  } else {
    variants.value = variants.value.map(product => ({ ...product, variant_key: "default", variant_name: "أساسي", variant_order: 0 }));
    typeDrafts.value = []; usesVariants.value = false;
  }
}

function editVariant(index?: number): void { if (!requireName()) return; variantIndex.value = index ?? null; variantDraft.value = index === undefined ? variants.value[0] ? cloneVariantSettings(variants.value[0]) : undefined : copy(variants.value[index]!); variantOpen.value = true; }
function acceptVariant(product: Product): void { const duplicate = variants.value.some((variant, index) => index !== variantIndex.value && variant.variant_name?.trim().toLocaleLowerCase() === product.variant_name?.trim().toLocaleLowerCase()); if (duplicate) { error.value = "اسم النوع مكرر. عدّل الاسم قبل إضافته."; return; } if (variantIndex.value === null) variants.value.push(copy(product)); else variants.value[variantIndex.value] = copy(product); error.value = ""; }
function editType(key?: string): void { if (!requireName()) return; const existing = typeDrafts.value.find(type => type.key === key); typeEditingKey.value = existing?.key || null; typeName.value = existing?.name || ""; typeError.value = ""; typeOpen.value = true; }
function acceptType(): void {
  const value = typeName.value.trim();
  if (!value) { typeError.value = "اسم النوع مطلوب."; return; }
  if (typeDrafts.value.some(type => type.key !== typeEditingKey.value && type.name.toLocaleLowerCase() === value.toLocaleLowerCase())) { typeError.value = "اسم النوع مكرر داخل المنتج."; return; }
  if (typeEditingKey.value) { typeDrafts.value = typeDrafts.value.map(type => type.key === typeEditingKey.value ? { ...type, name: value } : type); variants.value = variants.value.map(product => product.variant_key === typeEditingKey.value ? { ...product, variant_name: value } : product); }
  else { const key = newTypeKey(); const first = visibleTypes.value[0]; typeDrafts.value.push({ key, name: value }); if (first?.products.length) variants.value.push(...first.products.map((source, index) => ({ ...cloneVariantSettings(source), id: undefined, updated_at: null, inventory_mode: "independent" as const, variant_key: key, variant_name: value, variant_order: typeDrafts.value.length - 1, pack_size_name: source.pack_size_name, pack_size_order: index }))); }
  typeOpen.value = false;
}
function removeType(key: string): void { variants.value = variants.value.filter(product => product.variant_key !== key); typeDrafts.value = typeDrafts.value.filter(type => type.key !== key); }
function editPack(typeKey: string, index?: number): void { if (!requireName()) return; packTypeKey.value = typeKey; packIndex.value = index ?? null; const source = index === undefined ? variants.value.find(product => product.variant_key === typeKey) || variants.value[0] : variants.value[index]; packDraft.value = index === undefined ? source ? { ...cloneVariantSettings(source), id: undefined, updated_at: null, pack_size_name: null } : undefined : copy(source!); packOpen.value = true; }
function packNamesFor(typeKey: string, excluded: number | null): string[] { return variants.value.filter((product, index) => product.variant_key === typeKey && index !== excluded).map(product => product.pack_size_name || ""); }
function acceptPack(product: Product): void {
  const type = usesVariants.value ? typeDrafts.value.find(entry => entry.key === packTypeKey.value) : { key: "default", name: "أساسي" };
  if (!type) { error.value = "النوع لم يعد موجودًا."; return; }
  const duplicate = variants.value.some((entry, index) => index !== packIndex.value && entry.variant_key === type.key && entry.pack_size_name?.trim().toLocaleLowerCase() === product.pack_size_name?.trim().toLocaleLowerCase());
  if (duplicate) { error.value = "اسم حجم العبوة مكرر داخل النوع."; return; }
  const next = { ...copy(product), inventory_mode: "independent" as const, variant_key: type.key, variant_name: type.name, uses_variants: usesVariants.value };
  if (packIndex.value === null) variants.value.push(next); else variants.value[packIndex.value] = next;
  error.value = "";
}
function requireName(): boolean { if (name.value.trim()) return true; nameError.value = "اكتب اسم المنتج أولًا."; return false; }

async function save(): Promise<void> {
  if (saving.value || variantOpen.value || packOpen.value || typeOpen.value) return;
  nameError.value = name.value.trim() ? "" : "اسم المنتج مطلوب."; error.value = "";
  if (nameError.value) return;
  if (inventoryMode.value === "convertible" && !usesVariants.value) { const draft = defaultEditor.value?.getDraft(); if (!draft) return; variants.value = [{ ...draft, variant_name: "أساسي", inventory_mode: "convertible" }]; }
  if (inventoryMode.value === "convertible" && (!variants.value.length || variants.value.some(variant => !variant.variant_name?.trim()))) { error.value = "أضف نوعًا واحدًا على الأقل وحدّد اسمه ووحداته."; return; }
  if (inventoryMode.value === "independent") {
    if (usesVariants.value && (!typeDrafts.value.length || typeDrafts.value.some(type => !type.name.trim() || !variants.value.some(product => product.variant_key === type.key)))) { error.value = "أضف حجم عبوة واحدًا على الأقل لكل نوع."; return; }
    if (!variants.value.length || variants.value.some(product => !product.pack_size_name?.trim())) { error.value = "أضف حجم عبوة واحدًا على الأقل وحدّد بياناته."; return; }
    const typeOrder = new Map((usesVariants.value ? typeDrafts.value : [{ key: "default", name: "أساسي" }]).map((type, index) => [type.key, index]));
    variants.value = variants.value.map(product => { const products = variants.value.filter(entry => entry.variant_key === product.variant_key); return { ...product, variant_order: typeOrder.get(product.variant_key || "default") ?? 0, pack_size_order: products.indexOf(product) }; });
  }
  saving.value = true;
  try { await store.saveProductFamily({ family_id: props.edit?.family_id || undefined, family_name: name.value.trim(), uses_variants: usesVariants.value, inventory_mode: inventoryMode.value, variants: variants.value }); await props.refresher(); emit("done"); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "تعذر حفظ المنتج. بياناتك محفوظة في النموذج؛ حاول مرة أخرى."; return; }
  finally { saving.value = false; }
  open.value = false;
}
</script>
