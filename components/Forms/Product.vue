<template>
  <span @click="openDialog" class="inline-flex">
    <slot></slot>
  </span>
  <UiAppDialog
    v-model:open="open"
    :title="productForm?.id ? 'تعديل المنتج' : 'إضافة منتج جديد'"
    width="sm:max-w-[662px]"
  >
    <div class="space-y-3">
      <UFormField label="اسم المنتج" required :error="errors.name">
        <UInput
          v-model="productForm.name"
          placeholder="اسم المنتج"
          size="lg"
          class="w-full"
          :disabled="saving"
        />
      </UFormField>
      <!-- Prices live on units now (base row below carries the base
        sale/purchase prices); no top-level price fields. -->
      <UFormField label="العدد" :error="errors.count">
        <UInputNumber
          :model-value="numOrUndef(productForm.count)"
          placeholder="العدد"
          :min="0"
          :step="0.01"
          size="lg"
          class="w-full"
          :disabled="saving"
          @update:model-value="(v) => (productForm.count = v ?? null)"
        />
      </UFormField>
      <div class="space-y-2 rounded-xl border border-gray-200 p-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <h3 class="text-sm font-bold">الوحدات وأسعارها</h3>
            <p class="text-xs text-gray-500">
              الوحدة الأساسية أولاً (سعر بيعها وشرائها إلزامي)، ثم الوحدات
              الإضافية. معامل التحويل نسبةً لوحدة المخزون الأساسية.
            </p>
          </div>
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            icon="i-lucide-plus"
            class="shrink-0 whitespace-nowrap"
            :disabled="saving"
            @click="openUnitModal('new')"
            >إضافة وحدة</UButton
          >
        </div>
        <p v-if="errors.base_sale || errors.base_purchase || errors.base_unit_name" class="text-xs text-red-600">
          {{ errors.base_sale || errors.base_purchase || errors.base_unit_name }}
        </p>
        <!-- Unit lines: compact text display (responsive) + edit/delete only -->
        <div class="space-y-2">
          <div
            class="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-2"
          >
            <div class="min-w-0 text-xs">
              <span class="font-bold">
                {{ productForm.base_unit_name?.trim() || "وحدة" }}
                <span class="font-normal text-gray-400">(أساسية)</span>
              </span>
              <span class="mt-0.5 block text-gray-500">
                بيع {{ baseSalePrice == null ? "—" : formatePrice(baseSalePrice) }}
                ·
                شراء {{ basePurchasePrice == null ? "—" : formatePrice(basePurchasePrice) }}
              </span>
            </div>
            <div class="flex shrink-0 gap-1">
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-pencil"
                aria-label="تعديل الوحدة الأساسية"
                :disabled="saving"
                @click="openUnitModal('base')"
                >تعديل</UButton
              >
            </div>
          </div>
          <div
            v-for="(unit, index) in additionalUnits"
            :key="unit.id"
            class="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2"
          >
            <div class="min-w-0 text-xs">
              <span class="font-bold">{{ unit.name?.trim() || "وحدة جديدة" }}</span>
              <span class="text-gray-400">
                تحتوى {{ unit.factor }} {{ productForm.base_unit_name?.trim() || "وحدة" }} · {{ unitUsageLabel(unit.usage) }}
              </span>
              <span class="mt-0.5 block text-gray-500">
                بيع {{ !unit.can_sell ? "لا تباع" : unit.selling_price == null ? "—" : formatePrice(unit.selling_price) }}
                ·
                شراء {{ unit.purchase_price == null ? "—" : formatePrice(unit.purchase_price) }}
              </span>
            </div>
            <div class="flex shrink-0 gap-1">
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-pencil"
                aria-label="تعديل الوحدة"
                :disabled="saving"
                @click="openUnitModal(index)"
                >تعديل</UButton
              >
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                aria-label="حذف الوحدة"
                :disabled="saving"
                @click="removeUnit(index)"
              />
            </div>
          </div>
        </div>
        <p v-if="errors.units" class="text-xs text-red-600">
          {{ errors.units }}
        </p>
      </div>
      <UFormField
        label="مؤشر نقص المخزون"
        :error="errors.low_stock_threshold"
        hint="اختر الوحدة التي يُحسب عليها الحد، ثم أدخل الرقم بعملتها (يُحوَّل تلقائيًا لوحدة المخزون)"
      >
        <div class="flex gap-2">
          <USelect
            v-model="thresholdUnitId"
            :items="thresholdUnitOptions"
            value-key="id"
            label-key="name"
            size="lg"
            class="w-36 shrink-0"
            :disabled="saving"
          />
          <UInputNumber
            v-model="thresholdInput"
            placeholder="5"
            :min="0"
            :step="0.01"
            size="lg"
            class="min-w-0 flex-1"
            :disabled="saving"
          />
        </div>
      </UFormField>
      <!-- Unit editor modal (slideover on mobile): add new or edit one row -->
      <UiAppDialog
        v-model:open="unitModalOpen"
        :title="unitModalTitle"
        :z-index="70"
      >
        <div class="space-y-3">
          <UFormField label="اسم الوحدة" required>
            <UInput
              v-model="unitDraft.name"
              placeholder="مثال: علبة، مكعب، كيس"
              size="lg"
              class="w-full"
              :disabled="saving || (unitDraft.isBase && baseUnitLocked)"
            />
          </UFormField>
          <UFormField v-if="!unitDraft.isBase" label="تحتوي وحدات أساسية" required>
            <UInputNumber
              v-model="unitDraft.factor"
              :min="1"
              :step="0.01"
              size="lg"
              class="w-full"
              dir="ltr"
            />
          </UFormField>
          <UFormField v-if="!unitDraft.isBase" label="الاستخدام">
            <USelect
              v-model="unitDraft.usage"
              :items="unitUsageItems"
              value-key="value"
              label-key="label"
              size="lg"
              class="w-full"
              @update:model-value="(usage) => setUnitUsage(unitDraft, usage)"
            />
          </UFormField>
          <UFormField v-if="unitDraft.can_sell" label="سعر البيع" required>
            <UInputNumber
              v-model="unitDraft.selling_price"
              :min="0"
              :step="0.01"
              size="lg"
              class="w-full"
              dir="ltr"
              placeholder="0"
            />
          </UFormField>
          <UFormField v-if="!isEditMode" label="سعر الشراء">
            <UInputNumber
              v-model="unitDraft.purchase_price"
              :min="0"
              :step="0.01"
              size="lg"
              class="w-full"
              dir="ltr"
              placeholder="0"
            />
          </UFormField>
          <UFormField v-else label="سعر الشراء (مرجعي، يُدار بالشراء)">
            <UInput
              :model-value="unitDraft.purchase_price == null ? '—' : formatePrice(unitDraft.purchase_price)"
              readonly
              size="lg"
              class="w-full"
              dir="ltr"
            />
          </UFormField>
          <p v-if="unitModalError" class="text-xs text-red-600">
            {{ unitModalError }}
          </p>
        </div>
        <template #footer>
          <div class="flex w-full gap-2">
            <UButton
              color="success"
              icon="i-lucide-check"
              class="min-h-11 flex-1"
              @click="confirmUnitModal"
              >تم</UButton
            >
            <UButton
              color="neutral"
              variant="soft"
              class="min-h-11 flex-1"
              @click="unitModalOpen = false"
              >إلغاء</UButton
            >
          </div>
        </template>
      </UiAppDialog>
      <UAlert
        v-if="submitError"
        color="error"
        variant="soft"
        :title="submitError"
      />
    </div>
    <template #footer>
      <div class="flex w-full gap-2">
        <UButton
          :loading="saving"
          color="success"
          icon="i-lucide-save"
          class="min-h-11 flex-1"
          @click="saveProduct"
          >حفظ</UButton
        >
        <UButton
          :disabled="saving"
          color="neutral"
          variant="soft"
          class="min-h-11 flex-1"
          @click="closeDialog"
          >إلغاء</UButton
        >
      </div>
    </template>
  </UiAppDialog>
