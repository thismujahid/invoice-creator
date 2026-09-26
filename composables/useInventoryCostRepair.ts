import { collection, doc, getDocs, query } from "firebase/firestore";
import type { InventoryTransaction, InventoryTransactionType } from "~/types/finance";
import type { Product } from "~/types";
import { movingAverageCost, round2, toNum } from "./finance";
import { toDateSafe } from "~/types";

export type RepairStatus = "OK" | "REPAIRABLE" | "STOCK_MISMATCH" | "INSUFFICIENT_HISTORY" | "INVALID_HISTORY";

export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  OK: "سليم",
  REPAIRABLE: "قابل للإصلاح",
  STOCK_MISMATCH: "اختلاف مخزون",
  INSUFFICIENT_HISTORY: "سجل ناقص",
  INVALID_HISTORY: "سجل غير صالح",
};

export interface RepairRow {
  product_id: string;
  product_name: string;
  currentStock: number | null;
  replayedStock: number;
  currentCost: number | null;
  recomputedCost: number | null;
  difference: number | null;
  status: RepairStatus;
}

const QTY_EPS = 1e-6;
const MONEY_EPS = 0.005;

function hasKnownCost(v: unknown): v is number {
  return v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
}

interface ReplayStep {
  stockIn: number;
  stockOut: number;
  knownCost: number | null; // null = no cost effect
}

/** Explicit classification of every movement type — nothing ignored silently. */
function classify(t: InventoryTransaction): ReplayStep | { invalid: string } {
  const qty = toNum(t.quantity);
  if (!Number.isFinite(qty) || qty < 0) return { invalid: "invalid quantity" };
  switch (t.type as InventoryTransactionType) {
    case "opening_stock":
      if (t.direction !== "in") return { invalid: "opening must be in" };
      if (!hasKnownCost(t.unit_cost)) return { invalid: "opening without cost" };
      return { stockIn: qty, stockOut: 0, knownCost: Number(t.unit_cost) };
    case "purchase":
      if (t.direction !== "in") return { invalid: "purchase must be in" };
      if (!hasKnownCost(t.unit_cost)) return { invalid: "purchase without cost" };
      return { stockIn: qty, stockOut: 0, knownCost: Number(t.unit_cost) };
    case "sale":
      if (t.direction === "out") return { stockIn: 0, stockOut: qty, knownCost: null };
      if (t.direction === "in") {
        // Edit-restore re-enters at historical cost (mirrors runtime).
        if (!hasKnownCost(t.unit_cost)) return { invalid: "edit-restore without cost" };
        return { stockIn: qty, stockOut: 0, knownCost: Number(t.unit_cost) };
      }
      return { invalid: "unknown sale direction" };
    case "refund":
      if (t.direction !== "in") return { stockIn: 0, stockOut: qty, knownCost: null };
      if (!hasKnownCost(t.unit_cost)) return { invalid: "refund without cost" };
      return { stockIn: qty, stockOut: 0, knownCost: Number(t.unit_cost) };
    case "manual_adjustment":
      if (t.direction === "in") return { stockIn: qty, stockOut: 0, knownCost: null };
      if (t.direction === "out") return { stockIn: 0, stockOut: qty, knownCost: null };
      return { invalid: "unknown adjustment direction" };
    default:
      return { invalid: `unknown type ${(t as { type?: unknown }).type}` };
  }
}

