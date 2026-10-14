import type { PriceDecision } from "./finance";
import type { InventoryBucket } from "../functions/shared/inventoryCore.mjs";
import { callStaff } from "./staffApi";
import { round2, round4, toNum } from "./finance";

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
  bucket: InventoryBucket;
  unit_id?: string | null;
  new_quantity: number;
  note: string;
}

export const useInventory = defineStore("inventory", () => {
  const products = useProductsStore();
  let pendingAdjustment: { fingerprint: string; requestId: string } | null = null;

  const byId = (id?: string | null) => (id ? products.list.find((product) => product.id === id) : undefined);

  async function purchaseStock(input: PurchaseInput) {
    const total = round2(toNum(input.quantity) * toNum(input.unit_cost));
    const paid = input.paidNow === null || input.paidNow === undefined ? total : round2(toNum(input.paidNow));
    const result = await usePurchasing().executePurchase({
      idempotencyKey: input.idempotencyKey || crypto.randomUUID(),
      supplier_id: input.supplier_id ?? null,
      supplier_name: input.supplier_name ?? null,
      supplier_ref: input.supplier_ref ?? null,
      items: [{
        product_id: input.product_id,
        quantity: input.quantity,
        unit_cost: input.unit_cost,
        unit_id: input.unit_id,
        unit_name: input.unit_name,
        unit_factor: input.unit_factor,
        pricing: input.pricing,
      }],
      paidNow: paid,
      note: input.note ?? null,
    });
    if (result.ok) products.invalidateCache();
    return result;
  }

  async function adjustStock(input: AdjustInput): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!input.product_id) return { ok: false, error: "حدد النوع المخزني أولًا." };
    if (!input.note?.trim()) return { ok: false, error: "سبب التعديل مطلوب." };
    if (!Number.isFinite(input.new_quantity) || input.new_quantity < 0 || Math.abs(round4(input.new_quantity) - input.new_quantity) > 1e-9) {
      return { ok: false, error: "الكمية الجديدة غير صالحة؛ الحد الأقصى أربع منازل عشرية." };
    }
    if (input.bucket === "package" && !Number.isInteger(input.new_quantity)) {
      return { ok: false, error: "عدد العبوات المغلقة يجب أن يكون رقمًا صحيحًا." };
    }
    try {
      const payload = {
        product_id: input.product_id, bucket: input.bucket, unit_id: input.unit_id ?? null,
        new_quantity: input.new_quantity, note: input.note.trim(),
      };
      const fingerprint = JSON.stringify(payload);
      if (pendingAdjustment?.fingerprint !== fingerprint) pendingAdjustment = { fingerprint, requestId: crypto.randomUUID() };
      await callStaff("adjustInventoryBucket", {
        ...payload, requestId: pendingAdjustment.requestId,
      });
      pendingAdjustment = null;
      products.invalidateCache();
      return { ok: true };
    } catch (error) {
      console.error(error);
      return { ok: false, error: error instanceof Error ? error.message : "تعذر حفظ التعديل." };
    }
  }

  return { byId, purchaseStock, adjustStock };
});