</template>

<script setup lang="ts">
import type { Product, ProductUnit } from "~/types";

// P4: Vuetify dialog/form → UiAppDialog + inline validation.
// FLAG [B10-FIXED earlier]: duplicate-name guard kept, store ref unified.
const props = defineProps<{
  edit?: Product | null;
  refresher: () => Promise<unknown> | unknown;
  modelValue?: boolean;
}>();
const emit = defineEmits(["done", "close", "update:modelValue"]);
const productsStore = useProductsStore();
const auth = useAuth();
const { notify } = useAppToast();
const { formatePrice } = useHelpers();
type UnitUsage = "purchase" | "sell" | "both";
type EditableProductUnit = ProductUnit & { usage: UnitUsage };
function emptyForm(): Product {
  return {
    name: "",
    // Mirrors of the base unit row (kept for rules + legacy readers).
    price: null,
    cost_price: null,
    count: null,
    low_stock_threshold: 5,
    base_unit_name: "وحدة",
    base_unit_id: "base",
  };
}
const productForm = ref<Product>(emptyForm());
// Base unit row prices (the only required prices in the form).
const baseSalePrice = ref<number | null>(null);
const basePurchasePrice = ref<number | null>(null);
const additionalUnits = ref<EditableProductUnit[]>([]);
const unitUsageItems = [
  { label: "للشراء فقط", value: "purchase" },
  { label: "للبيع فقط", value: "sell" },
  { label: "للشراء والبيع", value: "both" },
];
const baseUnitLocked = computed(
  () => !!(props.edit?.base_unit_id && props.edit?.base_unit_name),
);
const saving = ref(false);
const submitError = ref("");
const errors = ref<{
  name?: string;
  base_sale?: string;
  base_purchase?: string;
  count?: string;
  low_stock_threshold?: string;
  base_unit_name?: string;
  units?: string;
}>({});

