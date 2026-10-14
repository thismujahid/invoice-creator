<template>
  <component
    :is="embedded ? 'section' : AppDialog"
    v-model:open="open"
    :title="productForm?.id ? editorTitleEdit : editorTitleAdd"
    :z-index="60"
    width="sm:max-w-[662px]"
  >
    <div class="space-y-3">
      <UFormField
        v-if="!embedded"
        :label="editorNameLabel"
        required
        :error="errors.variant_name"
      >
        <UInput
          v-model="variantName"
          :placeholder="editorNamePlaceholder"
          size="lg"
          class="w-full"
          :disabled="saving"
        />
      </UFormField>
      <!-- Canonical stock display (read-only, edit mode only). -->
      <UAlert
        v-if="isEditMode"
        color="info"
        variant="soft"
        :title="`المخزون الحالي: ${stockDisplayText} · متوسط تكلفة ${baseNameText}: ${avgBaseText}`"
      />
      <div class="space-y-2 rounded-xl border border-gray-200 p-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <h3 class="text-sm font-bold">الوحدات وأسعارها</h3>
            <p class="mt-0.5 text-xs text-gray-500">
              {{ isIndependent ? 'العبوة المفردة هي الأساس، ويمكن إضافة كرتونة من الحجم نفسه.' : 'حدّد الوحدة الأساسية، ثم مقدار كل وحدة أو عبوة منها.' }}
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
        <p class="text-xs text-gray-500">
          أسعار البيع تتحدث تلقائيًا بنفس نسبة الربح، ويمكن تعديلها يدويًا.
        </p>
        <div class="space-y-2">
          <div
            class="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2"
          >
            <div class="min-w-0 text-xs">
              <span class="font-bold">
                {{ productForm.base_unit_name?.trim() || "وحدة" }}
              </span>
              <span class="text-gray-400"> · {{ isIndependent ? 'عبوة مفردة أساسية' : 'كمية مفردة أساسية' }} (×1)</span>
              <span
                v-if="isEditMode"
                class="mt-1 block font-semibold text-primary"
                >المتاح للبيع: {{ baseAvailability }} {{ baseNameText }}</span
              >
              <span
                v-if="basePurchasePrice != null"
                class="mt-1 block text-gray-500"
                >آخر سعر شراء مسجل:
                {{ formatePrice(basePurchasePrice) }} ج</span
              >
              <span class="mt-0.5 block text-gray-500">
                <template v-if="isEditMode"
                  >تكلفة التسعير {{ baseReferenceText }} · </template
                >سعر البيع
                {{
                  baseSalePrice == null
                    ? "—"
                    : `${formatePrice(baseSalePrice)} ج`
                }}<span v-if="isEditMode && baseSalePrice != null">
                  · هامش الربح {{ baseMarginText }}</span
                >
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
            </div>
          </div>
          <div
            v-for="(unit, index) in additionalUnits"
            :key="unit.id"
            class="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2"
          >
            <div class="min-w-0 text-xs">
              <span class="font-bold">{{
                unit.name?.trim() || "وحدة جديدة"
              }}</span>
              <span class="text-gray-400">
                · فيها {{ unit.factor }} {{ baseNameText }} ·
                {{
                  unit.stock_kind === "package" ? "عبوة مغلقة" : "كمية مفردة"
                }}
                · {{ unitUsageLabel(unit.usage) }}
              </span>
              <span class="mt-0.5 block text-gray-500">
                <template v-if="isEditMode"
                  >تكلفة التسعير {{ unitAvgText(unit) }} · </template
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
              <span
                v-if="isEditMode"
                class="mt-1 block font-semibold text-primary"
                >المتاح للبيع: {{ availableText(unit) }} {{ unit.name
                }}{{ unit.stock_kind === "package" ? " مغلقة" : "" }}</span
              >
              <span
                v-if="unit.purchase_price != null"
                class="mt-0.5 block text-gray-400"
              >
                آخر شراء: {{ formatePrice(unit.purchase_price) }} ج
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
      <div class="space-y-2 rounded-xl border border-gray-200 p-3">
        <h3 class="text-sm font-bold">تنبيهات المخزون وإعادة الطلب</h3>
        <p class="text-xs text-gray-500">
          يُقارن التنبيه بالرصيد الفعلي لكل مكوّن. اكتب 0 لإيقاف تنبيه ذلك
          المكوّن.
        </p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div class="space-y-2 rounded-lg bg-gray-50 p-3">
            <p class="text-sm font-semibold">
              {{ isIndependent ? 'العبوات المفردة' : 'الكمية المفتوحة' }} · {{ baseNameText }}
            </p>
            <UFormField label="مؤشر التنبيه">
              <UInputNumber
                v-model="looseAlert.reorder_point"
                :min="0"
                :step="isIndependent ? 1 : 0.1"
                size="lg"
                class="w-full"
                dir="ltr"
              />
            </UFormField>
            <UFormField label="المستوى المستهدف">
              <UInputNumber
                v-model="looseAlert.target_level"
                :min="0"
                :step="isIndependent ? 1 : 0.1"
                size="lg"
                class="w-full"
                dir="ltr"
                placeholder="اختياري"
              />
            </UFormField>
          </div>
          <div
            v-for="unit in packageUnits"
            :key="unit.id"
            class="space-y-2 rounded-lg bg-gray-50 p-3"
          >
            <p class="text-sm font-semibold">
              العبوات المغلقة · {{ unit.name }}
            </p>
            <UFormField label="مؤشر التنبيه">
              <UInputNumber
                v-model="packageAlerts[unit.id]!.reorder_point"
                :min="0"
                :step="1"
                size="lg"
                class="w-full"
                dir="ltr"
              />
            </UFormField>
            <UFormField label="المستوى المستهدف">
              <UInputNumber
                v-model="packageAlerts[unit.id]!.target_level"
                :min="0"
                :step="1"
                size="lg"
                class="w-full"
                dir="ltr"
                placeholder="اختياري"
              />
            </UFormField>
          </div>
        </div>
      </div>
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
            :label="
              unitDraft.isBase
                ? 'الوحدة الأساسية (ثابتة = 1)'
                : `كل ${unitDraft.name?.trim() || 'وحدة'} فيها كام ${baseNameText}؟`
            "
            required
            :error="unitModalFactorError || undefined"
          >
            <UInputNumber
              v-model="unitDraft.factor"
              :min="0.0001"
              :step="unitDraft.stock_kind === 'package' ? 1 : 0.01"
              size="lg"
              class="w-full"
              dir="ltr"
              :disabled="unitDraft.isBase || isExistingUnitDraft || saving"
              placeholder="مثال: 10 أو 0.5"
            />
          </UFormField>
          <UFormField v-if="!unitDraft.isBase" label="طريقة التخزين">
            <USelect
              v-model="unitDraft.stock_kind"
              :items="availableStockKindItems"
              value-key="value"
              label-key="label"
              size="lg"
              class="w-full"
              :disabled="isExistingUnitDraft"
            />
            <p class="mt-1 text-xs text-gray-500">
              {{ isIndependent ? 'الكرتونة تخص حجم العبوة الحالي فقط، وفتحها ينتج عبوات كاملة من الحجم نفسه.' : 'العبوة المغلقة لا تُباع إلا إذا كان لها رصيد مغلق. الكمية المفردة قد تفتح أصغر عبوة عند الحاجة.' }}
            </p>
          </UFormField>
          <p
            v-if="!unitDraft.isBase && Number(unitDraft.factor) > 0"
            class="text-sm font-semibold text-primary"
          >
            {{ unitDraft.name || "الوحدة الجديدة" }} واحدة =
            {{ unitDraft.factor }} {{ baseNameText }}
          </p>
          <p
            v-if="isExistingUnitDraft && !unitDraft.isBase"
            class="text-xs text-gray-500"
          >
            معامل الوحدة المسجلة ثابت لحماية الحركات السابقة. إذا كان غير صحيح،
            أضف وحدة بالمعامل الصحيح وراجع مخزون الوحدة القديمة قبل أرشفتها.
          </p>
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
            v-if="!isIndependent"
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
          <UFormField
            v-if="isEditMode"
            label="سعر الشراء"
            hint="مرجعي فقط — لا يغيّر متوسط التكلفة"
          >
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
          <UFormField v-else label="سعر الشراء المرجعي">
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
    <template v-if="!embedded" #footer>
      <div class="flex w-full gap-2">
        <UButton
          :loading="saving"
          color="success"
          icon="i-lucide-save"
          class="min-h-11 flex-1"
          @click="saveProduct"
          >{{
            props.edit?.id
              ? editorActionEdit
              : editorActionAdd
          }}</UButton
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
  </component>
