<template>
  <span dir="ltr" class="inline-flex items-baseline whitespace-nowrap"><bdi dir="ltr" class="tabular-nums">{{ text }}</bdi></span>
</template>

<script setup lang="ts">
defineProps<{ text: string }>();
</script>