const internalOpen = ref(false);
const open = computed({
  get: () => props.modelValue ?? internalOpen.value,
  set: (v: boolean) => {
    internalOpen.value = v;
    emit("update:modelValue", v);
    if (!v) emit("close");
  },
});
// Edit mode = existing product id; creation allows entering initial costs.
const isEditMode = computed(() => !!productForm.value?.id);

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function openDialog(): void {
  submitError.value = "";
  errors.value = {};
  open.value = true;
}
function closeDialog(): void {
  open.value = false;
}

function newUnitId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `unit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function unitUsageLabel(usage: unknown): string {
  if (usage === "sell") return "بيع";
  if (usage === "purchase") return "شراء فقط";
  return "شراء وبيع";
}
// Unit editor modal: one draft edited in a focused dialog (mobile-friendly
// slideover) instead of cramped inline grid inputs.
type UnitDraft = EditableProductUnit & { key: number | "base" | "new"; isBase: boolean };
const unitModalOpen = ref(false);
const unitModalError = ref("");
const unitDraft = ref<UnitDraft>({
  key: "new",
  isBase: false,
  id: "",
  name: "",
  factor: 1,
  selling_price: null,
  purchase_price: null,
  can_purchase: true,
  can_sell: true,
  usage: "both",
});
const unitModalTitle = computed(() =>
  unitDraft.value.key === "new"
    ? "إضافة وحدة جديدة"
    : unitDraft.value.isBase
      ? "تعديل الوحدة الأساسية"
      : "تعديل الوحدة",
);
function openUnitModal(target: number | "base" | "new"): void {
  unitModalError.value = "";
  if (target === "base") {
    unitDraft.value = {
      key: "base",
      isBase: true,
      id: productForm.value.base_unit_id || "base",
      name: productForm.value.base_unit_name ?? "",
      factor: 1,
      selling_price: baseSalePrice.value,
      purchase_price: basePurchasePrice.value,
      can_purchase: true,
      can_sell: true,
      usage: "both",
    };
  } else if (target === "new") {
    unitDraft.value = {
      key: "new",
      isBase: false,
      id: newUnitId(),
      name: "",
      factor: 1,
      selling_price: null,
      purchase_price: null,
      can_purchase: true,
      can_sell: true,
      usage: "both",
    };
  } else {
    const unit = additionalUnits.value[target];
    if (!unit) return;
    unitDraft.value = {
      key: target,
      isBase: false,
      id: unit.id,
      name: unit.name,
      factor: unit.factor,
      selling_price: unit.selling_price,
      purchase_price: unit.purchase_price ?? null,
      can_purchase: unit.can_purchase ?? true,
      can_sell: unit.can_sell ?? true,
      usage: unit.usage,
    };
  }
  unitModalOpen.value = true;
}
function confirmUnitModal(): void {
  const d = unitDraft.value;
  if (!d.name.trim()) {
    unitModalError.value = "اسم الوحدة مطلوب.";
    return;
  }
  if (!d.isBase && !(Number(d.factor) > 1 && Number.isFinite(Number(d.factor)))) {
    unitModalError.value = "معامل التحويل يجب أن يكون أكبر من 1.";
    return;
  }
  if (
    d.can_sell &&
    (d.selling_price === null ||
      d.selling_price === undefined ||
      !Number.isFinite(Number(d.selling_price)) ||
      Number(d.selling_price) < 0)
  ) {
    unitModalError.value = "أدخل سعر بيع صالحًا للوحدة.";
    return;
  }
  if (
    d.purchase_price !== null &&
    d.purchase_price !== undefined &&
    (!Number.isFinite(Number(d.purchase_price)) || Number(d.purchase_price) < 0)
  ) {
    unitModalError.value = "سعر الشراء يجب أن يكون صفرًا أو رقمًا موجبًا.";
    return;
  }
  if (d.isBase) {
    productForm.value.base_unit_name = d.name.trim();
    baseSalePrice.value = d.selling_price ?? null;
    // Purchase reference is system-managed after creation.
    if (!isEditMode.value) basePurchasePrice.value = d.purchase_price ?? null;
  } else if (d.key === "new") {
    additionalUnits.value.push({
      id: d.id,
      name: d.name.trim(),
      factor: Number(d.factor),
      selling_price: d.selling_price ?? null,
      purchase_price: d.purchase_price ?? null,
      can_purchase: d.can_purchase,
      can_sell: d.can_sell,
      usage: d.usage,
    });
  } else {
    if (typeof d.key !== "number") return;
    const unit = additionalUnits.value[d.key];
    if (!unit) return;
    unit.name = d.name.trim();
    unit.factor = Number(d.factor);
    unit.usage = d.usage;
    unit.can_purchase = d.can_purchase;
    unit.can_sell = d.can_sell;
    unit.selling_price = d.selling_price ?? null;
    if (!isEditMode.value) unit.purchase_price = d.purchase_price ?? null;
  }
  unitModalOpen.value = false;
}
function setUnitUsage(unit: EditableProductUnit, usage: unknown): void {
  if (usage !== "purchase" && usage !== "sell" && usage !== "both") return;
  unit.usage = usage;
  unit.can_purchase = usage !== "sell";
  unit.can_sell = usage !== "purchase";
}
function removeUnit(index: number): void {
  additionalUnits.value.splice(index, 1);
}

// Low-stock threshold is ENTERED in the selected unit's denomination but
// STORED in base units (all readers compare base vs base). The chosen unit
// id is stored alongside for display + edit hydration.
const thresholdUnitId = ref<string>("");
const thresholdInput = ref<number | null>(5);
const thresholdUnitOptions = computed(() => [
  {
    id: productForm.value.base_unit_id || "base",
    name: productForm.value.base_unit_name?.trim() || "وحدة",
  },
  ...additionalUnits.value.map((u) => ({
    id: u.id,
    name: u.name.trim() || "وحدة جديدة",
  })),
]);
function thresholdFactor(): number {
  const baseId = productForm.value.base_unit_id || "base";
  const selected = thresholdUnitId.value || baseId;
  if (selected === baseId) return 1;
  const factor = Number(
    additionalUnits.value.find((u) => u.id === selected)?.factor,
  );
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}
// If the selected threshold unit is deleted, fall back to the base unit.
watch(thresholdUnitOptions, (options) => {
  if (
    thresholdUnitId.value &&
    !options.some((o) => o.id === thresholdUnitId.value)
  ) {
    thresholdUnitId.value = "";
  }
});

function validate(): boolean {
  const e: typeof errors.value = {};
  const nameRes = requiredRule(productForm.value.name?.trim());
  if (nameRes !== true) e.name = nameRes;
  // Base sale price is always required (it mirrors product.price).
  const saleRes = requiredRule(baseSalePrice.value);
  if (saleRes !== true) e.base_sale = "سعر بيع الوحدة الأساسية مطلوب.";
  else {
    const neg = positiveNumberRule(baseSalePrice.value);
    if (neg !== true) e.base_sale = neg;
  }
  // Base purchase price is entered on create only; edits never touch costs
  // (§7: purchase/return movements own them afterwards).
  if (!isEditMode.value) {
    const costRes = requiredRule(basePurchasePrice.value);
    if (costRes !== true) e.base_purchase = "سعر شراء الوحدة الأساسية مطلوب.";
    else {
      const neg = positiveNumberRule(basePurchasePrice.value);
      if (neg !== true) e.base_purchase = neg;
    }
  }
  // Purchase may never exceed sale on the base unit (create mode).
  if (!isEditMode.value && !e.base_sale && !e.base_purchase) {
    const cost = Number(basePurchasePrice.value);
    const price = Number(baseSalePrice.value);
    if (cost - price > 1e-9) {
      e.base_purchase = "سعر الشراء لا يمكن أن يكون أعلى من سعر البيع.";
    }
  }
  const countNeg = positiveNumberRule(productForm.value.count);
  if (countNeg !== true) e.count = countNeg;
  const thr: unknown = thresholdInput.value;
  if (thr !== null && thr !== undefined && thr !== "") {
    const thrNum = Number(thr);
    if (!Number.isFinite(thrNum) || thrNum < 0) {
      e.low_stock_threshold = "مؤشر النقص يجب أن يكون صفرًا أو رقمًا موجبًا.";
    }
  }
  if (!productForm.value.base_unit_name?.trim())
    e.base_unit_name = "اسم وحدة المخزون الأساسية مطلوب.";
  const unitIds = new Set<string>();
  for (const [index, unit] of additionalUnits.value.entries()) {
    const badPurchase =
      unit.purchase_price !== null &&
      unit.purchase_price !== undefined &&
      (!Number.isFinite(Number(unit.purchase_price)) ||
        Number(unit.purchase_price) < 0);
    if (
      !unit.name.trim() ||
      !(Number(unit.factor) > 1) ||
      !Number.isFinite(Number(unit.factor)) ||
      unitIds.has(unit.id) ||
      badPurchase ||
      (unit.can_sell &&
        (unit.selling_price === null ||
          unit.selling_price === undefined ||
          !Number.isFinite(Number(unit.selling_price)) ||
          Number(unit.selling_price) < 0))
    ) {
      e.units = `راجع بيانات الوحدة رقم ${index + 1}، وتأكد من إدخال سعر بيعها إذا كانت للبيع.`;
      break;
    }
    unitIds.add(unit.id);
  }
  errors.value = e;
  return Object.keys(e).length === 0;
}

async function saveProduct() {
  const duplicate = productsStore.list.find(
    (prod) => prod.name?.trim() === productForm.value.name?.trim(),
  );
  if (duplicate && !productForm.value?.id) {
    notify("تمت إضافة منتج بنفس الإسم من قبل", "error");
    return;
  }
  if (!validate()) return;
  saving.value = true;
  submitError.value = "";
  try {
    let id = productForm.value?.id;
    const baseId = productForm.value.base_unit_id || "base";
    // Mirror the base row into the legacy top-level fields so rules and
    // legacy readers keep working unchanged.
    productForm.value.price = baseSalePrice.value;
    if (!productForm.value?.id) {
      productForm.value.cost_price = basePurchasePrice.value;
    }
    // Convert the entered threshold (in the selected unit) to base units.
    const thrBaseId = productForm.value.base_unit_id || "base";
    const thrUnitId = thresholdUnitId.value || thrBaseId;
    const thrRaw: unknown = thresholdInput.value;
    productForm.value.low_stock_threshold =
      thrRaw === null || thrRaw === undefined || thrRaw === ""
        ? 5
        : Number(thrRaw) * thresholdFactor();
    productForm.value.low_stock_unit_id = thrUnitId;
    const units: ProductUnit[] = [
      {
        id: baseId,
        name: productForm.value.base_unit_name?.trim() || "وحدة",
        factor: 1,
        selling_price: baseSalePrice.value,
        purchase_price: basePurchasePrice.value,
        is_base: true,
        can_purchase: true,
        can_sell: true,
      },
      ...additionalUnits.value.map(({ usage: _usage, ...unit }) => ({
        ...unit,
        name: unit.name.trim(),
        factor: Number(unit.factor),
        selling_price:
          unit.selling_price === null ? null : Number(unit.selling_price),
        purchase_price:
          unit.purchase_price === null || unit.purchase_price === undefined
            ? null
            : Number(unit.purchase_price),
        is_base: false,
      })),
    ];
    if (productForm.value?.id) {
      // Edit mode never writes cost_price (§7: system-managed).
      const { cost_price: _locked, ...editData } = productForm.value;
      void _locked;
      editData.low_stock_threshold = productForm.value.low_stock_threshold ?? 5;
      await productsStore.updateProduct(productForm.value.id, {
        ...editData,
        base_unit_id: baseId,
        units,
      });
    } else {
      const created = (await productsStore.addProduct({
        ...productForm.value,
        units,
        low_stock_threshold: productForm.value.low_stock_threshold ?? 5,
      })) as { id?: string } | null;
      id = created?.id;
    }
    await props.refresher();
    emit(
      "done",
      productsStore.list.find((prod) => prod.id === id),
    );
    productForm.value = emptyForm();
    baseSalePrice.value = null;
    basePurchasePrice.value = null;
    thresholdUnitId.value = "";
    thresholdInput.value = 5;
    additionalUnits.value = [];
    closeDialog();
  } catch (err) {
    submitError.value = String(err);
    notify(String(err), "error");
  } finally {
    saving.value = false;
  }
}
watch(
  () => props.edit,
  () => {
    productForm.value = props.edit
      ? { low_stock_threshold: 5, base_unit_name: "وحدة", ...props.edit }
      : emptyForm();
    const editUnits = props.edit?.units ?? [];
    const baseEntry =
      editUnits.find((unit) => unit.is_base) ??
      editUnits.find((unit) => unit.id === props.edit?.base_unit_id);
    baseSalePrice.value =
      baseEntry?.selling_price ?? props.edit?.price ?? null;
    basePurchasePrice.value =
      baseEntry?.purchase_price ?? props.edit?.cost_price ?? null;
    additionalUnits.value =
      props.edit?.units
        ?.filter(
          (unit) => !unit.is_base && unit.id !== props.edit?.base_unit_id,
        )
        .map((unit) => {
          const canPurchase = unit.can_purchase !== false;
          const canSell = unit.can_sell !== false;
          const legacySalePrice =
            (unit.selling_price === null || unit.selling_price === undefined) &&
            unit.can_sell === undefined
              ? (props.edit?.price ?? null)
              : unit.selling_price;
          return {
            ...unit,
            selling_price: legacySalePrice,
            purchase_price: unit.purchase_price ?? null,
            can_purchase: canPurchase,
            can_sell: canSell,
            usage:
              canPurchase && canSell
                ? "both"
                : canPurchase
                  ? "purchase"
                  : "sell",
          };
        }) ?? [];
    // Hydrate the threshold in its stored unit's denomination (fallback to
    // base units when the unit is gone — e.g. legacy docs or deleted units).
    if (props.edit) {
      const thrBase = Number(props.edit.low_stock_threshold ?? 5);
      const thrUnit = additionalUnits.value.find(
        (u) => u.id === props.edit?.low_stock_unit_id,
      );
      const thrFactor = Number(thrUnit?.factor);
      if (thrUnit && Number.isFinite(thrFactor) && thrFactor > 0) {
        thresholdUnitId.value = thrUnit.id;
        thresholdInput.value = thrBase / thrFactor;
      } else {
        thresholdUnitId.value = "";
        thresholdInput.value = Number.isFinite(thrBase) ? thrBase : 5;
      }
    }
    if (!props.edit) {
      baseSalePrice.value = null;
      basePurchasePrice.value = null;
      thresholdUnitId.value = "";
      thresholdInput.value = 5;
    }
  },
  { immediate: true },
);
</script>
