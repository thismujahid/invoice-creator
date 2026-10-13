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
      <div class="space-y-2 rounded-xl border border-gray-200 p-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <h3 class="text-sm font-bold">الوحدات وأسعارها</h3>
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
        <p
          v-if="
            errors.base_sale || errors.base_purchase || errors.base_unit_name
          "
          class="text-xs text-red-600"
        >
          {{
            errors.base_sale || errors.base_purchase || errors.base_unit_name
          }}
        </p>
        <!-- Unit lines: compact text display (responsive) + edit/delete only -->
        <div class="space-y-2">
          <div
            class="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2"
          >
            <div class="min-w-0 text-xs">
              <span class="font-bold">
                {{ productForm.base_unit_name?.trim() || "وحدة" }}
              </span>
              <span class="mt-0.5 block text-gray-500">
                <template v-if="isEditMode"
                  >التكلفة {{ avgBaseText }} · </template
                >سعر البيع
                {{
                  baseSalePrice == null
                    ? "—"
                    : `${formatePrice(baseSalePrice)} ج`
                }}<span v-if="isEditMode && baseSalePrice != null">
                  · هامش الربح {{ baseMarginText }}</span
                >
              </span>
              <span class="mt-0.5 block text-gray-500">
                مؤشر النقص:
                {{
                  baseThreshold == null
                    ? "—"
                    : `${baseThreshold} ${productForm.base_unit_name?.trim() || "وحدة"}`
                }}
              </span>
            </div>
            <div class="flex shrink-0 gap-1">
              <UButton
                v-if="baseHistory"
                size="xs"
                color="info"
                variant="soft"
                icon="i-lucide-history"
                aria-label="تطور سعر الشراء"
                :disabled="saving"
                @click="openHistory(productForm.base_unit_name, baseHistory)"
                >السعر</UButton
              >
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-pencil"
                aria-label="تعديل الوحدة"
                :disabled="saving"
                @click="openUnitModal('base')"
                >تعديل</UButton
              >
              <UButton
                v-if="additionalUnits.length > 0"
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                aria-label="حذف الوحدة"
                :disabled="saving"
                @click="removeUnit('base')"
              />
            </div>
          </div>
          <div
            v-for="(unit, index) in additionalUnits"
            :key="unit.id"
            class="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2"
          >
            <div class="min-w-0 text-xs">
              <span class="font-bold"
                >{{ unit.name?.trim() || "وحدة جديدة" }}</span
              >
              <span class="text-gray-400">
                · {{ unitUsageLabel(unit.usage) }}
              </span>
              <span class="mt-0.5 block text-gray-500">
                <template v-if="isEditMode"
                  >التكلفة {{ unitAvgText(unit) }} · </template
                >سعر البيع
                {{
                  !unit.can_sell
                    ? "لا تباع"
                    : unit.selling_price == null
                      ? "—"
                      : `${formatePrice(unit.selling_price)} ج`
                }}<span
                  v-if="
                    isEditMode && unit.can_sell && unit.selling_price != null
                  "
                >
                  · هامش الربح {{ unitMarginText(unit) }}</span
                >
              </span>
              <span class="mt-0.5 block text-gray-500">
                مؤشر النقص:
                {{
                  unit.low_stock_threshold == null
                    ? "—"
                    : `${unit.low_stock_threshold} ${unit.name?.trim() || "وحدة"}`
                }}
              </span>
            </div>
            <div class="flex shrink-0 gap-1">
              <UButton
                v-if="unit.purchase_price_history"
                size="xs"
                color="info"
                variant="soft"
                icon="i-lucide-history"
                aria-label="تطور سعر الشراء"
                :disabled="saving"
                @click="openHistory(unit.name, unit.purchase_price_history)"
                >السعر</UButton
              >
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
                v-if="additionalUnits.length > 0"
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
      <!-- Unit-level shortage thresholds live on each unit row (edited
        inside the unit dialog below); there is no product-level threshold. -->
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
              :disabled="saving"
            />
          </UFormField>
          <UFormField
            label="مؤشر نقص المخزون"
            hint="بهذه الوحدة — اتركه فارغًا لتعطيل التنبيه لها"
          >
            <UInputNumber
              v-model="unitDraft.low_stock_threshold"
              :min="0"
              :step="1"
              size="lg"
              class="w-full"
              dir="ltr"
              placeholder="بدون تنبيه"
            />
          </UFormField>
          <UFormField label="الاستخدام">
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
          <UCheckbox
            v-model="unitDraft.allows_fractional"
            label="تقبل الكسور"
          />
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
              :model-value="
                unitDraft.purchase_price == null
                  ? '—'
                  : formatePrice(unitDraft.purchase_price)
              "
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
      <ProductsPriceHistoryDialog
        v-model:open="historyOpen"
        :unit-name="historyUnitName"
        :history="historyLog"
      />
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
    base_unit_name: "وحدة",
    base_unit_id: "base",
  };
}
const productForm = ref<Product>(emptyForm());
// Base unit row prices (the only required prices in the form).
const baseSalePrice = ref<number | null>(null);
const basePurchasePrice = ref<number | null>(null);
// Shortage threshold of the BASE unit, in base-unit terms (null = no alert).
const baseThreshold = ref<number | null>(null);
const baseAllowsFractional = ref(false);
const baseUsage = ref<UnitUsage>("both");
// Purchase-price history log of the BASE unit (reference only, never edited).
const baseHistory = ref<string | null>(null);
const baseUnitSnapshot = ref<ProductUnit | null>(null);
const historyOpen = ref(false);
const historyUnitName = ref("");
const historyLog = ref<string | null>(null);
function openHistory(unitName: unknown, history: unknown): void {
  historyUnitName.value = String(unitName ?? "").trim() || "الوحدة";
  historyLog.value = typeof history === "string" ? history : null;
  historyOpen.value = true;
}
const additionalUnits = ref<EditableProductUnit[]>([]);
const unitUsageItems = [
  { label: "للشراء فقط", value: "purchase" },
  { label: "للبيع فقط", value: "sell" },
  { label: "للشراء والبيع", value: "both" },
];
const saving = ref(false);
const submitError = ref("");
const errors = ref<{
  name?: string;
  base_sale?: string;
  base_purchase?: string;
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
// Canonical display: average cost derived from base average (never stored per-unit).
const avgBaseValue = computed(() => {
  const raw = (baseUnitSnapshot.value?.average_cost ??
    basePurchasePrice.value) as unknown;
  if (raw === null || raw === undefined || raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
});
const avgBaseText = computed(() =>
  avgBaseValue.value === null ? "—" : `${formatePrice(avgBaseValue.value)} ج`,
);
function unitAvgText(unit: ProductUnit): string {
  const avg = unit.average_cost ?? unit.purchase_price;
  return avg == null ? "—" : `${formatePrice(avg)} ج`;
}
function unitMarginText(unit: {
  selling_price: unknown;
  average_cost?: number | null;
  purchase_price?: number | null;
}): string {
  const avg = unit.average_cost ?? unit.purchase_price;
  if (
    avg == null ||
    unit.selling_price === null ||
    unit.selling_price === undefined
  )
    return "—";
  if (!(avg > 0)) return "—";
  const rate = (Number(unit.selling_price) - avg) / avg;
  return `${Math.round(rate * 10000) / 100}%`;
}
// Base unit margin (factor 1) for the base row's cost/price/margin line.
const baseMarginText = computed(() =>
  baseSalePrice.value == null
    ? "—"
    : unitMarginText({ selling_price: baseSalePrice.value, average_cost: avgBaseValue.value }),
);
// Unit editor modal: one draft edited in a focused dialog (mobile-friendly
// slideover) instead of cramped inline grid inputs.
type UnitDraft = EditableProductUnit & {
  key: number | "base" | "new";
  isBase: boolean;
};
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
  low_stock_threshold: null,
  can_purchase: true,
  can_sell: true,
  allows_fractional: false,
  usage: "both",
});
const unitModalTitle = computed(() =>
  unitDraft.value.key === "new"
    ? "إضافة وحدة جديدة"
    : unitDraft.value.isBase
      ? "تعديل الوحدة"
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
      low_stock_threshold: baseThreshold.value,
      can_purchase: baseUsage.value !== "sell",
      can_sell: baseUsage.value !== "purchase",
      allows_fractional: baseAllowsFractional.value,
      usage: baseUsage.value,
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
      low_stock_threshold: null,
      can_purchase: true,
      can_sell: true,
      allows_fractional: false,
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
      low_stock_threshold: unit.low_stock_threshold ?? null,
      can_purchase: unit.can_purchase ?? true,
      can_sell: unit.can_sell ?? true,
      allows_fractional: unit.allows_fractional === true,
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
  if (
    d.selling_price !== null &&
    d.selling_price !== undefined &&
    (!Number.isFinite(Number(d.selling_price)) || Number(d.selling_price) < 0)
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
  // Per-unit shortage threshold in the unit's own denomination.
  // Empty = no alert for this unit.
  const rawThr: unknown = d.low_stock_threshold;
  const normThr =
    rawThr === null || rawThr === undefined || rawThr === ""
      ? null
      : Number(rawThr);
  if (normThr !== null && (!Number.isFinite(normThr) || normThr < 0)) {
    unitModalError.value = "مؤشر النقص يجب أن يكون صفرًا أو رقمًا موجبًا.";
    return;
  }
  if (d.isBase) {
    productForm.value.base_unit_name = d.name.trim();
    baseSalePrice.value = d.selling_price ?? null;
    baseThreshold.value = normThr;
    baseAllowsFractional.value = d.allows_fractional === true;
    baseUsage.value = d.usage;
    // Purchase reference is system-managed after creation.
    if (!isEditMode.value) basePurchasePrice.value = d.purchase_price ?? null;
  } else if (d.key === "new") {
    additionalUnits.value.push({
      id: d.id,
      name: d.name.trim(),
      factor: 1,
      selling_price: d.selling_price ?? null,
      purchase_price: d.purchase_price ?? null,
      low_stock_threshold: normThr,
      can_purchase: d.can_purchase,
      can_sell: d.can_sell,
      allows_fractional: d.allows_fractional === true,
      usage: d.usage,
    });
  } else {
    if (typeof d.key !== "number") return;
    const unit = additionalUnits.value[d.key];
    if (!unit) return;
    unit.name = d.name.trim();
    unit.factor = 1;
    unit.usage = d.usage;
    unit.can_purchase = d.can_purchase;
    unit.can_sell = d.can_sell;
    unit.selling_price = d.selling_price ?? null;
    unit.allows_fractional = d.allows_fractional === true;
    unit.low_stock_threshold = normThr;
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
function setPrimaryUnit(unit: ProductUnit): void {
  baseUnitSnapshot.value = { ...unit };
  productForm.value.base_unit_id = unit.id;
  productForm.value.base_unit_name = unit.name;
  baseSalePrice.value = unit.selling_price;
  basePurchasePrice.value = unit.purchase_price ?? null;
  baseThreshold.value = unit.low_stock_threshold ?? null;
  baseAllowsFractional.value = unit.allows_fractional === true;
  baseUsage.value = unit.can_purchase === false ? "sell" : unit.can_sell === false ? "purchase" : "both";
  baseHistory.value = unit.purchase_price_history ?? null;
}
function removeUnit(index: number | "base"): void {
  if (!additionalUnits.value.length) return;
  if (index === "base") {
    const next = additionalUnits.value.shift();
    if (next) setPrimaryUnit(next);
    return;
  }
  additionalUnits.value.splice(index, 1);
}

// Shortage thresholds live on the units themselves (each in its unit's own
// denomination); the legacy product-level threshold is no longer edited here.
function validate(): boolean {
  const e: typeof errors.value = {};
  const nameRes = requiredRule(productForm.value.name?.trim());
  if (nameRes !== true) e.name = nameRes;
  if (!productForm.value.base_unit_name?.trim())
    e.base_unit_name = "اسم وحدة المخزون الأساسية مطلوب.";
  const unitIds = new Set<string>();
  for (const [index, unit] of additionalUnits.value.entries()) {
    const badPurchase =
      unit.purchase_price !== null &&
      unit.purchase_price !== undefined &&
      (!Number.isFinite(Number(unit.purchase_price)) ||
        Number(unit.purchase_price) < 0);
    const rawThr: unknown = unit.low_stock_threshold;
    const badThreshold =
      rawThr !== null &&
      rawThr !== undefined &&
      rawThr !== "" &&
      (!Number.isFinite(Number(rawThr)) || Number(rawThr) < 0);
    if (
      !unit.name.trim() ||
      !Number.isFinite(Number(unit.factor)) ||
      Number(unit.factor) !== 1 ||
      unitIds.has(unit.id) ||
      badPurchase ||
      badThreshold ||
      (unit.selling_price !== null &&
        unit.selling_price !== undefined &&
        (!Number.isFinite(Number(unit.selling_price)) ||
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
    productForm.value.price = null;
    productForm.value.cost_price = null;
    // Shortage thresholds are stored per unit, each in its unit's own
    // denomination. The legacy product-level fields are never written.
    const units: ProductUnit[] = [
      {
        ...baseUnitSnapshot.value,
        id: baseId,
        name: productForm.value.base_unit_name?.trim() || "وحدة",
        factor: 1,
        selling_price: baseSalePrice.value,
        purchase_price: basePurchasePrice.value,
        low_stock_threshold: baseThreshold.value ?? null,
        is_base: true,
        can_purchase: baseUsage.value !== "sell",
        can_sell: baseUsage.value !== "purchase",
        allows_fractional: baseAllowsFractional.value,
        stock_quantity: baseUnitSnapshot.value?.stock_quantity ?? 0,
        average_cost: baseUnitSnapshot.value?.average_cost ?? basePurchasePrice.value ?? 0,
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
        low_stock_threshold:
          unit.low_stock_threshold === null ||
          unit.low_stock_threshold === undefined ||
          (unit.low_stock_threshold as unknown) === ""
            ? null
            : Number(unit.low_stock_threshold),
        is_base: false,
        stock_quantity: Number(unit.stock_quantity ?? 0),
        average_cost: Number(unit.average_cost ?? unit.purchase_price ?? 0),
      })),
    ];
    // Strip the legacy product-level threshold (old docs keep theirs; new
    // writes only carry per-unit thresholds).
    const {
      low_stock_threshold: _legacyThreshold,
      low_stock_unit_id: _legacyUnit,
      base_unit_name: _legacyBaseName,
      base_unit_id: _legacyBaseId,
      ...cleanData
    } = productForm.value;
    void _legacyThreshold;
    void _legacyUnit;
    void _legacyBaseName;
    void _legacyBaseId;
    if (productForm.value?.id) {
      // Edit mode never writes cost_price (§7: system-managed).
      const { cost_price: _locked, ...editData } = cleanData;
      void _locked;
      await productsStore.updateProduct(productForm.value.id, {
        ...editData,
        units,
      });
    } else {
      const created = (await productsStore.addProduct({
        ...cleanData,
        units,
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
    baseThreshold.value = null;
    baseAllowsFractional.value = false;
    baseUsage.value = "both";
    baseHistory.value = null;
    baseUnitSnapshot.value = null;
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
    const edit = props.edit as
      | (Product & { count?: number | null })
      | undefined;
    const { count: _legacyCount, ...editable } = edit ?? {};
    void _legacyCount;
    productForm.value = edit
      ? ({
          base_unit_name: "وحدة",
          ...editable,
        } as Product)
      : emptyForm();
    const editUnits = props.edit?.units ?? [];
    const baseEntry =
      editUnits.find((unit) => unit.is_base) ??
      editUnits.find((unit) => unit.id === props.edit?.base_unit_id) ?? editUnits[0];
    baseSalePrice.value = baseEntry?.selling_price ?? props.edit?.price ?? null;
    basePurchasePrice.value =
      baseEntry?.purchase_price ?? props.edit?.cost_price ?? null;
    // Per-unit thresholds hydrate as stored (each in its unit's own
    // denomination); units without one simply show no alert.
    baseThreshold.value = baseEntry?.low_stock_threshold ?? null;
    baseAllowsFractional.value = baseEntry?.allows_fractional === true;
    baseUsage.value =
      baseEntry?.can_purchase === false
        ? "sell"
        : baseEntry?.can_sell === false
          ? "purchase"
          : "both";
    baseHistory.value = baseEntry?.purchase_price_history ?? null;
    baseUnitSnapshot.value = null;
    if (baseEntry) setPrimaryUnit(baseEntry);
    additionalUnits.value =
      props.edit?.units
        ?.filter(
          (unit) => unit.id !== baseEntry?.id,
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
            low_stock_threshold: unit.low_stock_threshold ?? null,
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
    if (!props.edit) {
      baseSalePrice.value = null;
      basePurchasePrice.value = null;
      baseThreshold.value = null;
      baseAllowsFractional.value = false;
      baseUsage.value = "both";
    }
  },
  { immediate: true },
);
</script>
