<template>
  <!-- Mirrors the stats-cards grids (UCard outline: big value + small label)
    used by /invoices, /cashbox (5) and /debts (4). -->
  <div :class="gridClass" aria-hidden="true">
    <div
      v-for="i in count"
      :key="i"
      class="rounded-lg border border-gray-200 bg-white p-3"
    >
      <USkeleton class="h-7 w-2/3" />
      <USkeleton class="mt-2 h-3 w-1/2" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ count?: number }>(), {
  count: 5,
});
const gridClass = computed(() =>
  props.count === 4
    ? "mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4"
    : "mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5",
);
</script>
