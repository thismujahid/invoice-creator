<template>
  <USlideover
    v-if="isMobile"
    :open="open"
    :title="title"
    :description="description"
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
withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    description?: string;
  }>(),
  { title: "", description: "" },
);
const emit = defineEmits(["update:open", "close"]);

const isMobile = ref(false);
onMounted(() => {
  const mq = window.matchMedia("(max-width: 639px)");
  const sync = () => (isMobile.value = mq.matches);
  sync();
  mq.addEventListener("change", sync);
  onUnmounted(() => mq.removeEventListener("change", sync));
});
</script>
