<template>
  <section class="rounded-xl border border-slate-200 bg-white p-2.5 sm:p-3">
    <InvoiceProductGroupHeader
      :title="title"
      :status-text="statusText"
      :total-text="totalText"
      :is-empty="isEmpty"
      :hide-actions="hideActions"
      :can-delete="canDelete"
      :sub-line-count="subLineCount"
      :show-move-up="showMoveUp"
      :show-move-down="showMoveDown"
      :collapsed="collapsed"
      :family-options="familyOptions"
      :selected-family="selectedFamily"
      @pick-family="(family) => emit('pick-family', family)"
      @move-up="emit('move-up')"
      @move-down="emit('move-down')"
      @toggle="collapsed = !collapsed"
      @delete="emit('delete')"
      @add-subline="emit('add-subline')"
    />
    <div v-show="!collapsed" :inert="collapsed" class="space-y-2">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{
  title: string;
  statusText: string | null;
  totalText: string;
  isEmpty: boolean;
  hideActions: boolean;
  canDelete: boolean;
  subLineCount: number;
  showMoveUp: boolean;
  showMoveDown: boolean;
  defaultCollapsed?: boolean;
  /** Parent wake signal: when it changes, force the group open (revisit). */
  wake?: number;
  familyOptions: { id: string; name: string }[];
  selectedFamily?: { id: string; name: string } | null;
}>();

const emit = defineEmits<{
  "pick-family": [family: { id: string; name: string } | null | undefined];
  "add-subline": [];
  delete: [];
  "move-up": [];
  "move-down": [];
}>();

const collapsed = ref(props.defaultCollapsed === true && !props.isEmpty);
watch(
  () => props.isEmpty,
  (empty) => {
    if (empty) collapsed.value = false;
  },
);
watch(
  () => props.wake,
  () => {
    if ((props.wake ?? 0) > 0) collapsed.value = false;
  },
);
</script>
