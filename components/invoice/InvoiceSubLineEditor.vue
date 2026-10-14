<template>
  <div class="rounded-lg border border-gray-100 bg-white p-2.5" :class="costError ? 'border-red-400!' : ''">
    <div class="mb-2 flex items-center justify-between gap-2">
      <span class="text-xs font-bold text-gray-400">{{ lineLabel }}</span>
      <div class="flex shrink-0 items-center gap-1.5">
        <UButton
          v-if="showMoveUp"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-chevron-up"
          aria-label="نقل البند لأعلى"
          class="flex items-center justify-center"
          @click="emit('move-up')"
        />
        <UButton
          v-if="showMoveDown"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-chevron-down"
          aria-label="نقل البند لأسفل"
          class="flex items-center justify-center"
          @click="emit('move-down')"
        />
        <UButton
          v-if="canRemove"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          size="xs"
          class="flex items-center justify-center"
          aria-label="حذف البند"
          @click="emit('remove')"
        />
      </div>
    </div>
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <UFormField
        v-if="familyMode !== 'independent' && familyUsesVariants"
        label="النوع"
      >
        <USelectMenu
          :model-value="(selectedProduct ?? null) as Product | undefined"
          :items="productOptions"
          label-key="variant_name"
          by="id"
          :search-term="prodSearch"
          :search-input="{ placeholder: 'بحث عن نوع...', icon: 'i-lucide-search' }"
          :ignore-filter="true"
          placeholder="اختر النوع"
          class="w-full"
          @update:search-term="(v) => emit('update:prod-search', v)"
          @update:model-value="(prod) => emit('pick-product', prod)"
        />
      </UFormField>
      <UFormField v-if="familyMode === 'independent' && familyUsesVariants" label="النوع">
        <USelectMenu
          :model-value="selectedVariant ?? undefined"
          :items="variantOptions"
          label-key="name"
          by="key"
          :search-input="{ placeholder: 'بحث عن نوع...', icon: 'i-lucide-search' }"
          placeholder="اختر النوع"
          class="w-full"
          @update:model-value="(variant) => emit('pick-variant', variant)"
        />
      </UFormField>
      <UFormField v-if="familyMode === 'independent' && showPackPicker" label="حجم العبوة">
        <USelectMenu
          :model-value="(selectedProduct ?? null) as Product | undefined"
          :items="packSizes"
          label-key="pack_size_name"
          by="id"
          :search-input="{ placeholder: 'بحث عن حجم عبوة...', icon: 'i-lucide-search' }"
          placeholder="اختر حجم العبوة"
          class="w-full"
          @update:model-value="(prod) => emit('pick-product', prod)"
        />
      </UFormField>
      <UFormField v-if="showUnitPicker" label="الوحدة">
        <USelectMenu
          :model-value="selectedUnit ?? undefined"
          :items="units"
          label-key="name"
          by="id"
          :search-input="false"
          class="w-full"
          @update:model-value="(unit) => emit('pick-unit', unit)"
        />
      </UFormField>
      <UFormField :label="qtyLabel">
        <div class="flex items-center gap-1.5">
          <UInput
            :model-value="qtyValue"
            placeholder="0"
            inputmode="numeric"
            class="min-w-0 flex-1 text-center"
            :ui="{ base: 'text-center' }"
            @update:model-value="(v) => emit('qty-input', String(v ?? ''))"
            @blur="emit('qty-blur')"
          >
            <template #leading>
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-minus"
                aria-label="تقليل الكمية"
                class="flex shrink-0 items-center justify-center"
                @click="emit('qty-step', -1)"
              />
            </template>
            <template #trailing>
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-plus"
                aria-label="زيادة الكمية"
                class="flex shrink-0 items-center justify-center"
                @click="emit('qty-step', 1)"
              />
            </template>
          </UInput>
        </div>
        <template #hint>
          <span v-if="qtyError" class="block text-xs font-bold text-red-600">{{ qtyError }}</span>
          <span v-else-if="exceedMessage" class="block text-xs font-bold text-red-600">{{ exceedMessage }}</span>
          <span v-else-if="packageMessage" class="block text-xs font-bold text-red-600">{{ packageMessage }}</span>
          <span v-else-if="stockAvailableText" class="block text-xs text-gray-400">{{ stockAvailableText }}</span>
        </template>
      </UFormField>
      <UFormField label="سعر الوحدة">
        <UInputNumber
          :model-value="form.product_price"
          locale="en-US"
          :min="0"
          :step="0.01"
          class="w-full"
          :color="costError ? 'error' : undefined"
          @update:model-value="(v) => emit('price-change', v)"
          @input="(event: Event) => emit('price-input', event)"
        />
        <template v-if="showCost || priceHint !== null" #hint>
          <span v-if="showCost && unitCostText" class="block text-xs text-gray-500">تكلفة الوحدة: {{ unitCostText }} ج</span>
          <span v-if="priceHint !== null" class="flex items-center justify-between gap-2 text-xs text-amber-700">
            <span>سعر البيع الحالي: {{ priceHintText }}</span>
            <UButton size="xs" color="warning" variant="soft" @click="emit('apply-price')">تطبيق</UButton>
          </span>
        </template>
      </UFormField>
      <UFormField label="الإجمالي">
        <UInput :model-value="lineTotalText" readonly class="w-full" />
      </UFormField>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { InvoiceProductLine, Product, ProductUnit } from "~/types";

export interface SubLineVariant {
  key: string;
  name: string;
}

defineProps<{
  form: InvoiceProductLine;
  lineLabel: string;
  familyMode: "convertible" | "independent" | null;
  familyUsesVariants: boolean;
  showPackPicker: boolean;
  variantOptions: SubLineVariant[];
  selectedVariant?: SubLineVariant | null;
  packSizes: Product[];
  productOptions: Product[];
  selectedProduct?: Product | null;
  prodSearch: string;
  units: ProductUnit[];
  selectedUnit?: ProductUnit | null;
  showUnitPicker: boolean;
  qtyLabel: string;
  qtyValue: string;
  qtyError?: string | null;
  stockAvailableText?: string | null;
  exceedMessage?: string | null;
  packageMessage?: string | null;
  priceHint: number | null;
  priceHintText?: string | null;
  showCost: boolean;
  unitCostText?: string | null;
  lineTotalText: string;
  costError: boolean;
  canRemove: boolean;
  showMoveUp: boolean;
  showMoveDown: boolean;
}>();

const emit = defineEmits<{
  "pick-variant": [variant: SubLineVariant | null | undefined];
  "pick-product": [product: Product | null | undefined];
  "update:prod-search": [value: string];
  "pick-unit": [unit: ProductUnit | undefined];
  "qty-input": [value: string];
  "qty-blur": [];
  "qty-step": [delta: number];
  "price-input": [event: Event];
  "price-change": [value: number | undefined];
  "apply-price": [];
  remove: [];
  "move-up": [];
  "move-down": [];
}>();
</script>