</template>

<script setup lang="ts">
import { unitReferenceCost } from "~/functions/shared/unitPricing.mjs";
import AppDialog from "~/components/ui/AppDialog.vue";
import type { Product, ProductUnit } from "~/types";
import { unitStockDisplay } from "~/composables/finance";
import { inventoryLabel } from "../../functions/shared/inventoryCore.mjs";

const props = defineProps<{
  edit?: Product | null;
  initialFamilyName?: string;
  embedded?: boolean;
  takenNames?: string[];
  modelValue?: boolean;
  editorKind?: "variant" | "pack_size";
  inventoryMode?: "convertible" | "independent";
}>();
const emit = defineEmits<{
  done: [product: Product];
  close: [];
  "update:modelValue": [value: boolean];
}>();
const { formatePrice } = useHelpers();
type UnitUsage = "purchase" | "sell" | "both";
type EditableProductUnit = ProductUnit & { usage: UnitUsage };
function emptyForm(): Product {
  return {
    name: "",
    cost_price: null,
    base_unit_name: "وحدة",
    base_unit_id: "base",
    inventory: { loose_base_quantity: 0, closed_packages: {} },
  };
}
const productForm = ref<Product>(emptyForm());
const familyName = ref("");
const variantName = ref("");
const isIndependent = computed(() => props.inventoryMode === "independent");
const isPackSizeEditor = computed(() => props.editorKind === "pack_size");
const editorTitleAdd = computed(() => isPackSizeEditor.value ? "إضافة حجم عبوة" : "إضافة نوع");
const editorTitleEdit = computed(() => isPackSizeEditor.value ? "تعديل حجم العبوة" : "تعديل النوع");
const editorNameLabel = computed(() => isPackSizeEditor.value ? "اسم حجم العبوة" : "اسم النوع");
const editorNamePlaceholder = computed(() => isPackSizeEditor.value ? "مثال: ربع أو 100 جرام" : "مثال: معوجة");
const editorActionAdd = computed(() => isPackSizeEditor.value ? "إضافة الحجم للمسودة" : "إضافة النوع للمسودة");
const editorActionEdit = computed(() => isPackSizeEditor.value ? "تحديث الحجم في المسودة" : "تحديث النوع في المسودة");
const baseSalePrice = ref<number | null>(null);
const basePurchasePrice = ref<number | null>(null);
const baseAllowsFractional = ref(false);
const baseUsage = ref<UnitUsage>("both");
const baseHistory = ref<string | null>(null);
// Canonical cost/stock snapshot for display only (never written from here).
const canonicalCost = ref<number | null>(null);
const canonicalStock = ref<number | null>(null);
const looseAlert = ref({
  reorder_point: 0,
  target_level: null as number | null,
});
const packageAlerts = ref<
  Record<string, { reorder_point: number; target_level: number | null }>
