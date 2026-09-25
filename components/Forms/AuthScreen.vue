<template>
  <UModal
    :open="true"
    :dismissible="!!title"
    :title="title || 'تسجيل الدخول'"
    @update:open="(v) => !v && emit('close')"
  >
    <template #body>
      <div class="space-y-4 text-center" dir="rtl">
        <p v-if="title" class="text-sm text-gray-500">أدخل كلمة المرور</p>
        <USelect
          v-if="isInLogin"
          v-model="account"
          :items="accounts"
          size="lg"
          class="w-full"
        />
        <UPinInput
          v-model="pin"
          :length="6"
          type="number"
          otp
          autofocus
          :disabled="loading"
          dir="ltr"
          size="lg"
          class="justify-center"
          @complete="login"
        />

        <div v-if="!title" class="w-full text-center text-sm">
          برمجة وتطوير:
          <NuxtLink
            target="_blank"
            class="text-emerald-600 underline"
            href="https://thismujahid.github.io"
            >محمد إبراهيم مجاهد</NuxtLink
          >
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
// P1: Vuetify dialog + otp-input → Nuxt UI UModal + UPinInput.
// Auth flow unchanged (shared-password re-auth flagged [S4] stays).
const error = ref("");
const { auth, signInWithEmailAndPassword } = useFirebase();
const pin = ref<number[]>([]);
const loading = ref(false);
const authStore = useAuth();
const account = ref("mohamed.mojahead@gmail.com");
const accounts = [
  { label: "المسؤل", value: "mohamed.mojahead@gmail.com" },
  { label: "طارق أبو قاسية", value: "imsalehjad@gmail.com" },
];
const props = defineProps<{
  title?: string;
  successText?: string;
  isInLogin?: boolean;
}>();
const emit = defineEmits(["success", "close"]);
async function login() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    await signInWithEmailAndPassword(
      auth,
      props.isInLogin ? account.value : "mohamed.mojahead@gmail.com",
      pin.value.join(""),
    );
    authStore.snackBarColor = "success";
    switch (account.value) {
      case "mohamed.mojahead@gmail.com":
        authStore.setUserKey("su");
        authStore.snackBarText =
          props.successText || "تم تسجيل الدخول كمسؤل بنجاح";
        break;
      case "imsalehjad@gmail.com":
        authStore.setUserKey("c_tarek");
        authStore.snackBarText =
          props.successText || "تم تسجيل الدخول بنجاح... أهلا بيك ياريكو 😃";
        break;
      default:
        authStore.setUserKey(undefined);
        break;
    }
    emit("success", true);
    emit("close");
  } catch {
    error.value = "كلمة المرور غير صحيحة";
    authStore.snackBarText = "كلمة المرور غير صحيحة";
    authStore.snackBarColor = "error";
    emit("success", false);
  } finally {
    loading.value = false;
    pin.value = [];
  }
}
</script>
