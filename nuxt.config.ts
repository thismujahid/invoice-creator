// https://nuxt.com/docs/api/configuration/nuxt-config

import { ar } from 'vuetify/locale';
export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: true },
  modules: ["vuetify-nuxt-module", "@pinia/nuxt"],
  vuetify:{
    vuetifyOptions:{
      labComponents: true,
      locale: {
        locale: 'ar',
        messages: {ar}
      },
    }
  }
});
