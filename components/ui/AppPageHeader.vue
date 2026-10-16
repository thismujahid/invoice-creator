<template>
  <header class="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
    <div class="min-w-0">
      <h1 class="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{{ title }}</h1>
      <p v-if="description" class="mt-1 text-sm text-slate-600">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>
