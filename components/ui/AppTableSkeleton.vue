<template>
  <!-- Mirrors the desktop data tables (header row + body rows with an
    action button) used by /products, /customers, /debts, /invoices. -->
  <div
    class="overflow-hidden rounded-lg border border-gray-200 bg-white"
    aria-hidden="true"
  >
    <div class="border-b border-gray-200 bg-gray-50 p-2.5">
      <USkeleton class="h-4 w-full" />
    </div>
    <div class="divide-y divide-gray-100">
      <div
        v-for="i in rows"
        :key="i"
        class="flex items-center gap-3 p-2.5"
      >
        <USkeleton class="h-4 w-1/4 shrink-0" />
        <USkeleton class="h-4 min-w-0 flex-1" />
        <USkeleton class="hidden h-4 w-1/6 shrink-0 sm:block" />
        <USkeleton class="h-7 w-16 shrink-0 rounded-md" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 6 });
</script>
