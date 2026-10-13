import { collection, doc, type Transaction } from "firebase/firestore";
import type { InventoryTransaction } from "~/types/finance";
import { round2, round4, toNum } from "./finance";
import type { PriceDecision } from "./finance";

export interface PurchaseInput {
  product_id: string;
  quantity: number;
  unit_cost: number;
  pricing: PriceDecision;
  paidNow?: number | null;
  supplier_id?: string | null;
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
  unit_id: string;
  new_stock_quantity: number;
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
      supplier_id: input.supplier_id ?? null,
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
    if (res.ok) products.invalidateCache();
    return res;
  }

  /** Atomic manual stock adjustment (no cash movement). Requires reason.
   *  Cost semantics: outbound leaves cost untouched; inbound restocks at the
   *  CURRENT average cost (carried over) so the repair replay keeps a trusted
   *  cost basis instead of creating costless inventory. True cost corrections
   *  belong to purchase flows or the audited cost-repair tool. */
  async function adjustStock(input: AdjustInput): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!input.product_id) return { ok: false, error: "حدد المنتج أولاً." };
    if (!input.note?.trim()) return { ok: false, error: "سبب التعديل مطلوب." };
    const target = round4(input.new_stock_quantity);
    if (!Number.isFinite(input.new_stock_quantity) || target < 0) return { ok: false, error: "الكمية الجديدة غير صالحة." };
    if (Math.abs(target - input.new_stock_quantity) > EPS) return { ok: false, error: "الكمية تقبل أربع منازل عشرية كحد أقصى." };
    if (!input.unit_id) return { ok: false, error: "حدد الوحدة أولًا." };
    try {
      await runTx(async (tx) => {
        const pRef = doc(db, "products", input.product_id);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error("PRODUCT_MISSING");
        const data = pSnap.data();
        const units = Array.isArray(data.units) ? data.units : [];
        const unit = units.find((entry: { id?: string }) => entry.id === input.unit_id);
        if (units.length && !unit) throw new Error("UNIT_MISSING");
        if (!units.length && input.unit_id !== (data.base_unit_id || "legacy-base")) throw new Error("UNIT_MISSING");
        if (unit?.allows_fractional !== true && !Number.isInteger(target)) throw new Error("FRACTION_NOT_ALLOWED");
        const cur = round4(toNum(unit ? unit.stock_quantity : data.stock_quantity));
        const currentCost = unit ? unit.average_cost : data.cost_price;
        const delta = round4(target - cur);
        if (Math.abs(delta) < EPS) return;
        if (delta > 0 && (currentCost === null || currentCost === undefined || !Number.isFinite(Number(currentCost)))) throw new Error("COST_MISSING");
        const movementRef = doc(collection(db, "inventory_transactions"));
        tx.update(pRef, {
          ...(unit ? { units: units.map((entry: { id?: string }) => entry.id === input.unit_id ? { ...entry, stock_quantity: target } : entry) } : { stock_quantity: target }),
          last_inventory_transaction_id: movementRef.id,
          last_inventory_transaction_ids: [movementRef.id],
        });
        tx.set(movementRef, {
          type: "manual_adjustment",
          product_id: input.product_id,
          product_name: String(pSnap.data().name || ""),
          quantity: Math.abs(delta),
          unit_quantity: Math.abs(delta),
          unit_id: input.unit_id,
          unit_name: unit?.name || data.base_unit_name || "وحدة",
          base_quantity: Math.abs(delta),
          unit_factor: 1,
          direction: delta > 0 ? "in" : "out",
          // Inbound carries current average so cost history stays trusted;
          // outbound has no cost effect (null = take only).
          unit_cost: delta > 0 ? round4(Number(currentCost)) : null,
          reason: "manual_correction",
          note: `تعديل يدوي (${input.note.trim()}) — ${delta > 0 ? "دخول بتكلفة المتوسط الحالية" : "خروج بدون أثر على التكلفة"}`,
          seq: 0,
          created_by: creator(),
          created_at: serverTimestamp(),
        });
      });
      products.invalidateCache();
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message === "PRODUCT_MISSING") return { ok: false, error: "المنتج غير موجود." };
      if (e instanceof Error && e.message === "UNIT_MISSING") return { ok: false, error: "الوحدة غير موجودة." };
      if (e instanceof Error && e.message === "FRACTION_NOT_ALLOWED") return { ok: false, error: "هذه الوحدة لا تقبل كميات كسرية." };
      if (e instanceof Error && e.message === "COST_MISSING") return { ok: false, error: "متوسط تكلفة الوحدة غير معروف؛ سجّلها عبر الشراء أولًا." };
      console.error(e);
      return { ok: false, error: "تعذر حفظ العملية، لم يتم تعديل الخزنة أو المخزون." };
    }
  }

  return { byId, purchaseStock, adjustStock };
});
