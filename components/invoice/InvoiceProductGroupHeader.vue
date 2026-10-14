<template>
  <header
    @click="emit('toggle')"
    class="mb-2 flex flex-wrap cursor-pointer items-center gap-2"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <div>
        <h3
          class="min-w-0 flex-1 truncate text-sm font-extrabold text-slate-800"
          :title="title"
        >
          {{ title }} - {{ totalText }}
        </h3>
        <p v-if="!isEmpty && statusText" class="w-full text-xs text-slate-500">
          {{ statusText }}
        </p>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1.5">
      <UButton
        size="sm"
        color="info"
        variant="solid"
        icon="i-lucide-plus"
        title="إضافة صنف أخر"
        aria-label="إضافة صنف أخر"
        class="flex min-h-6 min-w-6 items-center justify-center"
        @click.stop="openAndAdd"
      />
      <UButton
        v-if="showMoveUp"
        size="sm"
        color="neutral"
        variant="soft"
        icon="i-lucide-arrow-up"
        title="نقل المنتج لأعلى"
        aria-label="نقل المنتج لأعلى"
        class="flex min-h-6 min-w-6 items-center justify-center"
        @click="emit('move-up')"
      />
      <UButton
        v-if="showMoveDown"
        size="sm"
        color="neutral"
        variant="soft"
        icon="i-lucide-arrow-down"
        title="نقل المنتج لأسفل"
        aria-label="نقل المنتج لأسفل"
        class="flex min-h-6 min-w-6 items-center justify-center"
        @click="emit('move-down')"
      />
      <UButton
        v-if="!confirming"
        size="sm"
        color="error"
        variant="soft"
        icon="i-lucide-trash-2"
        title="حذف المنتج كاملة"
        aria-label="حذف المنتج كاملة"
        class="flex min-h-6 min-w-6 items-center justify-center"
        @click.stop="arm"
      />
      <span v-else class="flex items-center gap-1">
        <UButton size="sm" color="error" class="min-h-6" @click="confirm"
          >تأكيد حذف {{ subLineCount }} بنود؟</UButton
        >
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          class="min-h-6"
          @click.stop="confirming = false"
          >تراجع</UButton
        >
      </span>
    </div>
  </header>
</template>

<script setup lang="ts">
const props = defineProps<{
  title: string;
  statusText: string | null;
  totalText: string;
  isEmpty: boolean;
  /** The whole actions cluster hides when the group has no safe actions
   *  (sole mandatory group) instead of showing useless buttons. */
  hideActions: boolean;
  canDelete: boolean;
  subLineCount: number;
  showMoveUp: boolean;
  showMoveDown: boolean;
  collapsed: boolean;
  familyOptions: { id: string; name: string }[];
  selectedFamily?: { id: string; name: string } | null;
}>();

const emit = defineEmits<{
  "pick-family": [family: { id: string; name: string } | null | undefined];
  "move-up": [];
  "move-down": [];
  toggle: [];
  delete: [];
  "add-subline": [];
}>();

const confirming = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
function openAndAdd() {
  if (props.collapsed) {
    emit("toggle");
  }
  emit("add-subline");
}
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
