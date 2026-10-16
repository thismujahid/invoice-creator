<template>
  <UPagination v-model:page="page" v-bind="$attrs">
    <template #item="{ item, page: currentPage }"><UButton v-if="item.type === 'page'" :label="String(item.value)" :aria-label="`الصفحة ${item.value}`" :aria-current="currentPage === item.value ? 'page' : undefined" :color="currentPage === item.value ? 'primary' : 'neutral'" :variant="currentPage === item.value ? 'solid' : 'outline'" size="sm" square /><span v-else class="px-1 text-slate-500" aria-hidden="true">…</span></template>
    <template #first><UButton icon="i-lucide-chevrons-right" color="neutral" variant="outline" size="sm" aria-label="الصفحة الأولى" /></template>
    <template #prev><UButton icon="i-lucide-chevron-right" color="neutral" variant="outline" size="sm" aria-label="الصفحة السابقة" /></template>
    <template #next><UButton icon="i-lucide-chevron-left" color="neutral" variant="outline" size="sm" aria-label="الصفحة التالية" /></template>
    <template #last><UButton icon="i-lucide-chevrons-left" color="neutral" variant="outline" size="sm" aria-label="الصفحة الأخيرة" /></template>
  </UPagination>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false });
const page = defineModel<number>("page", { required: true });
</script>