>({});
const historyOpen = ref(false);
const historyUnitName = ref("");
const historyLog = ref<string | null>(null);
function openHistory(unitName: unknown, history: unknown): void {
  historyUnitName.value = String(unitName ?? "").trim() || "الوحدة";
  historyLog.value = typeof history === "string" ? history : null;
  historyOpen.value = true;
}
const additionalUnits = ref<EditableProductUnit[]>([]);
const packageUnits = computed(() =>
  additionalUnits.value.filter(
    (unit) => unit.stock_kind === "package" && !unit.archived,
  ),
);
const stockKindItems = [
  { label: "كمية مفردة أو مفتوحة", value: "loose" },
  { label: "عبوة مغلقة", value: "package" },
];
const availableStockKindItems = computed(() => isIndependent.value ? stockKindItems.filter((item) => item.value === "package") : stockKindItems);
const unitUsageItems = [
  { label: "للشراء فقط", value: "purchase" },
  { label: "للبيع فقط", value: "sell" },
  { label: "للشراء والبيع", value: "both" },
];
const saving = ref(false);
const submitError = ref("");
const errors = ref<{
  family_name?: string;
  variant_name?: string;
  base_sale?: string;
  base_purchase?: string;
  base_unit_name?: string;
  units?: string;
}>({});

