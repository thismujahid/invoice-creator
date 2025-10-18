<template>
  <v-dialog :persistent="title?false:true" @update:model-value="emit('close')" max-width="400px" :model-value="true">
    <div class="bg-white rounded-lg pb-4 pt-4 px-4 text-center">
      <h4>{{title||'أدخل كلمة المرور لتسجيل الدخول'}}</h4>
      <p v-if="title">أدخل كلمة المرور</p>
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
      <div v-if="!title" class="text-center w-100" style="font-size: 18px">
        برمجة وتطوير:
        <NuxtLink
          target="_blank"
          class="text-primary"
          href="https://thismujahid.github.io"
          >محمد إبراهيم مجاهد</NuxtLink
        >
      </div>
    </div>
  </v-dialog>
</template>

<script setup>
const error = ref("");
const { auth, signInWithEmailAndPassword } = useFirebase();
const newPass = ref();
const loading = ref(false);
const authStore = useAuth();

const props = defineProps(["title", "successText"]);
const emit = defineEmits(["success","close"]);

async function login() {
  loading.value = true;
  try {
    await signInWithEmailAndPassword(
      auth,
      "mohamed.mojahead@gmail.com",
      newPass.value
    );
    authStore.snackBarText = props.successText || "تم تسجيل الدخول بنجاح";
    emit("success", true);
    emit("close");
  } catch (e) {
    authStore.snackBarText = "كلمة المرور غير صحيحة";
    emit("success", false);
  }
  loading.value = false;
}
</script>
