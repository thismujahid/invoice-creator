<template>
  <v-dialog
    :persistent="title ? false : true"
    @update:model-value="emit('close')"
    max-width="400px"
    :model-value="true"
  >
    <div class="bg-white rounded-lg pb-4 pt-4 px-4 text-center">
      <h4>{{ title || "أدخل كلمة المرور لتسجيل الدخول" }}</h4>
      <p v-if="title">أدخل كلمة المرور</p>
      <v-autocomplete
      v-if="isInLogin"
        item-value="email"
        v-model="account"
        label="حدد المستخدم"
        variant="outlined"
        class="mt-4"
        hide-details
        item-title="title"
        :items="[
          {
            title: 'المسؤل',
            email: 'mohamed.mojahead@gmail.com',
          },
          {
            title: 'طارق أبو قاسية',
            email: 'imsalehjad@gmail.com',
          },
        ]"
      ></v-autocomplete>
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
const account = ref("mohamed.mojahead@gmail.com");
const props = defineProps(["title", "successText","isInLogin"]);
const emit = defineEmits(["success", "close"]);

async function login() {
  loading.value = true;
  try {
    await signInWithEmailAndPassword(
      auth,
      props.isInLogin?account.value:"mohamed.mojahead@gmail.com",
      newPass.value
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
  } catch (e) {
    authStore.snackBarText = "كلمة المرور غير صحيحة";
    authStore.snackBarColor = "error";
    emit("success", false);
  }
  loading.value = false;
}
</script>
