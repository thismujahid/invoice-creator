import { collection, doc, type Transaction } from "firebase/firestore";
import type { InventoryTransaction, InventoryTransactionType } from "~/types/finance";
import { movingAverageCost, round2, toNum } from "./finance";

export interface PurchaseInput {
  product_id: string;
  quantity: number;
  unit_cost: number;
  update_price?: boolean;
  new_price?: number | null;
  note?: string | null;
}

export interface AdjustInput {
  product_id: string;
  new_count: number;
  note: string;
}

const EPS = 1e-9;

export const useInventory = defineStore("inventory", () => {
  const { db, serverTimestamp } = useFirebase();
  const authStore = useAuth();
  const { notify } = useAppToast();
  const products = useProductsStore();

  const byId = (id?: string | null) => (id ? products.list.find((p) => p.id === id) : undefined);
  const creator = () => (authStore.currentUserKey as string) || null;

  function logInv(
    tx: Transaction,
    entry: Omit<InventoryTransaction, "id" | "created_at" | "created_by">,
  ) {
    tx.set(doc(collection(db, "inventory_transactions")), {
      ...entry,
      created_by: creator(),
      created_at: serverTimestamp(),
    });
  }

  /** Atomic stock purchase: count += qty, cashbox -= total, both logs (F8/F29). */
  async function purchaseStock(input: PurchaseInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const qty = round2(input.quantity);
    const unitCost = round2(input.unit_cost);
    if (!input.product_id) return { ok: false, error: "حدد المنتج أولاً." };
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "الكمية يجب أن تكون أكبر من صفر." };
    if (!Number.isFinite(unitCost) || unitCost < 0) return { ok: false, error: "سعر التكلفة غير صالح." };
    if (input.update_price && (input.new_price === null || input.new_price === undefined || toNum(input.new_price) < 0)) {
      return { ok: false, error: "سعر البيع الجديد غير صالح." };
    }
    const total = round2(qty * unitCost);
    try {
      await runTx(async (tx) => {
        const pRef = doc(db, "products", input.product_id);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error("PRODUCT_MISSING");
        const cur = toNum(pSnap.data().stock_quantity);
        const curCost = toNum(pSnap.data().cost_price);
        const cRef = doc(db, "cashbox", "current");
        const cSnap = await tx.get(cRef);
        const bal = cSnap.exists() ? round2(Number(cSnap.data().balance || 0)) : 0;
        if (bal < total) throw new Error("INSUFFICIENT_FUNDS");
        const now = serverTimestamp();
        const patch: Record<string, unknown> = {
          stock_quantity: round2(cur + qty),
          // Moving weighted average cost (system-managed, same txn).
          cost_price: round2(movingAverageCost(cur, curCost, qty, unitCost)),
        };
        if (input.update_price) patch.price = round2(input.new_price);
        tx.update(pRef, patch);
        tx.set(cRef, { balance: round2(bal - total), updated_at: now }, { merge: true });
        const pname = String(pSnap.data().name || "");
        tx.set(doc(collection(db, "inventory_transactions")), {
          type: "purchase" as InventoryTransactionType,
          product_id: input.product_id,
          product_name: pname,
          quantity: qty,
          direction: "in",
          unit_cost: unitCost,
          note: input.note ?? null,
          created_by: creator(),
          created_at: now,
        });
        tx.set(doc(collection(db, "cash_transactions")), {
          type: "inventory_purchase",
          direction: "out",
          amount: total,
          product_id: input.product_id,
          note: input.note ?? `شراء مخزون: ${pname}`,
          created_by: creator(),
          created_at: now,
        });
      });
      await products.fetchProducts();
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message === "INSUFFICIENT_FUNDS") return { ok: false, error: "رصيد الخزنة لا يكفي لتكلفة الشراء." };
      if (e instanceof Error && e.message === "PRODUCT_MISSING") return { ok: false, error: "المنتج غير موجود." };
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  /** Atomic manual stock adjustment (no cash movement). Requires reason. */
  async function adjustStock(input: AdjustInput): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!input.product_id) return { ok: false, error: "حدد المنتج أولاً." };
    if (!input.note?.trim()) return { ok: false, error: "سبب التعديل مطلوب." };
    const target = round2(input.new_count);
    if (!Number.isFinite(target) || target < 0) return { ok: false, error: "الكمية الجديدة غير صالحة." };
    try {
      await runTx(async (tx) => {
        const pRef = doc(db, "products", input.product_id);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error("PRODUCT_MISSING");
        const cur = round2(toNum(pSnap.data().stock_quantity));
        const delta = round2(target - cur);
        if (Math.abs(delta) < EPS) return;
        tx.update(pRef, { stock_quantity: target });
        logInv(tx, {
          type: "manual_adjustment",
          product_id: input.product_id,
          product_name: String(pSnap.data().name || ""),
          quantity: Math.abs(delta),
          direction: delta > 0 ? "in" : "out",
          note: input.note.trim(),
        });
      });
      await products.fetchProducts();
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message === "PRODUCT_MISSING") return { ok: false, error: "المنتج غير موجود." };
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  return { byId, purchaseStock, adjustStock };
});
