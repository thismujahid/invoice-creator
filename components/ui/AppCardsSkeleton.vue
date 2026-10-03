<template>
  <!-- Mirrors the card collections: the suppliers grid
    (grid gap-3 md:grid-cols-2 xl:grid-cols-3) and the supplier-invoices
    list (space-y-3 full-width cards with an action row). -->
  <div
    :class="
      layout === 'grid' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'space-y-3'
    "
    aria-hidden="true"
  >
    <div
      v-for="i in count"
      :key="i"
      class="rounded-lg border border-gray-200 bg-white p-3"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <USkeleton class="h-5 w-1/2" />
          <USkeleton class="mt-1.5 h-4 w-1/3" />
          <USkeleton v-if="layout === 'list'" class="mt-2 h-4 w-3/4" />
        </div>
        <div class="flex shrink-0 gap-1">
          <USkeleton class="h-6 w-6 rounded-md" />
          <USkeleton class="h-6 w-6 rounded-md" />
        </div>
      </div>
      <div
        v-if="layout === 'grid'"
        class="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3"
      >
        <USkeleton v-for="j in 3" :key="j" class="h-9 w-full rounded-md" />
      </div>
      <div v-else class="mt-3 flex flex-wrap gap-1">
        <USkeleton v-for="j in 3" :key="j" class="h-8 w-20 rounded-md" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ layout?: "grid" | "list"; count?: number }>(),
  { layout: "grid", count: 6 },
);
</script>
