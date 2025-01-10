// https://nuxt.com/docs/api/configuration/nuxt-config
import { transformAssetUrls } from 'vite-plugin-vuetify'

import { ar } from 'vuetify/locale';
export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: true },
  modules: ["vuetify-nuxt-module", "@pinia/nuxt", "@vite-pwa/nuxt"],
  nitro: {
    prerender: {
      autoSubfolderIndex: true,
      crawlLinks: true,
    }
  },
  vite: {
    vue: {
      template: {
        transformAssetUrls,
      },
    },
    build: {
      cssMinify: true,
      cssCodeSplit: true,
      minify: 'terser'
    }
  },
  vuetify:{
    vuetifyOptions:{
      labComponents: true,
      theme:{
        themes:{
          light:{
            colors:{
              primary:"#09090A",
              error:"#FF233E",
              success:"#50CD89",
              "on-success":"#fff"
            }
          }
        }
      },
      locale: {
        locale: 'ar',
        messages: {ar}
      },
    }
  }
});