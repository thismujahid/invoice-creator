<template>
  <div class="invoice-desktop-layout grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)] xl:grid-rows-[auto_1fr]">
    <div class="min-w-0 xl:col-start-2 xl:row-start-1">
      <slot name="customer" />
    </div>
    <div class="min-w-0 space-y-3 xl:col-start-1 xl:row-span-2 xl:row-start-1">
      <slot name="main" />
    </div>
    <div class="min-w-0 xl:sticky xl:top-20 xl:col-start-2 xl:row-start-2">
      <slot name="payment" />
    </div>
  </div>
</template>
