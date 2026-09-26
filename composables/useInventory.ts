import { collection, doc, type Transaction } from "firebase/firestore";
import type { InventoryTransaction } from "~/types/finance";
import { round2, toNum } from "./finance";
import type { PriceDecision } from "./finance";

export interface PurchaseInput {
  product_id: string;
  quantity: number;
  unit_cost: number;
  pricing: PriceDecision;
  paidNow?: number | null;
  supplier_name?: string | null;
  supplier_ref?: string | null;
  idempotencyKey?: string | null;
  unit_id?: string | null;
  unit_name?: string | null;
  unit_factor?: number | null;
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

  /** Single-product purchase — thin wrapper over the unified purchase core
   *  (S5): always creates a purchase-invoice doc; defaults to full payment
   *  (legacy behavior) unless paidNow is given explicitly. */
  async function purchaseStock(input: PurchaseInput) {
    const total = round2(toNum(input.quantity) * toNum(input.unit_cost));
    const paid =
      input.paidNow === null || input.paidNow === undefined
        ? total
        : round2(toNum(input.paidNow));
    const key =
      input.idempotencyKey ||
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
    const res = await usePurchasing().executePurchase({
      idempotencyKey: key,
      supplier_name: input.supplier_name ?? null,
      supplier_ref: input.supplier_ref ?? null,
      items: [
        {
          product_id: input.product_id,
          quantity: input.quantity,
          unit_cost: input.unit_cost,
          unit_id: input.unit_id,
          unit_name: input.unit_name,
          unit_factor: input.unit_factor ?? 1,
          pricing: input.pricing,
        },
      ],
      paidNow: paid,
      note: input.note ?? null,
    });
    if (res.ok) await products.fetchProducts();
    return res;
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
        const movementRef = doc(collection(db, "inventory_transactions"));
        tx.update(pRef, {
          stock_quantity: target,
          last_inventory_transaction_id: movementRef.id,
          last_inventory_transaction_ids: [movementRef.id],
        });
        tx.set(movementRef, {
          type: "manual_adjustment",
          product_id: input.product_id,
          product_name: String(pSnap.data().name || ""),
          quantity: Math.abs(delta),
          direction: delta > 0 ? "in" : "out",
          note: input.note.trim(),
          seq: 0,
          created_by: creator(),
          created_at: serverTimestamp(),
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
