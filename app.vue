<template>
  <v-app>
    <v-snackbar
      @update:model-value="(v) => (!v ? (authStore.snackBarText = '') : false)"
      location="top end"
      color="primary"
      z-index="999999"
      :model-value="authStore.snackBarText ? true : false"
      :timeout="5000"
    >
      {{ authStore.snackBarText }}
    </v-snackbar>

    <v-locale-provider rtl v-if="!initFirebase">
      <v-dialog
        persistent
        max-width="400px"
        :model-value="true"
        v-if="!isAuthed"
      >
        <div class="bg-white rounded-lg pb-4 pt-4 px-4 text-center">
          <h4>أدخل كلمة المرور</h4>
          <v-otp-input
            type="password"
            pattern="[0-9]*"
            inputmode="numeric"
            autofocus
            :loading="loading"
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
      <div id="printableArea" class="printable-area invoice-creator-view"></div>
      <div class="invoice-creator-app" v-if="isAuthed">
        <v-app-bar absolute app color="light" flat border>
          <v-toolbar-title>
            <v-btn
              class="small-padding small-btn"
              @click="sideMenu = !sideMenu"
            >
              <v-icon icon="mdi-menu" />
            </v-btn>
            منشئ الفواتير | {{ currentPageTitle }}</v-toolbar-title
          >
          <div v-if="authStore.userInfo" class="px-2 d-flex align-center ga-3">
            <v-dialog persistent max-width="300px">
              <template #activator="{ props }">
                <v-btn
                  flat
                  color="error"
                  class="small-padding"
                  v-bind="props"
                  variant="tonal"
                >
                  <v-icon icon="mdi-logout" />
                  إغلاق التطبيق
                </v-btn>
              </template>
              <template #default="{ isActive }">
                <div class="bg-white py-4 px-4 rounded">
                  <h4>هل أنت متأكد</h4>
                  <p class="mb-4">أنت علي وشك تسجيل الخروج وإغلاق التطبيق</p>
                  <v-btn
                    @click="logout"
                    :loading="loading"
                    block
                    color="error"
                    flat
                    >تأكيد الإغلاق</v-btn
                  >
                  <v-btn
                    block
                    @click="isActive.value = false"
                    color="black"
                    variant="plain"
                    flat
                    >إلغاء</v-btn
                  >
                </div>
              </template>
            </v-dialog>
          </div>
        </v-app-bar>
        <v-navigation-drawer app mobile temporary v-model="sideMenu">
          <v-list>
            <v-list-item color="success" to="/" prepend-icon="mdi-file-plus">
              <v-list-item-title>إنشاء فاتورة</v-list-item-title>
            </v-list-item>
            <v-list-item
              color="success"
              to="/products"
              prepend-icon="mdi-grid-large"
            >
              <v-list-item-title>المنتجات</v-list-item-title>
            </v-list-item>
            <v-list-item
              color="success"
              to="/customers"
              prepend-icon="mdi-account-multiple"
            >
              <v-list-item-title>العملاء</v-list-item-title>
            </v-list-item>
            <v-list-item
              to="/invoices"
              color="success"
              prepend-icon="mdi-file-multiple"
            >
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
    <div
      class="d-flex align-center justify-center ga-3 w-100"
      style="height: 100vh"
      v-else-if="initFirebase"
    >
      جاري التحميل...
      <v-progress-circular indeterminate size="20" width="2" />
    </div>
  </v-app>