function availableText(unit: ProductUnit): string {
  if (!props.edit?.inventory) return "—";
  return String(unitStockDisplay(props.edit, unit));
}
const baseAvailability = computed(() => {
  const unit = props.edit?.units?.find(
    (unit) => unit.id === props.edit?.base_unit_id,
  );
  return unit ? availableText(unit) : "—";
});
const baseNameText = computed(
  () => productForm.value.base_unit_name?.trim() || "وحدة",
);
const isExistingUnitDraft = computed(
  () => isEditMode.value && unitDraft.value.key !== "new",
);
const stockDisplayText = computed(() => {
  if (canonicalStock.value === null || canonicalStock.value === undefined)
    return "—";
  if (!productForm.value.inventory) return "غير مُدخل";
  const prod: Product = {
    name: variantName.value,
    cost_price: canonicalCost.value,
    stock_quantity: canonicalStock.value,
    inventory: productForm.value.inventory!,
    base_unit_id: productForm.value.base_unit_id,
    base_unit_name: productForm.value.base_unit_name,
    units: [
      {
        id: productForm.value.base_unit_id || "base",
        name: baseNameText.value,
        factor: 1,
        stock_kind: "loose",
        selling_price: baseSalePrice.value,
        is_base: true,
      },
      ...additionalUnits.value,
    ],
  };
  return inventoryLabel(prod.inventory!, prod as never);
});

