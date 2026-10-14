<template>
  <div class="rounded-xl border border-slate-200 bg-white p-3">
    <div class="mb-2 flex items-center justify-between gap-2">
      <label :for="inputId" class="flex items-center gap-1.5 text-sm font-bold text-slate-700">
        <UIcon name="i-lucide-user-round-search" class="size-4" />
        العميل
      </label>
      <UButton
        v-if="selectedId"
        size="xs"
        color="neutral"
        variant="soft"
        :icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :aria-expanded="open"
        aria-label="إظهار أو إخفاء قائمة العملاء"
        :title="open ? 'إخفاء القائمة' : 'تغيير العميل'"
        class="min-h-9 min-w-9 justify-center"
        @click="open = !open"
      />
    </div>

    <!-- Compact selected-customer card (list collapses after selection). -->
    <div
      v-if="selectedId && selected"
      class="mb-2 flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/50 px-2.5 py-2"
      aria-live="polite"
    >
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-extrabold text-slate-800">{{ selected.name }}</div>
        <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          <span class="text-emerald-700">له: <strong class="tabular-nums">{{ formatePrice(cardCredit) }}</strong> ج</span>
          <span class="text-rose-700">عليه: <strong class="tabular-nums">{{ formatePrice(cardDebt) }}</strong> ج</span>
        </div>
      </div>
    </div>

    <div v-show="!selectedId || open">
      <UInput
        :id="inputId"
        :model-value="search"
        role="combobox"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="activeDescendant ?? undefined"
        autocomplete="off"
        placeholder="بحث باسم العميل أو الهاتف..."
        icon="i-lucide-search"
        size="lg"
        class="w-full"
        :ui="{ base: 'min-h-11' }"
        @update:model-value="(v) => onSearch(String(v ?? ''))"
        @keydown.down.prevent="moveActive(1)"
        @keydown.up.prevent="moveActive(-1)"
        @keydown.home.prevent="moveActive('first')"
        @keydown.end.prevent="moveActive('last')"
        @keydown.enter.prevent="chooseActive"
        @keydown.esc="onEscape"
        @focus="open = true"
      />
      <div
        :id="listId"
        role="listbox"
        aria-label="قائمة العملاء"
        class="mt-2 min-h-[15rem] overflow-y-auto rounded-lg border border-slate-100"
      >
        <template v-if="loading">
          <div v-for="i in 5" :key="`sk-${i}`" class="border-b border-slate-50 px-2.5 py-2 last:border-0" aria-hidden="true">
            <USkeleton class="h-4 w-2/5" />
            <USkeleton class="mt-1.5 h-3 w-3/5" />
          </div>
        </template>
        <template v-else-if="!customers.length">
          <div class="flex min-h-[15rem] flex-col items-center justify-center gap-2 p-4 text-center">
            <p class="text-sm text-slate-500">لا يوجد عملاء مسجلون.</p>
            <UButton size="sm" color="success" variant="soft" icon="i-lucide-plus" class="min-h-11" @click="emit('create')">إضافة عميل جديد</UButton>
          </div>
        </template>
        <template v-else-if="!rows.length">
          <p class="flex min-h-[15rem] items-center justify-center p-4 text-center text-sm text-slate-500">لا توجد نتائج مطابقة للبحث.</p>
        </template>
        <template v-else>
          <div
            v-for="(row, index) in rows"
            :id="optionId(index)"
            :key="row.key"
            role="option"
            :aria-selected="isSelected(row.customer)"
            class="flex cursor-pointer items-center gap-2 border-b border-slate-50 px-2.5 py-2 last:border-0"
            :class="[
              index === activeIndex ? 'bg-blue-50' : '',
              isSelected(row.customer) ? 'bg-emerald-50/60' : '',
            ]"
            @click="choose(row.customer)"
            @mousemove="activeIndex = index"
          >
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-extrabold text-slate-600"
              aria-hidden="true"
            >{{ (row.customer.name || "?").trim().charAt(0) }}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-bold text-slate-800">
                {{ row.customer.name }}
                <UBadge v-if="isSelected(row.customer)" color="success" variant="soft" size="xs" class="ms-1">محدد</UBadge>
              </span>
              <span class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                <span class="text-emerald-700">له: <strong class="tabular-nums">{{ formatePrice(row.credit) }}</strong></span>
                <span class="text-rose-700">عليه: <strong class="tabular-nums">{{ formatePrice(row.debt) }}</strong></span>
              </span>
            </span>
          </div>
          <button
            type="button"
            class="flex w-full items-center gap-2 px-2.5 py-2 text-start text-sm font-bold text-emerald-700 hover:bg-emerald-50"
            @click="emit('create')"
          >
            <UIcon name="i-lucide-plus" class="size-4" />
            إضافة عميل جديد
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Customer } from "~/types";
import type { CustomerDebt } from "~/composables/useDebts";
import { normalizePhone, round2 } from "~/composables/finance";

