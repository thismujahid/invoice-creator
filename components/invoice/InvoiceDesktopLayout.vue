<template>
  <!-- RTL: the first grid item (main) sits on the right = start side in Arabic.
    Desktop ≈75% main / 25% sidebar; single stacked column below lg. -->
  <div class="invoice-desktop-layout grid items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
    <div class="min-w-0 space-y-3">
      <slot name="main" />
    </div>
    <div class="min-w-0 lg:sticky lg:top-4">
      <slot name="sidebar" />
    </div>
  </div>
</template>