const internalOpen = ref(false);
const open = computed({
  get: () => props.modelValue ?? internalOpen.value,
  set: (v: boolean) => {
    internalOpen.value = v;
    emit("update:modelValue", v);
    if (!v) emit("close");
  },
});
const isEditMode = computed(() => !!productForm.value?.id);

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
const avgBaseText = computed(() =>
  canonicalCost.value === null || canonicalCost.value === undefined
    ? isEditMode.value
      ? "—"
      : basePurchasePrice.value == null
        ? "—"
        : `${formatePrice(basePurchasePrice.value)} ج`
    : `${formatePrice(canonicalCost.value)} ج`,
);
const baseReferenceText = computed(() =>
  unitAvgText({
    id: "base",
    name: baseNameText.value,
    factor: 1,
    stock_kind: "loose",
    selling_price: baseSalePrice.value,
    purchase_price: basePurchasePrice.value,
  }),
);
function unitAvgText(unit: ProductUnit): string {
  const cost = unitReferenceCost(props.edit || {}, unit);
  return cost == null ? "—" : `${formatePrice(cost)} ج`;
}
function unitMarginText(unit: {
  selling_price: unknown;
  factor?: unknown;
  purchase_price?: number | null;
}): string {
  const cost = unitReferenceCost(props.edit || {}, {
    id: "",
    factor: Number(unit.factor),
    selling_price:
      unit.selling_price == null ? null : Number(unit.selling_price),
    purchase_price: unit.purchase_price,
  });
  if (cost == null || cost <= 0 || unit.selling_price == null) return "—";
  return `${Math.round((Number(unit.selling_price) / cost - 1) * 10000) / 100}%`;
}
const baseMarginText = computed(() =>
  baseSalePrice.value == null
    ? "—"
    : unitMarginText({
        selling_price: baseSalePrice.value,
        factor: 1,
        purchase_price: basePurchasePrice.value,
      }),
);
type UnitDraft = Omit<EditableProductUnit, "factor"> & {
  factor: number | undefined;
  key: number | "base" | "new";
  isBase: boolean;
};
const unitModalOpen = ref(false);
const unitModalError = ref("");
const unitModalFactorError = ref("");
const unitDraft = ref<UnitDraft>({
  key: "new",
  isBase: false,
  id: "",
  name: "",
  factor: 1,
  stock_kind: "package",
  selling_price: null,
  purchase_price: null,
  can_purchase: true,
  can_sell: true,
  allows_fractional: false,
  usage: "both",
});
const unitModalTitle = computed(() =>
  unitDraft.value.key === "new" ? "إضافة وحدة جديدة" : "تعديل الوحدة",
);
function openUnitModal(target: number | "base" | "new"): void {
  unitModalError.value = "";
  unitModalFactorError.value = "";
  if (target === "base") {
    unitDraft.value = {
      key: "base",
      isBase: true,
      id: productForm.value.base_unit_id || "base",
      name: productForm.value.base_unit_name ?? "",
      factor: 1,
      stock_kind: "loose",
      selling_price: baseSalePrice.value,
      purchase_price: basePurchasePrice.value,
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
      factor: undefined,
      stock_kind: "package",
      selling_price: null,
      purchase_price: null,
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
      stock_kind: unit.stock_kind,
      selling_price: unit.selling_price,
      purchase_price: unit.purchase_price ?? null,
      purchase_price_history: unit.purchase_price_history ?? null,
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
  if (isIndependent.value) {
    d.allows_fractional = false;
    if (!d.isBase) d.stock_kind = "package";
  }
  unitModalError.value = "";
  unitModalFactorError.value = "";
  if (!d.name.trim()) {
    unitModalError.value = "اسم الوحدة مطلوب.";
    return;
  }
  if (!d.isBase) {
    const f = Number(d.factor);
    if (
      !Number.isFinite(f) ||
      f <= 0 ||
      Math.abs(Math.round(f * 10000) / 10000 - f) > 1e-9 ||
      (isIndependent.value && !Number.isInteger(f))
    ) {
      unitModalFactorError.value = isIndependent.value ? "اكتب عددًا صحيحًا موجبًا من العبوات." : "اكتب معاملًا موجبًا بحد أقصى أربع منازل عشرية.";
      unitModalError.value = unitModalFactorError.value;
      return;
    }
    if (d.stock_kind === "package" && d.allows_fractional) {
      unitModalError.value = "عدد العبوات المغلقة يجب أن يكون صحيحًا.";
      return;
    }
    const clash = additionalUnits.value.some(
      (u, i) =>
        u.id !== d.id &&
        (typeof d.key === "number" ? i !== d.key : true) &&
        u.name.trim().toLocaleLowerCase() === d.name.trim().toLocaleLowerCase(),
    );
    if (clash) {
      unitModalError.value = "اسم الوحدة مكرر.";
      return;
    }
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
  if (d.isBase) {
    productForm.value.base_unit_name = d.name.trim();
    baseSalePrice.value = d.selling_price ?? null;
    basePurchasePrice.value = d.purchase_price ?? null;
    baseAllowsFractional.value = d.allows_fractional === true;
    baseUsage.value = d.usage;
  } else if (d.key === "new") {
    additionalUnits.value.push({
      id: d.id,
      name: d.name.trim(),
      factor: Number(d.factor),
      stock_kind: d.stock_kind,
      selling_price: d.selling_price ?? null,
      purchase_price: d.purchase_price ?? null,
      can_purchase: d.can_purchase,
      can_sell: d.can_sell,
      allows_fractional: d.allows_fractional === true,
      usage: d.usage,
    });
    if (d.stock_kind === "package")
      packageAlerts.value[d.id] = { reorder_point: 0, target_level: null };
  } else {
    if (typeof d.key !== "number") return;
    const unit = additionalUnits.value[d.key];
    if (!unit) return;
    unit.name = d.name.trim();
    unit.factor = Number(d.factor);
    unit.stock_kind = d.stock_kind;
    unit.usage = d.usage;
    unit.can_purchase = d.can_purchase;
    unit.can_sell = d.can_sell;
    unit.selling_price = d.selling_price ?? null;
    unit.allows_fractional = d.allows_fractional === true;
    unit.purchase_price = d.purchase_price ?? null;
  }
  unitModalOpen.value = false;
}
function setUnitUsage(
  unit: Pick<EditableProductUnit, "usage" | "can_purchase" | "can_sell">,
  usage: unknown,
): void {
  if (usage !== "purchase" && usage !== "sell" && usage !== "both") return;
  unit.usage = usage;
  unit.can_purchase = usage !== "sell";
  unit.can_sell = usage !== "purchase";
}
function setPrimaryUnit(unit: ProductUnit): void {
  productForm.value.base_unit_id = unit.id;
  productForm.value.base_unit_name = unit.name;
  baseSalePrice.value = unit.selling_price;
  basePurchasePrice.value = unit.purchase_price ?? null;
  baseAllowsFractional.value = unit.allows_fractional === true;
  baseUsage.value =
    unit.can_purchase === false
      ? "sell"
      : unit.can_sell === false
        ? "purchase"
        : "both";
  baseHistory.value = unit.purchase_price_history ?? null;
}
function removeUnit(index: number): void {
  additionalUnits.value.splice(index, 1);
}

function validate(): boolean {
  const e: typeof errors.value = {};
  const familyRes = requiredRule(
    (props.initialFamilyName || familyName.value).trim(),
  );
  const variantRes = requiredRule(variantName.value.trim());
  if (familyRes !== true) e.family_name = familyRes;
  if (variantRes !== true) e.variant_name = variantRes;
  if (
    props.takenNames?.some(
      (name) =>
        name.trim().toLocaleLowerCase() ===
        variantName.value.trim().toLocaleLowerCase(),
    )
  )
    e.variant_name = isPackSizeEditor.value ? "اسم حجم العبوة مكرر داخل النوع." : "اسم النوع مكرر داخل المنتج.";
  if (!productForm.value.base_unit_name?.trim())
    e.base_unit_name = "اسم وحدة المخزون الأساسية مطلوب.";
  const invalidLooseAlert =
    !Number.isFinite(Number(looseAlert.value.reorder_point)) ||
    Number(looseAlert.value.reorder_point) < 0 ||
    (looseAlert.value.target_level !== null &&
      (!Number.isFinite(Number(looseAlert.value.target_level)) ||
        Number(looseAlert.value.target_level) < 0));
  const invalidPackageAlert = Object.values(packageAlerts.value).some(
    (alert) =>
      !Number.isInteger(Number(alert.reorder_point)) ||
      Number(alert.reorder_point) < 0 ||
      (alert.target_level !== null &&
        (!Number.isInteger(Number(alert.target_level)) ||
          Number(alert.target_level) < 0)),
  );
  if (invalidLooseAlert || invalidPackageAlert) {
    e.units =
      "مؤشر العبوة ومستواها يجب أن يكونا عددين صحيحين؛ الكمية المفتوحة تقبل الكسور.";
  }
  if (isIndependent.value && (baseAllowsFractional.value || additionalUnits.value.some((unit) => unit.stock_kind !== "package" || !Number.isInteger(Number(unit.factor)) || unit.allows_fractional === true))) {
    e.units = "حجم العبوة لا يقبل الكسور، ووحداته الإضافية يجب أن تكون كراتين بعدد صحيح من العبوات.";
  }
  const unitIds = new Set<string>([productForm.value.base_unit_id || "base"]);
  const unitNames = new Set<string>([
    (productForm.value.base_unit_name || "").trim().toLocaleLowerCase(),
  ]);
  for (const [index, unit] of additionalUnits.value.entries()) {
    const badPurchase =
      unit.purchase_price !== null &&
      unit.purchase_price !== undefined &&
      (!Number.isFinite(Number(unit.purchase_price)) ||
        Number(unit.purchase_price) < 0);
    const f = Number(unit.factor);
    if (
      !unit.name.trim() ||
      !Number.isFinite(f) ||
      f <= 0 ||
      Math.abs(f - Math.round(f * 10000) / 10000) > 1e-9 ||
      (unit.stock_kind !== "loose" && unit.stock_kind !== "package") ||
      (unit.stock_kind === "package" && unit.allows_fractional === true) ||
      unitIds.has(unit.id) ||
      unitNames.has(unit.name.trim().toLocaleLowerCase()) ||
      badPurchase ||
      (unit.selling_price !== null &&
        unit.selling_price !== undefined &&
        (!Number.isFinite(Number(unit.selling_price)) ||
          Number(unit.selling_price) < 0))
    ) {
      e.units = `راجع بيانات الوحدة رقم ${index + 1}: الاسم والمعامل ونوع التخزين والأسعار يجب أن تكون صالحة وغير مكررة.`;
      break;
    }
    unitIds.add(unit.id);
    unitNames.add(unit.name.trim().toLocaleLowerCase());
  }
  errors.value = e;
  return Object.keys(e).length === 0;
}

function getDraft(): Product | null {
  if (!validate()) return null;
  const baseId = productForm.value.base_unit_id || "base";
  const units: ProductUnit[] = [
    {
      id: baseId,
      name: productForm.value.base_unit_name?.trim() || "وحدة",
      factor: 1,
      stock_kind: "loose",
      selling_price: baseSalePrice.value,
      purchase_price: basePurchasePrice.value,
      purchase_price_history: baseHistory.value,
      profit_margin:
        props.edit?.units?.find((unit) => unit.is_base)?.selling_price ===
        baseSalePrice.value
          ? props.edit?.units?.find((unit) => unit.is_base)?.profit_margin
          : undefined,
      is_base: true,
      can_purchase: baseUsage.value !== "sell",
      can_sell: baseUsage.value !== "purchase",
      allows_fractional: isIndependent.value ? false : baseAllowsFractional.value,
    },
    ...additionalUnits.value.map(({ usage: _usage, ...unit }) => ({
      id: unit.id,
      name: unit.name.trim(),
      factor: Number(unit.factor),
      stock_kind: unit.stock_kind,
      selling_price:
        unit.selling_price === null ? null : Number(unit.selling_price),
      purchase_price:
        unit.purchase_price === null || unit.purchase_price === undefined
          ? null
          : Number(unit.purchase_price),
      purchase_price_history: unit.purchase_price_history ?? null,
      profit_margin:
        props.edit?.units?.find((entry) => entry.id === unit.id)
          ?.selling_price === unit.selling_price
          ? unit.profit_margin
          : undefined,
      is_base: false,
      can_purchase: unit.can_purchase !== false,
      can_sell: unit.can_sell !== false,
      allows_fractional: unit.allows_fractional === true,
    })),
  ];
  const payload: Omit<Product, "id"> = {
    name: variantName.value.trim(),
    cost_price: canonicalCost.value ?? null,
    family_name: (props.initialFamilyName || familyName.value).trim(),
    variant_name: isPackSizeEditor.value ? props.edit?.variant_name || "أساسي" : variantName.value.trim(),
    inventory_mode: props.inventoryMode || props.edit?.inventory_mode || "convertible",
    pack_size_name: isPackSizeEditor.value ? variantName.value.trim() : props.edit?.pack_size_name ?? null,
    base_unit_id: baseId,
    base_unit_name: productForm.value.base_unit_name?.trim() || "وحدة",
    units,
    inventory_alerts: {
      loose: {
        reorder_point: Number(looseAlert.value.reorder_point || 0),
        target_level:
          looseAlert.value.target_level == null
            ? null
            : Number(looseAlert.value.target_level),
      },
      packages: Object.fromEntries(
        packageUnits.value.map((unit) => [
          unit.id,
          {
            reorder_point: Number(
              packageAlerts.value[unit.id]?.reorder_point || 0,
            ),
            target_level:
              packageAlerts.value[unit.id]?.target_level == null
                ? null
                : Number(packageAlerts.value[unit.id]!.target_level),
          },
        ]),
      ),
    },
    is_active: productForm.value.is_active !== false,
  };
  return {
    ...productForm.value,
    ...payload,
    units: [
      ...units,
      ...(props.edit?.units || []).filter((unit) => unit.archived),
    ],
  };
}
function saveProduct(): void {
  const product = getDraft();
  if (!product) return;
  emit("done", product);
  closeDialog();
}
defineExpose({ getDraft });

watch(
  () => props.edit,
  () => {
    const edit = props.edit as Product | undefined;
    productForm.value = edit
      ? ({ base_unit_name: "وحدة", ...editable(edit) } as Product)
      : emptyForm();
    familyName.value = edit?.family_name || props.initialFamilyName || "";
    variantName.value = isPackSizeEditor.value ? edit?.pack_size_name || "" : props.embedded ? "أساسي" : edit?.variant_name || "";
    function editable(src: Product): Product {
      const { ...rest } = src;
      return rest;
    }
    const editUnits = props.edit?.units ?? [];
    const baseEntry =
      editUnits.find((unit) => unit.is_base) ??
      editUnits.find((unit) => unit.id === props.edit?.base_unit_id) ??
      editUnits[0];
    baseSalePrice.value = baseEntry?.selling_price ?? null;
    basePurchasePrice.value = baseEntry?.purchase_price ?? null;
    baseAllowsFractional.value = isIndependent.value ? false : baseEntry?.allows_fractional === true;
    baseUsage.value =
      baseEntry?.can_purchase === false
        ? "sell"
        : baseEntry?.can_sell === false
          ? "purchase"
          : "both";
    baseHistory.value = baseEntry?.purchase_price_history ?? null;
    canonicalCost.value = props.edit?.cost_price ?? null;
    canonicalStock.value = props.edit?.stock_quantity ?? null;
    looseAlert.value = {
      reorder_point: Number(
        props.edit?.inventory_alerts?.loose?.reorder_point ?? 0,
      ),
      target_level: props.edit?.inventory_alerts?.loose?.target_level ?? null,
    };
    if (baseEntry && !editUnits.length) setPrimaryUnit(baseEntry);
    else if (baseEntry) {
      productForm.value.base_unit_id = baseEntry.id;
      productForm.value.base_unit_name = baseEntry.name;
    }
    additionalUnits.value =
      props.edit?.units
        ?.filter((unit) => unit.id !== baseEntry?.id && unit.archived !== true)
        .map((unit) => {
          const canPurchase = unit.can_purchase !== false;
          const canSell = unit.can_sell !== false;
          return {
            ...unit,
            factor: Number(unit.factor),
            selling_price: unit.selling_price ?? null,
            purchase_price: unit.purchase_price ?? null,
            can_purchase: canPurchase,
            can_sell: canSell,
            usage:
              canPurchase && canSell
                ? "both"
                : canPurchase
                  ? "purchase"
                  : "sell",
          } as EditableProductUnit;
        }) ?? [];
    packageAlerts.value = Object.fromEntries(
      packageUnits.value.map((unit) => [
        unit.id,
        {
          reorder_point: Number(
            props.edit?.inventory_alerts?.packages?.[unit.id]?.reorder_point ??
              0,
          ),
          target_level:
            props.edit?.inventory_alerts?.packages?.[unit.id]?.target_level ??
            null,
        },
      ]),
    );
    if (!props.edit) {
      familyName.value = props.initialFamilyName || "";
      variantName.value = isPackSizeEditor.value ? "" : props.embedded ? "أساسي" : "";
      if (isIndependent.value) {
        productForm.value.base_unit_id = "base";
        productForm.value.base_unit_name = "عبوة";
      }
      baseSalePrice.value = null;
      basePurchasePrice.value = null;
      baseAllowsFractional.value = false;
      baseUsage.value = "both";
      canonicalCost.value = null;
      canonicalStock.value = null;
      looseAlert.value = { reorder_point: 0, target_level: null };
      packageAlerts.value = {};
    }
  },
  { immediate: true },
);
</script>
