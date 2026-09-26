<template>
  <USlideover
    v-if="isMobile"
    :open="open"
    :title="title"
    :description="description"
    :ui="layerUi"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <slot />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </USlideover>
  <UModal
    v-else
    :open="open"
    :title="title"
    :description="description"
    :ui="layerUi"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <slot />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UModal>
</template>

<script setup lang="ts">
// P0 wrapper: one dialog API that renders as a bottom slideover on
// phones (<640px) and a centered modal on larger screens.
const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    description?: string;
    /** Optional stacking layer (e.g. 70) so a dialog opened above another
     *  dialog renders on top (overlay + content). */
    zIndex?: number | null;
  }>(),
  { title: "", description: "", zIndex: null },
);
const emit = defineEmits(["update:open", "close"]);

// Nuxt UI merges `ui` classes over theme defaults (tailwind-merge),
// so only the z-index utilities are overridden.
const layerUi = computed(() =>
  props.zIndex
    ? { overlay: `z-[${props.zIndex}]!`, content: `z-[${props.zIndex}]!` }
    : undefined,
);

const isMobile = ref(false);
onMounted(() => {
  const mq = window.matchMedia("(max-width: 639px)");
  const sync = () => (isMobile.value = mq.matches);
  sync();
  mq.addEventListener("change", sync);
  onUnmounted(() => mq.removeEventListener("change", sync));
});
</script>
