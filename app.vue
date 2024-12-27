<template>
  <v-app>
    <v-locale-provider rtl>
      <NuxtRouteAnnouncer />
      <NuxtPage />
    </v-locale-provider>
</v-app>
</template>
<style>
@import url('https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400..800&display=swap');
html,body{
  font-family: "Baloo Bhaijaan 2", serif;
}
.v-btn--flat{
  height: 44px !important;
  padding-inline: 25px !important;
}
</style>