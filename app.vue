<template>
  <UApp>
    <UToaster />
    <div v-if="!initFirebase" dir="rtl">
      <FormsAuthScreen :is-in-login="true" @success="(v) => (isAuthed = v)" v-if="!isAuthed" />
      <div id="printableArea" class="printable-area"></div>
      <NuxtLayout v-if="isAuthed">
        <NuxtRouteAnnouncer />
        <NuxtPage />
      </NuxtLayout>
    </div>
    <div v-else class="flex h-screen w-full items-center justify-center gap-3">
      جاري التحميل...
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
      <div v-show="false">
        <NuxtPage />
      </div>
    </div>
  </UApp>
</template>
<script setup lang="ts">
import type { User } from "firebase/auth";

useSeoMeta({ title: "منشئ الفواتير" });
useHead({
  htmlAttrs: { dir: "rtl", lang: "ar" },
  link: [{ rel: "manifest", href: "/site.webmanifest" }],
});
const authStore = useAuth();
const { auth } = useFirebase();
const toast = useToast();
auth.languageCode = "ar";
const initFirebase = ref(true);
const isAuthed = ref<boolean>(!!auth.currentUser);
// Single toast render path: writers set snackBarText, we show + consume.
watch(
  () => authStore.snackBarText,
  (t) => {
    if (!t) return;
    toast.add({
      title: t,
      color: authStore.snackBarColor === "error" ? "error" : authStore.snackBarColor === "primary" ? "primary" : "success",
    });
    authStore.snackBarText = "";
  }
);
auth.onAuthStateChanged(
  (user: User | null) => {
    setTimeout(() => {
      isAuthed.value = !!user;
      initFirebase.value = false;
      if (user) {
        authStore.userData = {
          name: user.displayName,
          email: user.email,
          phone: user.phoneNumber,
          avatar: user.photoURL,
          id: user.uid,
        };
      } else {
        authStore.userData = null;
      }
    }, 100);
  },
  (err: unknown) => {
    initFirebase.value = false;
    console.error(err);
  }
);
</script>
<style>
@import url("https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400..800&display=swap");
*::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

*::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

*::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

*::-webkit-scrollbar-thumb:hover {
  background: #555;
}
body {
  padding: 0;
  margin: 0;
  direction: rtl;
}
html,
body {
  font-family: "Baloo Bhaijaan 2", serif;
}

.printable-area {
  display: none;
}
/* Same mechanism as home branch: hide the whole app shell in print and
   show only #printableArea (filled by useDownloadPDF before window.print).
   Mapped from Vuetify originals:
   .invoice-creator-app -> #app-shell | .v-btn -> .no-print
   .v-alert -> .no-print | .v-overlay-container -> [role=dialog] + [data-slot=overlay/viewport] */
@media print {
  html,
  body {
    font-size: 16px !important;
  }

  #app-shell,
  .no-print,
  [role="dialog"],
  [data-slot="overlay"],
  [data-slot="viewport"] {
    display: none !important;
  }
  .printable-area {
    display: block !important;
    padding: 20px;
  }
  .printable-area * {
    font-weight: 400;
    color: rgba(0, 0, 0, 0.781);
  }
}
.custom-scrollbar {
  scrollbar-width: thin; /* For Firefox */
  scrollbar-color: #888 transparent; /* For Firefox */
}

.custom-scrollbar::-webkit-scrollbar {
  width: 8px; /* Scrollbar width */
  height: 8px; /* Scrollbar height for horizontal scroll */
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent; /* Track background */
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: #888; /* Thumb color */
  border-radius: 4px; /* Rounded corners */
  border: 2px solid transparent; /* Optional border for better thumb visibility */
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: #555; /* Thumb color on hover */
}
input,
textarea {
  font-size: 16px !important;
}
</style>
