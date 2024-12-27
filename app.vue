<template>
  <v-app>
    <v-locale-provider rtl>
      <div id="printableArea" class="printable-area invoice-creator-view"></div>
      <v-dialog
        persistent
        max-width="400px"
        :model-value="true"
        v-if="!isAuthed"
      >
        <div class="bg-white rounded-lg pb-4 pt-4 px-4 text-center">
          <h4>أدخل كلمة المرور</h4>
          <v-otp-input
            autofocus
            dir="ltr"
            @finish="login"
            @update:model-value="error = ''"
            :error="error ? true : false"
            v-model="newPass"
            length="6"
          ></v-otp-input>
          <v-alert class="mb-2" v-if="error" color="error" variant="tonal">
            {{ error }}
          </v-alert>
          <div class="text-center w-100" style="font-size: 18px">
            برمجة وتطوير:
            <NuxtLink
              target="_blank"
              class="text-primary"
              href="https://thismujahid.github.io"
              >محمد إبراهيم مجاهد</NuxtLink
            >
          </div>
          <!-- <v-btn @click="login" flat color="primary">متابعة</v-btn> -->
        </div>
      </v-dialog>
      <div class="invoice-creator-app" v-if="isAuthed">
        <v-app-bar app color="light" flat border>
          <v-toolbar-title>
            منشئ الفواتير | {{ currentPageTitle }}</v-toolbar-title
          >
        </v-app-bar>
        <v-navigation-drawer app permanent fixed>
          <v-list>
            <v-list-item to="/" prepend-icon="mdi-file-plus">
              <v-list-item-title>إنشاء فاتورة</v-list-item-title>
            </v-list-item>
            <v-list-item to="/products" prepend-icon="mdi-grid-large">
              <v-list-item-title>المنتجات</v-list-item-title>
            </v-list-item>
            <v-list-item to="/customers" prepend-icon="mdi-account-multiple">
              <v-list-item-title>العملاء</v-list-item-title>
            </v-list-item>
            <v-list-item prepend-icon="mdi-file-multiple">
              <template #append>
                <v-chip color="success" variant="tonal">قريبا</v-chip>
              </template>
              <v-list-item-title>الفواتير</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-navigation-drawer>
        <v-main>
          <NuxtRouteAnnouncer />
          <div style="min-height: 90vh">
            <NuxtPage />
          </div>
          <v-footer color="primary">
            <div class="text-center w-100" style="font-size: 18px">
              برمجة وتطوير:
              <NuxtLink
                target="_blank"
                class="text-white"
                href="https://thismujahid.github.io"
                >محمد إبراهيم مجاهد</NuxtLink
              >
              <div>جميع الحقوق محفوظة @ {{ new Date().getFullYear() }}</div>
            </div>
          </v-footer>
        </v-main>
      </div>
    </v-locale-provider>
  </v-app>
</template>
<script setup>
useSeoMeta({
  title: "منشئ الفواتير",
});
const password = 789885;
const newPass = ref();
const isAuthed = ref(false);
const error = ref("");
const route = useRoute();
const currentPageTitle = computed(() => {
  return route.meta.title || "";
});
function login() {
  if (password == newPass.value) {
    isAuthed.value = true;
  } else {
    error.value = "كلمة المرور غير صحيحة، حاول تاني";
  }
}
</script>
<style>
@import url("https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400..800&display=swap");
body {
  padding: 0;
  margin: 0;
  direction: rtl;
}
html,
body {
  font-family: "Baloo Bhaijaan 2", serif;
}
.v-btn--flat {
  height: 44px !important;
  padding-inline: 25px !important;
}
.printable-area {
  display: none;
}
@media print {
  .printable-area {
    display: block;
    padding: 20px;
  }
  .printable-area * {
    font-weight: 400;
    color: rgba(0, 0, 0, 0.781);
  }
  .printable-area .footer {
    border-bottom: thin solid rgba(0, 0, 0, 0.12);
    border-right: thin solid rgba(0, 0, 0, 0.12);
    border-left: thin solid rgba(0, 0, 0, 0.12);
    padding: 5px 5px 5px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .v-btn {
    display: none;
  }
  .invoice-creator-app {
    display: none;
  }
}
.justify-between {
  justify-content: space-between;
}
</style>
