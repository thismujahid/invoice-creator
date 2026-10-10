<template>
  <UModal
    :open="true"
    :dismissible="!!title"
    :title="title || 'تسجيل الدخول'"
    @update:open="(v) => !v && emit('close')"
  >
    <template #body>
      <div class="space-y-4 text-center" dir="rtl">
        <UFormField label="نوع الحساب" class="text-start">
          <USelect v-model="selectedRole" :items="[{ label: 'كاشير', value: 'cashier' }, { label: 'مسؤول', value: 'admin' }]" value-key="value" class="w-full" :disabled="loading" />
        </UFormField>
        <UFormField label="كلمة المرور" class="text-start">
          <UPinInput
            v-model="pin"
            :length="6"
            type="number"
            otp
            mask
            autofocus
            dir="ltr"
            size="lg"
            class="justify-center"
            :disabled="loading"
            @complete="login"
          />
        </UFormField>
        <UButton color="success" block :loading="loading" :disabled="loading" @click="login">تسجيل الدخول</UButton>
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
watch(selectedRole, () => { pin.value = []; error.value = ""; });

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
    authStore.snackBarText = props.successText || `تم تسجيل الدخول ك${role === "admin" ? "مسؤول" : "كاشير"} بنجاح`;
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
