<template>
  <!-- P0: native date input = OS picker on mobile, zero deps, RTL-safe.
       UCalendar needs @internationalized/date values; revisit in P4 if a
       custom calendar is wanted. -->
  <UInput
    :model-value="iso"
    type="date"
    :label="label"
    class="w-full"
    @update:model-value="onInput"
    :trailing-icon="iconTrilling"
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: Date | null | undefined;
  label?: string;
  iconTrilling?: string;
}>();
const emit = defineEmits(["update:modelValue"]);

const iso = computed(() => {
  const v = props.modelValue;
  if (!(v instanceof Date) || isNaN(v.getTime())) return "";
  const y = v.getFullYear();
  const m = String(v.getMonth() + 1).padStart(2, "0");
  const d = String(v.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
});

function onInput(v: string | number | undefined) {
  if (typeof v !== "string" || !v) {
    emit("update:modelValue", null);
    return;
  }
  const d = new Date(`${v}T00:00:00`);
  emit("update:modelValue", isNaN(d.getTime()) ? null : d);
}
</script>
