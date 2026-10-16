<template>
  <div class="w-full rounded-xl border border-slate-200 bg-white p-5 sm:p-6" dir="rtl">
      <div class="space-y-4 text-center">
        <div class="text-start">
          <div class="mb-1.5 text-sm font-medium text-gray-700">نوع الحساب</div>
          <div
            role="group"
            aria-label="نوع الحساب"
            class="grid grid-cols-2 rounded-lg bg-gray-100 p-1"
          >
            <UButton
              color="neutral"
              :variant="selectedRole === 'cashier' ? 'solid' : 'ghost'"
              block
              :disabled="loading"
              :aria-pressed="selectedRole === 'cashier'"
              class="min-h-11"
              @click="selectedRole = 'cashier'"
              >كاشير</UButton
            >
            <UButton
              color="neutral"
              :variant="selectedRole === 'admin' ? 'solid' : 'ghost'"
              block
              :disabled="loading"
              :aria-pressed="selectedRole === 'admin'"
              class="min-h-11"
              @click="selectedRole = 'admin'"
              >مسؤول</UButton
            >
          </div>
        </div>
        <UFormField
          label="كلمة المرور"
          :ui="{ label: 'text-center w-full' }"
          class="text-center"
        >
          <UPinInput
            v-model="pin"
            :length="6"
            type="number"
            otp
            mask
            autofocus
            dir="ltr"
            size="lg"
            class="justify-center [&_input]:min-h-11 [&_input]:min-w-11"
            aria-label="رمز الدخول المكوّن من ستة أرقام"
            :disabled="loading"
            @complete="login"
          />
        </UFormField>
        <UButton
          color="success"
          block
          :loading="loading"
          :disabled="loading"
          class="min-h-11"
          @click="login"
          >تسجيل الدخول</UButton
        >
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
  </div>
</template>

<script setup lang="ts">
import { ADMIN_EMAIL, CASHIER_EMAIL } from "~/constants/auth";

const error = ref("");
const { auth, signInWithEmailAndPassword } = useFirebase();
const pin = ref<number[]>([]);
const selectedRole = ref<"admin" | "cashier">("cashier");
const loading = ref(false);
const authStore = useAuth();
const props = defineProps<{
  title?: string;
  successText?: string;
  isInLogin?: boolean;
}>();
const emit = defineEmits(["success", "close"]);
watch(selectedRole, () => {
  pin.value = [];
  error.value = "";
});

async function login() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  let authenticated = false;
  try {
    const email = selectedRole.value === "admin" ? ADMIN_EMAIL : CASHIER_EMAIL;
    const password = pin.value.join("");
    if (!email || !password) throw new Error("MISSING_CREDENTIALS");
    const credential = await signInWithEmailAndPassword(auth, email, password);
    authenticated = true;
    const role = await resolveStaffRole(credential.user);
    if (role !== selectedRole.value) {
      await auth.signOut();
      throw new Error("WRONG_ROLE");
    }
    authStore.role = role;
    authStore.snackBarColor = "success";
    authStore.setUserKey(role === "admin" ? "su" : "cashier");
    authStore.snackBarText =
      props.successText ||
      `تم تسجيل الدخول ك${role === "admin" ? "مسؤول" : "كاشير"} بنجاح`;
    emit("success", true);
    emit("close");
  } catch {
    if (authenticated) {
      await auth.signOut();
      authStore.clearSession();
    }
    error.value = "تعذر تسجيل الدخول. تأكد من البيانات وصلاحية الحساب.";
    authStore.snackBarText = error.value;
    authStore.snackBarColor = "error";
    emit("success", false);
  } finally {
    loading.value = false;
    pin.value = [];
  }
}
</script>
