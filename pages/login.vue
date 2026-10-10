<template>
  <div
    class="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col items-center justify-center gap-4 p-4"
    dir="rtl"
  >
    <div class="text-center">
      <h2 class="text-xl font-bold text-gray-900">قريتي</h2>
      <p class="mt-1 text-sm text-gray-500">سجّل الدخول للمتابعة إلى التطبيق</p>
      <p v-if="isOffline" class="mt-2 text-sm font-semibold text-red-600">
        لا يوجد اتصال بالإنترنت — تحقق من الشبكة ثم أعد المحاولة
      </p>
    </div>
    <FormsAuthScreen :is-in-login="true" @success="onSuccess" />
  </div>
</template>

<script setup lang="ts">
definePageMeta({ title: "تسجيل الدخول" });

const isOffline = ref(false);

function updateOnlineStatus(): void {
  isOffline.value = !navigator.onLine;
}

async function onSuccess(ok: unknown): Promise<void> {
  if (ok) await navigateTo("/", { replace: true });
}

if (import.meta.client) {
  isOffline.value = !navigator.onLine;
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
}

onUnmounted(() => {
  if (import.meta.client) {
    window.removeEventListener("online", updateOnlineStatus);
    window.removeEventListener("offline", updateOnlineStatus);
  }
});
</script>
