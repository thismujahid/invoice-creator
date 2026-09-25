// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: false },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  runtimeConfig: {
    public: {
      firebaseApiKey: "",
      firebaseAuthDomain: "",
      firebaseProjectId: "",
      firebaseStorageBucket: "",
      firebaseMessagingSenderId: "",
      firebaseAppId: "",
      firebaseMeasurementId: "",
    },
  },
  modules: ["@pinia/nuxt", "@vite-pwa/nuxt", "@nuxt/ui"],
  css: ["~/assets/css/main.css"],
  ui: {
    colorMode: false,
  },
  nitro: {
    prerender: {
      autoSubfolderIndex: true,
      crawlLinks: true,
    }
  },
  vite: {
    build: {
      cssMinify: true,
      cssCodeSplit: true,
      minify: 'terser'
    }
  }
});