export const useInventoryCostRepair = defineStore("inventoryCostRepair", () => {
  const { db, serverTimestamp, readFrom } = useFirebase();
  const authStore = useAuth();

  /** Analyze all products: replay full movement history, compare, classify. */
  async function analyze(
    onProgress?: (done: number, total: number) => void,
  ): Promise<RepairRow[]> {
    const [products, txSnap] = await Promise.all([
      readFrom<Product>("products"),
      getDocs(query(collection(db, "inventory_transactions"))),
    ]);
    const byProduct = new Map<string, InventoryTransaction[]>();
    for (const d of txSnap.docs) {
      const t = { id: d.id, ...(d.data() as object) } as InventoryTransaction;
      if (!t.product_id) continue;
      if (!byProduct.has(t.product_id)) byProduct.set(t.product_id, []);
      byProduct.get(t.product_id)!.push(t);
    }
    // Strict chronological order (missing timestamp = unordered = invalid).
    for (const list of byProduct.values()) {
      list.sort((a, b) => {
        const da = toDateSafe(a.created_at)?.getTime();
        const db2 = toDateSafe(b.created_at)?.getTime();
        if (da === undefined || da === null || Number.isNaN(da)) return 1;
        if (db2 === undefined || db2 === null || Number.isNaN(db2)) return -1;
        return (da as number) - (db2 as number);
      });
    }

    const rows: RepairRow[] = [];
    let done = 0;
    for (const p of products) {
      if (!p.id) continue;
      rows.push(analyzeOne(p, byProduct.get(p.id) ?? []));
      done += 1;
      if (done % 20 === 0) onProgress?.(done, products.length);
    }
    onProgress?.(products.length, products.length);
    return rows;
  }

  function analyzeOne(p: Product, txns: InventoryTransaction[]): RepairRow {
    const base = {
      product_id: p.id as string,
      product_name: p.name,
      currentStock: (p.stock_quantity ?? null) as number | null,
      replayedStock: 0,
      currentCost: (p.cost_price ?? null) as number | null,
      recomputedCost: null as number | null,
      difference: null as number | null,
      status: "OK" as RepairStatus,
    };
    let stock = 0;
    let avg: number | undefined;
    for (const t of txns) {
      // Missing timestamp breaks chronological order → unreliable.
      const ts = toDateSafe(t.created_at)?.getTime();
      if (ts === undefined || ts === null || Number.isNaN(ts)) {
        return { ...base, replayedStock: round2(stock), status: "INVALID_HISTORY" };
      }
      const step = classify(t);
      if ("invalid" in step) {
        return { ...base, replayedStock: round2(stock), status: "INVALID_HISTORY" };
      }
      const preStock = stock;
      stock = round2(stock + step.stockIn - step.stockOut);
      if (stock < -QTY_EPS) {
        return { ...base, replayedStock: stock, status: "INVALID_HISTORY" };
      }
      if (step.stockIn > 0 && step.knownCost !== null) {
        // Mirror runtime: cost is round2'd on every persist.
        avg = round2(movingAverageCost(preStock, avg ?? 0, step.stockIn, step.knownCost));
      }
    }
    return finishRow(base, p, stock, avg);
  }

  function finishRow(
    base: Omit<RepairRow, "replayedStock" | "recomputedCost" | "difference" | "status">,
    p: Product,
    stock: number,
    avg: number | undefined,
  ): RepairRow {
    const replayedStock = round2(stock);
    const recomputedCost = avg === undefined ? null : round2(avg);
    const storedStock = p.stock_quantity ?? null;
    const storedCost = p.cost_price ?? null;
    // Stock compare (stored null counts as 0 for matching purposes).
    if (Math.abs(replayedStock - (storedStock ?? 0)) > QTY_EPS) {
      return { ...base, replayedStock, recomputedCost, difference: null, status: "STOCK_MISMATCH" };
    }
    if (recomputedCost === null) {
      if ((storedStock ?? 0) > 0 || storedCost !== null) {
        return { ...base, replayedStock, recomputedCost, difference: null, status: "INSUFFICIENT_HISTORY" };
      }
      return { ...base, replayedStock, recomputedCost, difference: 0, status: "OK" };
    }
    if (storedCost === null) {
      // Authoritative history, no stored value — safe to set.
      return { ...base, replayedStock, recomputedCost, difference: recomputedCost, status: "REPAIRABLE" };
    }
    if (Math.abs(recomputedCost - storedCost) <= MONEY_EPS) {
      return { ...base, replayedStock, recomputedCost, difference: 0, status: "OK" };
    }
    return { ...base, replayedStock, recomputedCost, difference: round2(recomputedCost - storedCost), status: "REPAIRABLE" };
  }

  /** Apply a repair: re-reads the product, skips if stock/cost moved since
   *  analysis (optimistic guard), writes cost + audit record atomically. */
  async function applyOne(
    row: RepairRow,
    reason: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (row.status !== "REPAIRABLE" || row.recomputedCost === null) {
      return { ok: false, error: "غير قابل للإصلاح." };
    }
    try {
      const res: { ok: true } | { ok: false; error: string } = { ok: true };
      await runTx(async (tx) => {
        const pRef = doc(db, "products", row.product_id);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error("VALIDATION:المنتج غير موجود.");
        const curCost = pSnap.data().cost_price ?? null;
        const curStock = pSnap.data().stock_quantity ?? null;
        // Guard: abort if the product moved since analysis.
        if (
          Math.abs(toNum(curStock) - toNum(row.currentStock)) > QTY_EPS ||
          (curCost !== null &&
            curCost !== undefined &&
            row.currentCost !== null &&
            Math.abs(Number(curCost) - Number(row.currentCost)) > MONEY_EPS)
        ) {
          throw new Error("VALIDATION:تغيّر المنتج أثناء المراجعة — أعد التحليل.");
        }
        const now = serverTimestamp();
        tx.update(pRef, { cost_price: row.recomputedCost });
        tx.set(doc(collection(db, "inventory_cost_adjustments")), {
          product_id: row.product_id,
          old_cost: row.currentCost,
          new_cost: row.recomputedCost,
          created_by: creator(),
          created_at: now,
          reason,
        });
      });
      return res;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("VALIDATION:")) {
        return { ok: false, error: e.message.slice("VALIDATION:".length) };
      }
      console.error(e);
      return { ok: false, error: "تعذر تطبيق الإصلاح." };
    }
  }

  /** Bulk apply: only REPAIRABLE rows, sequential transactions, counts. */
  async function applyMany(
    rows: RepairRow[],
    reason: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ applied: number; skipped: number; failed: number }> {
    let applied = 0;
    let skipped = 0;
    let failed = 0;
    const targets = rows.filter((r) => r.status === "REPAIRABLE" && r.recomputedCost !== null);
    skipped = rows.length - targets.length;
    let done = 0;
    for (const r of targets) {
      const res = await applyOne(r, reason);
      if (res.ok) applied += 1;
      else failed += 1;
      done += 1;
      onProgress?.(done, targets.length);
    }
    return { applied, skipped, failed };
  }

  function creator(): string | null {
    const authStore = useAuth();
    return (authStore.currentUserKey as string) || null;
  }

  return { analyze, applyOne, applyMany };
});
