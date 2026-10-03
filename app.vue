<template>
  <UApp>
    <UToaster />
    <NuxtLoadingIndicator color="#10b981" />
    <NuxtLayout>
      <NuxtRouteAnnouncer />
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
<script setup lang="ts">
useSeoMeta({ title: "قريتي" });
useHead({
  htmlAttrs: { dir: "rtl", lang: "ar" },
  link: [
    { rel: "manifest", href: "/site.webmanifest" },
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    {
      rel: "preconnect",
      href: "https://fonts.gstatic.com",
      crossorigin: "",
    },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400..800&display=swap",
      media: "all",
    },
  ],
});
</script>
<style>
/* Font loaded via <link> in useHead above (non render-blocking @import
   removed): preconnect + display=swap avoids blocking first paint. */
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