</template>
<script setup>
useSeoMeta({
  title: "منشئ الفواتير",
});
useHead({
  link: [{ rel: "manifest", href: "/site.webmanifest" }],
});
const authStore = useAuth();
const { auth, signInWithEmailAndPassword } = useFirebase();
auth.languageCode = "ar";
const newPass = ref();
const initFirebase = ref(true);
const sideMenu = ref(false);
const loading = ref(false);
const isAuthed = ref(auth.currentUser ? true : false);
const error = ref("");
const route = useRoute();
new Promise((res) => {
  auth.onAuthStateChanged(
    (user) => {
      isAuthed.value = user ? true : false;
      initFirebase.value = false;
      if (user) {
        newPass.value = null;
        authStore.userData = {
          name: user.displayName,
          email: user.email,
          phone: user.phone,
          avatar: user.photoURL,
          id: user.uid,
        };
      }
      res(true);
    },
    (err) => {
      res(false);
      initFirebase.value = false;
      console.error(err);
    }
  );
});
const currentPageTitle = computed(() => {
  return route.meta.title || "";
});
async function login() {
  loading.value = true;
  try {
    await signInWithEmailAndPassword(
      auth,
      "mohamed.mojahead@gmail.com",
      newPass.value
    );
  } catch (e) {
    error.value = "كلمة المرور غير صحيحة";
  }
  loading.value = false;
}
async function logout() {
  loading.value = true;
  await auth.signOut();
  authStore.snackBarText = "لقد تم إغلاق التطبيق بنجاح، إلى اللقاء";
  loading.value = false;
}
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

.v-toolbar {
  position: sticky !important;
}
.v-main {
  padding-top: 0 !important;
}
.v-btn--flat {
  height: 44px !important;
  padding-inline: 25px !important;
}
.printable-area {
  display: none;
}
@media print {
  html,
  body {
    font-size: 16px !important;
  }

  .v-alert {
    display: none !important;
  }
  .v-overlay-container {
    display: none;
  }
  .printable-area {
    display: block;
    padding: 20px;
  }
  .printable-area * {
    font-weight: 400;
    color: rgba(0, 0, 0, 0.781);
  }
  .printable-area .footer {
    border-bottom: thin solid rgba(0, 0, 0, 1);
    border-right: thin solid rgba(0, 0, 0, 1);
    border-left: thin solid rgba(0, 0, 0, 1);
    padding: 5px 5px 5px 5px;
  }
  .printable-area .footer div {
    display: flex;
    padding-block: 5px;
    align-items: center;
    justify-content: space-between;
    line-height: 1;
  }
  .printable-area .footer div:not(:last-of-type) {
    border-bottom: 1px dashed rgba(128, 128, 128, 0.163);
  }
  .v-btn {
    display: none;
  }
  .invoice-creator-app {
    display: none;
  }
  .v-data-table{
    max-height: unset !important;
  }
}
.justify-between {
  justify-content: space-between;
}
.invoice-creator-view .app {
  padding: 30px;
  min-height: 90vh;
  gap: 1.875rem;
  display: flex;
}
.invoice-creator-view.in-popup {
  min-width: 650px;
}

.invoice-creator-view .app .invoice {
  border-radius: 5px;
  border: 1px solid gray;
  padding: 10px;
  width: 540px !important;
  overflow: auto;
}
.invoice-creator-view .app .invoice * {
  font-weight: 400;
  color: rgba(0, 0, 0, 0.781);
}
#invoice-data .v-btn * {
  color: #fff !important;
}
.invoice-creator-view .app .invoice .v-alert,
.invoice-creator-view .app .invoice .v-alert * {
  color: #ffae00e1 !important;
}
.invoice-creator-view .invoice.printing {
  border: unset;
}
.invoice-creator-view .invoice.printing .v-btn {
  display: none;
}
.invoice-creator-view #invoice-data {
  width: 500px !important;
  max-width: 500px !important;
}
.invoice-creator-view .v-data-table {
  border-radius: unset !important;
  margin-top: 5px !important;
}
.invoice-creator-view .v-data-table thead tr th {
  border-top: thin solid rgba(0, 0, 0, 1) !important;
}

