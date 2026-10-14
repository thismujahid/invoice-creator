<template>
  <section
    class="rounded-xl border-2 border-slate-200 bg-slate-50/60 p-2.5 sm:p-3"
    :aria-label="`مجموعة ${groupTitle}`"
  >
    <header class="mb-2 flex flex-wrap items-center gap-2">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <UIcon name="i-lucide-package" class="size-4 shrink-0 text-slate-500" />
        <template v-if="isEmptyGroup">
          <USelectMenu
            :model-value="selectedFamily ?? undefined"
            :items="familyOptions"
            label-key="name"
            by="id"
            :search-input="{ placeholder: 'بحث باسم المنتج...', icon: 'i-lucide-search' }"
            placeholder="اختر المنتج الرئيسي"
            class="w-full max-w-xs"
            @update:model-value="(family) => emit('pick-family', family)"
          />
        </template>
        <h3 v-else class="min-w-0 flex-1 truncate text-sm font-extrabold text-slate-800">
          {{ groupTitle }}
        </h3>
      </div>
      <div v-if="!isEmptyGroup" class="flex shrink-0 items-center gap-1.5">
        <UBadge color="neutral" variant="soft" size="sm">إجمالي المجموعة: {{ groupTotalText }} ج</UBadge>
        <UButton
          v-if="showMoveUp"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-arrow-up"
          aria-label="نقل المجموعة لأعلى"
          class="flex items-center justify-center"
          @click="emit('move-up')"
        />
        <UButton
          v-if="showMoveDown"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-arrow-down"
          aria-label="نقل المجموعة لأسفل"
          class="flex items-center justify-center"
          @click="emit('move-down')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          :icon="collapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
          :aria-label="collapsed ? 'توسيع المجموعة' : 'طي المجموعة'"
          class="flex items-center justify-center"
          @click="collapsed = !collapsed"
        />
        <UButton
          v-if="!confirmingDelete"
          size="xs"
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          aria-label="حذف المجموعة كاملة"
          class="flex items-center justify-center"
          @click="armDelete"
        />
        <span v-else class="flex items-center gap-1">
          <UButton size="xs" color="error" @click="confirmDelete">تأكيد حذف {{ subLineCount }} بنود؟</UButton>
          <UButton size="xs" color="neutral" variant="soft" @click="confirmingDelete = false">تراجع</UButton>
        </span>
      </div>
    </header>

    <div v-show="!collapsed" class="space-y-2">
      <slot />
      <UButton
        v-if="!isEmptyGroup"
        color="primary"
        variant="soft"
        size="sm"
        icon="i-lucide-plus"
        @click="emit('add-subline')"
      >
        إضافة نوع / وحدة
      </UButton>
      <p v-else class="text-xs text-slate-500">اختر المنتج الرئيسي أولًا، ثم أضف الأنواع والوحدات من زر «إضافة نوع / وحدة».</p>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  groupTitle: string;
  groupTotalText: string;
  isEmptyGroup: boolean;
  subLineCount: number;
  showMoveUp: boolean;
  showMoveDown: boolean;
  familyOptions: { id: string; name: string }[];
  selectedFamily?: { id: string; name: string } | null;
}>();

const emit = defineEmits<{
  "pick-family": [family: { id: string; name: string } | null | undefined];
  "add-subline": [];
  "remove-group": [];
  "move-up": [];
  "move-down": [];
}>();

const collapsed = ref(false);
const confirmingDelete = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

function armDelete(): void {
  confirmingDelete.value = true;
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    confirmingDelete.value = false;
  }, 6000);
}

function confirmDelete(): void {
  if (resetTimer) clearTimeout(resetTimer);
  confirmingDelete.value = false;
  emit("remove-group");
}

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer);
});
</script>