const props = defineProps<{
  customers: Customer[];
  loading: boolean;
  /** Existing debts book (totalDebt = عليه, creditBalance = له). */
  book: CustomerDebt[];
  selectedId: string | null;
  /** Live wallet values for the selected customer (preferred on the card). */
  liveCredit: number;
  liveDebt: number;
}>();

const emit = defineEmits<{
  select: [customer: Customer];
  create: [];
}>();

const { formatePrice } = useHelpers();

const uid = useId();
const inputId = `customer-search-${uid}`;
const listId = `customer-list-${uid}`;
const search = ref("");
const open = ref(props.selectedId == null);
const activeIndex = ref(0);

watch(
  () => props.selectedId,
  (id) => {
    if (id) open.value = false;
    else {
      open.value = true;
      search.value = "";
    }
  },
);

interface CustomerRow {
  key: string;
  customer: Customer;
  credit: number;
  debt: number;
}

/** Same identity rule as the debts fetch: real id first, else name+phone. */
function bookEntryOf(customer: Customer): CustomerDebt | undefined {
  if (customer.id) {
    const byId = props.book.find((entry) => entry.customer_id === customer.id);
    if (byId) return byId;
  }
  const phone = normalizePhone(customer.phone);
  const name = String(customer.name ?? "").trim();
  if (!phone || !name) return undefined;
  return props.book.find(
    (entry) => !entry.customer_id
      && String(entry.name ?? "").trim() === name
      && normalizePhone(entry.phone) === phone,
  );
}

const rows = computed<CustomerRow[]>(() => {
  const q = search.value.trim();
  const base = q
    ? props.customers.filter(
        (c) => String(c.name ?? "").includes(q) || String(c.phone ?? "").includes(q),
      )
    : props.customers.slice(0, 5);
  return base.slice(0, 30).map((customer) => {
    const entry = bookEntryOf(customer);
    return {
      key: String(customer.id ?? `${customer.name}|${customer.phone}`),
      customer,
      credit: round2(entry?.creditBalance ?? 0),
      debt: round2(entry?.totalDebt ?? 0),
    };
  });
});

const selected = computed(() => props.customers.find((c) => c.id === props.selectedId) ?? null);
const cardCredit = computed(() => (props.selectedId ? round2(props.liveCredit) : 0));
const cardDebt = computed(() => {
  if (!props.selectedId) return 0;
  if (props.liveDebt > 0 || props.liveCredit > 0) return round2(props.liveDebt);
  const entry = selected.value ? bookEntryOf(selected.value) : undefined;
  return round2(entry?.totalDebt ?? 0);
});

function isSelected(customer: Customer): boolean {
  return !!props.selectedId && !!customer.id && customer.id === props.selectedId;
}

function optionId(index: number): string {
  return `${listId}-opt-${index}`;
}
const activeDescendant = computed(() => (rows.value.length ? optionId(activeIndex.value) : null));

function onSearch(value: string): void {
  search.value = value;
  open.value = true;
  activeIndex.value = 0;
}

function moveActive(step: number | "first" | "last"): void {
  open.value = true;
  if (!rows.value.length) return;
  if (step === "first") activeIndex.value = 0;
  else if (step === "last") activeIndex.value = rows.value.length - 1;
  else activeIndex.value = (activeIndex.value + step + rows.value.length) % rows.value.length;
}

function choose(customer: Customer): void {
  search.value = "";
  activeIndex.value = 0;
  emit("select", customer);
}

function chooseActive(): void {
  const row = rows.value[activeIndex.value];
  if (row) choose(row.customer);
}

function onEscape(): void {
  if (props.selectedId) open.value = false;
}
</script>