.invoice-creator-view .v-data-table thead tr th,
.invoice-creator-view .v-data-table tbody tr td {
  border-bottom: thin solid rgba(0, 0, 0, 1) !important;
  text-align: center;
}
.invoice-creator-view .v-data-table tbody tr:first-of-type td {
  border-top: unset !important;
}
.invoice-creator-view .v-data-table thead tr th:first-of-type,
.invoice-creator-view .v-data-table tbody tr td:first-of-type {
  border-right: thin solid rgba(0, 0, 0, 1) !important;
}
.invoice-creator-view .v-data-table thead tr th:last-of-type,
.invoice-creator-view .v-data-table tbody tr td:last-of-type {
  border-left: thin solid rgba(0, 0, 0, 1) !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(1),
.invoice-creator-view .v-data-table tbody tr td:nth-child(1) {
  border-left: thin solid rgba(0, 0, 0, 1) !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(2),
.invoice-creator-view .v-data-table tbody tr td:nth-child(2) {
  border-left: thin solid rgba(0, 0, 0, 1) !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(3),
.invoice-creator-view .v-data-table tbody tr td:nth-child(3) {
  border-left: thin solid rgba(0, 0, 0, 1) !important;
}
.v-data-table-header__content {
  justify-content: center !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(4),
.invoice-creator-view .v-data-table tbody tr td:nth-child(4) {
  border-left: thin solid rgba(0, 0, 0, 1) !important;
}
.invoice-creator-view .v-data-table thead tr th:nth-child(5),
.invoice-creator-view .v-data-table tbody tr td:nth-child(5) {
  border-left: thin solid rgba(0, 0, 0, 1) !important;
}
.invoice-creator-view .v-data-table__td {
  padding: 0 5px !important;
  height: 30px !important;
}
.invoice-creator-view .v-data-table__td div {
  text-align: center !important;
  padding: 0 !important;
}
.invoice-creator-view .invoice .footer {
  border-bottom: thin solid rgba(0, 0, 0, 1);
  border-right: thin solid rgba(0, 0, 0, 1);
  border-left: thin solid rgba(0, 0, 0, 1);
  padding: 5px;
}
.invoice thead {
  position: sticky;
  top: 0;
  background-color: #fff;
}
.v-input {
  margin-bottom: 15px;
}
.v-input:has(.v-input__details) {
  margin-bottom: 8px;
}
.invoice-creator-view .invoice .footer div {
  display: flex;
  padding-block: 5px;
  align-items: center;
  padding-inline-end: 10px;
  justify-content: space-between;
  line-height: 1;
}
.invoice-creator-view .invoice .footer div:not(:last-of-type) {
  border-bottom: 1px dashed rgba(128, 128, 128, 0.163);
}
.invoice-creator-view .app .form {
  border-radius: 5px;
  border: 1px solid gray;
  padding: 30px;
  width: calc(100% - 530px);
}
@media (max-width: 62rem) {
  .invoice-creator-view .app {
    flex-wrap: wrap;
  }
  .invoice-creator-view .app .form {
    width: 100%;
  }
}
.v-navigation-drawer {
  max-height: 100vh !important;
}
.invoice-creator-view .invoice-header {
  position: sticky !important;
  top: 0px !important;
  background-color: #fff;
  z-index: 999;
}
.invoice-footer {
  position: sticky !important;
  bottom: 0px !important;
  z-index: 999;
  background-color: #fff;
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
.v-btn--icon.v-btn--density-default {
  width: 40px !important;
  height: 40px !important;
  display: flex;
  min-width: unset !important;
}
.v-btn--icon.v-btn--density-default .mdi {
  font-size: 30px !important;
}
@media (max-width: 600px) {
  html,
  body {
    font-size: 11px;
  }

  table tr td {
    text-wrap: nowrap !important;
  }
  .invoice-creator-view .app {
    padding: 15px !important;
  }
  .invoice-creator-view .app .form {
    border: unset !important;
    padding: 0 !important;
  }
  .v-input__details {
    display: none !important;
  }
  .v-input__details:has(.v-messages__message) {
    display: block !important;
  }
  .v-text-field input {
    padding: 7px !important;
  }
  .v-input--density-default {
    --v-input-control-height: 48px !important;
  }
  .v-field__input {
    padding-bottom: unset !important;
    padding-top: unset !important;
  }
  .small-padding {
    padding: 7px !important;
  }
  .small-padding.small-btn {
    min-width: unset !important;
    width: 30px !important;
    font-size: 16px !important;
  }
}
input,
textarea {
  font-size: 16px !important;
}
</style>
