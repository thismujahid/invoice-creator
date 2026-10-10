import { isLowStock, isOutOfStock } from "./finance";

const previousStates = new Map<string, "low" | "out">();
let alertsPrimed = false;
let alertsInstalled = false;

export function resetLowStockAlerts(): void {
  previousStates.clear();
  alertsPrimed = false;
}

export function useLowStockAlerts(): void {
  if (alertsInstalled) return;
  alertsInstalled = true;
  if (!import.meta.client) return;
  const products = useProductsStore();
  const { notify } = useAppToast();

  function currentStates(): Map<string, "low" | "out"> {
    const states = new Map<string, "low" | "out">();
    for (const p of products.list) {
      if (!p.id || p.is_active === false) continue;
      if (isOutOfStock(p)) states.set(p.id, "out");
      else if (isLowStock(p)) states.set(p.id, "low");
    }
    return states;
  }

  function settle(): void {
    const now = currentStates();
    if (!alertsPrimed) {
      previousStates.clear();
      for (const [id, state] of now) previousStates.set(id, state);
      alertsPrimed = true;
      return;
    }
    for (const [id, state] of now) {
      const prev = previousStates.get(id);
      if (prev === state) continue;
      previousStates.set(id, state);
      if (prev === undefined || (prev === "low" && state === "out")) {
        const name = products.productsById.get(id)?.name || "منتج";
        notify(state === "out" ? `نفد مخزون ${name}` : `${name} أصبح قليل الكمية`, state === "out" ? "error" : "info");
      }
    }
    for (const id of [...previousStates.keys()]) {
      if (!now.has(id)) previousStates.delete(id);
    }
  }

  watch(() => products.list, settle, { deep: false });
}
