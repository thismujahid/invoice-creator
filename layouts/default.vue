<template>
  <!-- Shell: fixed vertical icon rail on the far right (RTL start) is the
       ONLY navigation — no drawer, no hamburger, no bottom tab-bar. -->
  <div id="app-shell" class="flex min-h-dvh flex-col bg-gray-50" dir="rtl">
    <!-- Top bar -->
    <header
      class="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur"
    >
      <div
        class="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-3 sm:px-4"
      >
        <h1 class="min-w-0 flex-1 truncate text-base font-bold text-gray-900">
          قريتي
          <span v-if="currentPageTitle" class="font-normal text-gray-500"
            >| {{ currentPageTitle }}</span
          >
        </h1>
        <span class="hidden shrink-0 text-xs text-gray-400 md:block">{{
          todayLine
        }}</span>
        <UDropdownMenu :items="userMenu">
          <div
            class="flex shrink-0 cursor-pointer items-center gap-2 rounded-full py-1 pe-1 ps-1"
          >
            <UAvatar
              :text="userDetails.avatar_text"
              color="success"
              size="md"
            />
            <div class="hidden leading-tight sm:block">
              <div class="text-sm font-semibold">{{ userDetails.name }}</div>
              <div class="text-xs text-gray-500">
                {{ userDetails.position }}
              </div>
            </div>
          </div>
        </UDropdownMenu>
      </div>
    </header>

    <!-- Body: desktop nav rail (right in RTL) + page -->
    <div
      class="mx-auto flex w-full max-w-6xl min-w-0 flex-1 items-start gap-3 px-3 py-4 md:px-4"
    >
      <aside
        class="sticky top-18 bottom-none z-20 hidden w-32 shrink-0 flex-col items-center rounded-lg border border-gray-200 bg-white py-3 md:py-0 shadow-sm sm:flex"
        aria-label="التنقل الرئيسي"
      >
        <UButton
          v-for="item in tabItems"
          :key="item.to"
          :icon="item.icon"
          :variant="isActiveTab(item.to) ? 'solid' : 'ghost'"
          :color="isActiveTab(item.to) ? 'success' : 'neutral'"
          :aria-label="item.label"
          class="flex w-full flex-row items-center justify-start"
          @click="navigateTo(item.to)"
        >
          {{ item.label }}</UButton
        >
      </aside>

      <main class="min-w-0 flex-1">
        <slot />
      </main>
    </div>

    <footer class="border-t border-white/10 bg-neutral-950 py-1.5 text-center">
      <p class="text-[11px] font-normal text-gray-400">
        برمجة وتطوير:
        <NuxtLink
          target="_blank"
          class="text-gray-300 no-underline hover:underline"
          href="https://mejo.dev"
          >محمد إبراهيم مجاهد</NuxtLink
        >
        <span class="mx-1 text-gray-600">•</span>
        جميع الحقوق محفوظة @ {{ new Date().getFullYear() }}
      </p>
    </footer>

    <UiAppDialog v-model:open="logoutConfirm" title="هل أنت متأكد">
      <p class="mb-4 text-gray-600">أنت علي وشك تسجيل الخروج وإغلاق التطبيق</p>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton color="error" block :loading="loggingOut" @click="logout"
            >تأكيد الإغلاق</UButton
          >
          <UButton
            color="neutral"
            variant="ghost"
            block
            @click="logoutConfirm = false"
            >إلغاء</UButton
          >
        </div>
      </template>
    </UiAppDialog>

    <!-- Mobile bottom bar: exactly 4 primary items; المزيد opens the rest -->
    <nav
      class="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      aria-label="التنقل السريع"
    >
      <div
        v-if="moreOpen"
        class="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
      >
        <button
          v-for="item in secondaryItems"
          :key="item.to"
          class="flex w-full items-center gap-2 px-3 py-2.5 text-sm"
          :class="
            isActiveTab(item.to)
              ? 'font-bold text-emerald-600'
              : 'text-gray-700'
          "
          @click="goSecondary(item.to)"
        >
          <UIcon :name="item.icon" class="size-5 shrink-0" />
          {{ item.label }}
        </button>
      </div>
      <div class="grid grid-cols-4">
        <button
          v-for="item in primaryItems"
          :key="item.to"
          :aria-label="item.label"
          :aria-current="isActiveTab(item.to) ? 'page' : undefined"
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] leading-none"
          :class="
            isActiveTab(item.to)
              ? 'font-bold text-emerald-600'
              : 'text-gray-500'
          "
          @click="navigateTo(item.to)"
        >
          <UIcon :name="item.icon" class="size-5" />
          {{ item.label }}
        </button>
        <button
          aria-label="المزيد"
          :aria-expanded="moreOpen"
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] leading-none"
          :class="moreActive ? 'font-bold text-emerald-600' : 'text-gray-500'"
          @click="moreOpen = !moreOpen"
        >
          <UIcon name="i-lucide-ellipsis" class="size-5" />
          المزيد
        </button>
      </div>
    </nav>
    <!-- Spacer so the fixed bar never covers footer content on mobile -->
    <div
      aria-hidden="true"
      class="h-[calc(3.5rem+env(safe-area-inset-bottom))] sm:hidden"
    />
  </div>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from "#ui/types";

const route = useRoute();
const authStore = useAuth();
const { auth } = useFirebase();
const { notify } = useAppToast();

const logoutConfirm = ref(false);
const loggingOut = ref(false);

const currentPageTitle = computed(() => (route.meta.title as string) || "");
const todayLine = computed(() =>
  new Date().toLocaleDateString("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }),
);

const tabItems = computed(() => [
  { label: "إنشاء فاتورة", icon: "i-lucide-file-plus", to: "/" },
  ...(isAdmin.value
    ? [{ label: "المنتجات", icon: "i-lucide-layout-grid", to: "/products" }]
    : []),
  { label: "العملاء", icon: "i-lucide-users", to: "/customers" },
  { label: "الفواتير", icon: "i-lucide-files", to: "/invoices" },
  { label: "الخزنة", icon: "i-lucide-vault", to: "/cashbox" },
  { label: "دفتر الديون", icon: "i-lucide-notebook-text", to: "/debts" },
]);

function isActiveTab(to: string): boolean {
  return route.path === to;
}

// Mobile bottom bar: 3 primaries + المزيد popover with the rest.
const PRIMARY_TOS = ["/", "/invoices", "/debts"];
const primaryItems = computed(() =>
  tabItems.value.filter((t) => PRIMARY_TOS.includes(t.to as string)),
);
const secondaryItems = computed(() =>
  tabItems.value.filter((t) => !PRIMARY_TOS.includes(t.to as string)),
);
const moreOpen = ref(false);
const moreActive = computed(() =>
  secondaryItems.value.some((t) => isActiveTab(t.to as string)),
);
function goSecondary(to: string): void {
  moreOpen.value = false;
  navigateTo(to);
}
watch(
  () => route.path,
  () => {
    moreOpen.value = false;
  },
);

const userMenu = computed<DropdownMenuItem[]>(() => [
  {
    label: "تسجيل الخروج",
    icon: "i-lucide-log-out",
    color: "error",
    onSelect: () => (logoutConfirm.value = true),
  },
]);

async function logout(): Promise<void> {
  loggingOut.value = true;
  try {
    await auth.signOut();
    // FLAG [S9]: clear role cookie on logout (was surviving before).
    authStore.clearSession();
    logoutConfirm.value = false;
    notify("لقد تم إغلاق التطبيق بنجاح، إلى اللقاء", "success");
  } finally {
    loggingOut.value = false;
  }
}
</script>
