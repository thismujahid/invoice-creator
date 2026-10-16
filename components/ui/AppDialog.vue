<template>
  <!-- ClientOnly: USlideover/UModal teleport their overlay into <body>.
    Server renders a placeholder anchor; the real dialog mounts only on the
    client. Rendering them during SSR (and swapping UModal<->USlideover on
    hydration when the viewport is mobile) corrupts the teleport anchor and
    crashes hydration with "Cannot read properties of null (insertBefore)". -->
  <ClientOnly>
    <USlideover
      v-if="isMobile"
      side="bottom"
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
  </ClientOnly>
</template>

<script setup lang="ts">
// P0 wrapper: one dialog API that renders as a bottom slideover on
// phones (<640px) and a centered modal on larger screens.
const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    description?: string;
    width?: string;
    /** Optional stacking layer (e.g. 70) so a dialog opened above another
     *  dialog renders on top (overlay + content). */
    zIndex?: number | null;
  }>(),
  { title: "", description: "", width: "", zIndex: null },
);
const emit = defineEmits(["update:open", "close"]);

// Nuxt UI merges `ui` classes over theme defaults (tailwind-merge),
// so only the z-index utilities are overridden.
const layerClasses: Record<number, string> = {
  30: "z-30!",
  60: "z-60!",
  70: "z-70!",
  80: "z-80!",
  700: "z-[700]!",
};
const layerUi = computed(() => {
  const layer = props.zIndex ? layerClasses[props.zIndex] : undefined;
  const content = [props.width, layer].filter(Boolean).join(" ");
  if (!content && !props.zIndex) return undefined;
  return {
    ...(layer ? { overlay: layer } : {}),
    content: content || undefined,
  };
});

const isMobile = ref(false);
onMounted(() => {
  const mq = window.matchMedia("(max-width: 639px)");
  isMobile.value = mq.matches;
  const sync = () => {
    if (!props.open) isMobile.value = mq.matches;
  };
  mq.addEventListener("change", sync);
  onUnmounted(() => mq.removeEventListener("change", sync));
});
watch(() => props.open, (open) => {
  if (!open && import.meta.client) isMobile.value = window.matchMedia("(max-width: 639px)").matches;
});
</script>
