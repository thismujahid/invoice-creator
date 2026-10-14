<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-100 bg-white px-2.5 py-2"
    :class="hasError ? 'border-red-400!' : ''"
  >
    <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span class="text-xs font-bold text-gray-400 tabular-nums">{{ serial }}</span>
      <strong class="min-w-0 truncate text-sm text-gray-900" :title="title">{{ title }}</strong>
      <span class="text-xs text-gray-500">{{ qtyText }} {{ unitName }}</span>
      <span class="text-xs text-gray-500" dir="ltr">{{ priceText }}</span>
      <span class="text-sm font-extrabold tabular-nums">{{ totalText }} ج</span>
    </div>
    <div class="flex shrink-0 items-center gap-1" role="group" :aria-label="`إجراءات ${title}`">
      <UButton
        size="sm"
        color="neutral"
        variant="soft"
        icon="i-lucide-pencil"
        class="min-h-9"
        aria-label="تعديل البند"
        title="تعديل"
        @click="emit('edit')"
      ><span class="hidden xl:inline">تعديل</span></UButton
      >
      <UButton
        size="sm"
        color="neutral"
        variant="soft"
        icon="i-lucide-chevron-up"
        :disabled="!canMoveUp"
        class="flex min-h-9 min-w-9 items-center justify-center"
        aria-label="نقل البند لأعلى"
        title="نقل لأعلى"
        @click="emit('up')"
      />
      <UButton
        size="sm"
        color="neutral"
        variant="soft"
        icon="i-lucide-chevron-down"
        :disabled="!canMoveDown"
        class="flex min-h-9 min-w-9 items-center justify-center"
        aria-label="نقل البند لأسفل"
        title="نقل لأسفل"
        @click="emit('down')"
      />
      <template v-if="canDelete">
        <UButton
          v-if="!confirming"
          size="sm"
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          class="min-h-9"
          aria-label="حذف البند"
          title="حذف"
          @click="arm"
        ><span class="hidden xl:inline">حذف</span></UButton
        >
        <span v-else class="flex items-center gap-1">
          <UButton size="sm" color="error" class="min-h-9" @click="confirm">تأكيد؟</UButton>
          <UButton size="sm" color="neutral" variant="soft" class="min-h-9" @click="confirming = false">تراجع</UButton>
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  serial: number;
  title: string;
  qtyText: string | number;
  unitName: string;
  priceText: string;
  totalText: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  hasError: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  up: [];
  down: [];
  delete: [];
}>();

const confirming = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
function arm(): void {
  confirming.value = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    confirming.value = false;
  }, 6000);
}
function confirm(): void {
  if (timer) clearTimeout(timer);
  confirming.value = false;
  emit("delete");
}
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>
