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
        <!-- HOME delta: single admin user — account picker removed (as in home branch). -->
        <UPinInput
          v-model="pin"
          :length="6"
          type="number"
          otp
          autofocus
          dir="ltr"
          size="lg"
          class="justify-center"
          @complete="login"
        />
        <UAlert v-if="error" color="error" variant="soft" :title="error" />
        <div v-if="!title" class="w-full text-center text-sm">
          برمجة وتطوير:
          <NuxtLink
            target="_blank"
            class="text-emerald-600 underline"
            href="https://mejo.dev"
            >محمد إبراهيم مجاهد</NuxtLink
          >
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
// HOME delta: single-user login (admin only) — preserved from home branch.
// Auth flow otherwise identical to main (shared-password re-auth [S4]).
const ADMIN_EMAIL = "mohamed.mojahead@gmail.com";
const error = ref("");
const { auth, signInWithEmailAndPassword } = useFirebase();
const pin = ref<number[]>([]);
const loading = ref(false);
const authStore = useAuth();
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
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, pin.value.join(""));
    authStore.snackBarColor = "success";
    authStore.setUserKey("su");
    authStore.snackBarText = props.successText || "تم تسجيل الدخول كمسؤل بنجاح";
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
