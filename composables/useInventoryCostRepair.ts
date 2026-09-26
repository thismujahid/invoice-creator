import { collection, doc, getDocs, query, where } from "firebase/firestore";
import type { InventoryTransaction, InventoryTransactionType } from "~/types/finance";
import type { Product } from "~/types";
import { applyStockGroup, round2, toNum } from "./finance";
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
  /** Analysis snapshot for Apply-time re-verification (§1.4). */
  txnCount: number;
  lastTxnMs: number;
  txnIds: string[];
  txnFingerprint: string;
  lastMovementId: string | null;
  lastMovementIds: string[];
}

const QTY_EPS = 1e-6;
const MONEY_EPS = 0.005;

function hasKnownCost(v: unknown): v is number {
  return (
    v !== null &&
    v !== undefined &&
    v !== "" &&
    Number.isFinite(Number(v)) &&
    Number(v) >= 0
  );
}

interface ReplayStep {
  stockIn: number;
  stockOut: number;
  knownCost: number | null; // null = no cost effect
}

/** Explicit classification of every movement type — nothing ignored silently.
 *  Quantities must be finite and > 0; required costs must be present,
 *  finite and non-negative (never coerced from null to 0). */
function classify(t: InventoryTransaction): ReplayStep | { invalid: string } {
  const qty = toNum(t.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return { invalid: "invalid quantity" };
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

function transactionFingerprint(transactions: InventoryTransaction[]): string {
  const evidence = transactions
    .map((transaction) => ({
      id: transaction.id ?? "",
      product_id: transaction.product_id ?? null,
      type: transaction.type ?? null,
      direction: transaction.direction ?? null,
      quantity: transaction.quantity ?? null,
      unit_cost: transaction.unit_cost ?? null,
      invoice_id: transaction.invoice_id ?? null,
      return_id: transaction.return_id ?? null,
      purchase_invoice_id: transaction.purchase_invoice_id ?? null,
      seq: transaction.seq ?? null,
      created_at: toDateSafe(transaction.created_at)?.getTime() ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(evidence);
}

function isOneAtomicMovementGroup(transactions: InventoryTransaction[]): boolean {
  if (transactions.length <= 1) return true;
  const first = transactions[0]!;
  if (first.type === "purchase" && first.purchase_invoice_id) {
    return transactions.every((transaction) => transaction.type === "purchase" && transaction.purchase_invoice_id === first.purchase_invoice_id);
  }
  if (first.type === "refund" && first.return_id) {
    return transactions.every((transaction) => transaction.type === "refund" && transaction.return_id === first.return_id);
  }
  if (first.type === "sale" && first.invoice_id) {
    return transactions.every((transaction) => transaction.type === "sale" && transaction.invoice_id === first.invoice_id);
  }
  return false;
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
      txnCount: txns.length,
      lastTxnMs: 0,
      txnIds: txns.map((t) => t.id ?? "").filter(Boolean).sort(),
      txnFingerprint: transactionFingerprint(txns),
      lastMovementId: p.last_inventory_transaction_id ?? null,
      lastMovementIds: [...(p.last_inventory_transaction_ids ?? [])].sort(),
    };
    // Deterministic order: timestamp, then write sequence, then doc id.
    // A missing timestamp anywhere makes ordering unreliable → invalid.
    const ordered = [...txns].sort((a, b) => {
      const da = toDateSafe(a.created_at)?.getTime();
      const db2 = toDateSafe(b.created_at)?.getTime();
      if (da === undefined || da === null || Number.isNaN(da)) return 1;
      if (db2 === undefined || db2 === null || Number.isNaN(db2)) return -1;
      if (da !== db2) return (da as number) - (db2 as number);
      const sa = a.seq ?? Number.POSITIVE_INFINITY;
      const sb = b.seq ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    });
    for (const t of ordered) {
      const ts = toDateSafe(t.created_at)?.getTime();
      if (ts === undefined || ts === null || Number.isNaN(ts)) {
        return { ...base, replayedStock: 0, status: "INVALID_HISTORY" };
      }
    }
    // Group by identical millisecond: one atomic batch each. A group with
    // several cost-bearing inflows whose order can't be established (any
    // missing seq) is genuinely ambiguous → invalid, never guessed.
    const groups = new Map<number, InventoryTransaction[]>();
    for (const t of ordered) {
      const ms = toDateSafe(t.created_at)!.getTime();
      if (!groups.has(ms)) groups.set(ms, []);
      groups.get(ms)!.push(t);
    }
    let stock = 0;
    let avg: number | undefined;
    let untrusted = false;
    let lastMs = 0;
    for (const [ms, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      lastMs = ms;
      const steps: { qty: number; cost: number | null; dir: "in" | "out" }[] = [];
      for (const t of list) {
        const step = classify(t);
        if ("invalid" in step) {
          return { ...base, replayedStock: round2(stock), status: "INVALID_HISTORY" };
        }
        steps.push(step.stockIn > 0
          ? { qty: step.stockIn, cost: step.knownCost, dir: "in" as const }
          : { qty: step.stockOut, cost: null, dir: "out" as const });
      }
      const costInflows = steps.filter((s) => s.dir === "in" && s.cost !== null);
      const hasInflowAndOutflow = costInflows.length > 0 && steps.some((s) => s.dir === "out");
      const hasAmbiguousCostOrder = costInflows.length > 0 && steps.length > 1 && !isOneAtomicMovementGroup(list);
      const seqs = list.map((transaction) => transaction.seq).filter((seq): seq is number => typeof seq === "number");
      const hasDuplicateSeq = seqs.length !== new Set(seqs).size;
      if (
        hasAmbiguousCostOrder ||
        (costInflows.length > 0 && hasDuplicateSeq) ||
        (costInflows.length > 1 || hasInflowAndOutflow) &&
        list.some((t) => t.seq === null || t.seq === undefined)
      ) {
        return { ...base, replayedStock: round2(stock), status: "INVALID_HISTORY" };
      }
      // Costless stock inflows cannot safely establish the average cost basis.
      for (const s of steps) {
        if (s.dir === "in" && s.cost === null) untrusted = true;
      }
      const outs = round2(steps.filter((s) => s.dir === "out").reduce((a, s) => a + s.qty, 0));
      const ins = steps
        .filter((s) => s.dir === "in")
        .map((s) => ({ qty: s.qty, cost: s.cost }));
      const r = applyStockGroup(stock, avg, outs, ins);
      stock = r.stock;
      avg = r.avg;
      if (stock < -QTY_EPS) {
        return { ...base, replayedStock: stock, status: "INVALID_HISTORY" };
      }
    }
    base.lastTxnMs = lastMs;
    return finishRow(base, p, stock, avg, untrusted);
  }

  function finishRow(
    base: Omit<RepairRow, "replayedStock" | "recomputedCost" | "difference" | "status">,
    p: Product,
    stock: number,
    avg: number | undefined,
    untrusted: boolean,
  ): RepairRow {
    const replayedStock = round2(stock);
    const recomputedCost = avg === undefined ? null : round2(avg);
    const storedStock = p.stock_quantity ?? null;
    const storedCost = p.cost_price ?? null;
    // Stock compare (stored null counts as 0 for matching purposes).
    if (Math.abs(replayedStock - (storedStock ?? 0)) > QTY_EPS) {
      return { ...base, replayedStock, recomputedCost, difference: null, status: "STOCK_MISMATCH" };
    }
    if (Math.abs(replayedStock) <= QTY_EPS) {
      // Nothing on hand: cost is moot regardless of trust.
      return { ...base, replayedStock, recomputedCost, difference: 0, status: "OK" };
    }
    // Untrusted basis (unexplained opening / costless seeding): a matching
    // final stock proves nothing about the cost — never mark REPAIRABLE.
    if (untrusted) {
      return { ...base, replayedStock, recomputedCost, difference: null, status: "INSUFFICIENT_HISTORY" };
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

  /** Apply a repair only while the product and all analyzed movements match. */
  async function applyOne(
    row: RepairRow,
    reason: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (row.status !== "REPAIRABLE" || row.recomputedCost === null) {
      return { ok: false, error: "غير قابل للإصلاح." };
    }
    if (row.txnIds.length > 450) {
      return { ok: false, error: "سجل الحركات أكبر من حد التحقق الذري — لم يُطبق الإصلاح." };
    }
    try {
      const logSnap = await getDocs(query(collection(db, "inventory_transactions"), where("product_id", "==", row.product_id)));
      const freshTransactions = logSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as InventoryTransaction);
      if (
        logSnap.size !== row.txnCount ||
        transactionFingerprint(freshTransactions) !== row.txnFingerprint
      ) {
        return { ok: false, error: "تغيّر سجل الحركات أثناء المراجعة — أعد التحليل." };
      }
      const res: { ok: true } | { ok: false; error: string } = { ok: true };
      await runTx(async (tx) => {
        const pRef = doc(db, "products", row.product_id);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error("VALIDATION:المنتج غير موجود.");
        const currentTransactions: InventoryTransaction[] = [];
        for (const transactionId of row.txnIds) {
          const transactionSnap = await tx.get(doc(db, "inventory_transactions", transactionId));
          if (!transactionSnap.exists()) throw new Error("VALIDATION:تغيّر سجل الحركات أثناء المراجعة — أعد التحليل.");
          currentTransactions.push({ id: transactionSnap.id, ...(transactionSnap.data() as object) } as InventoryTransaction);
        }
        if (transactionFingerprint(currentTransactions) !== row.txnFingerprint) {
          throw new Error("VALIDATION:تغيّر سجل الحركات أثناء المراجعة — أعد التحليل.");
        }
        const curCostRaw = pSnap.data().cost_price;
        const curCost = curCostRaw ?? null;
        const curStock = pSnap.data().stock_quantity ?? null;
        const currentLastMovementId = pSnap.data().last_inventory_transaction_id ?? null;
        const currentLastMovementIds = [
          ...((pSnap.data().last_inventory_transaction_ids ?? []) as string[]),
        ].sort();
        // Guard 1: explicit null-vs-number comparison (a null↔value flip counts).
        const costPresenceChanged =
          (curCost === null || curCost === undefined) !==
          (row.currentCost === null || row.currentCost === undefined);
        // Guard 2: values moved since analysis.
        const costMoved =
          !costPresenceChanged &&
          curCost !== null &&
          curCost !== undefined &&
          row.currentCost !== null &&
          Math.abs(Number(curCost) - Number(row.currentCost)) > MONEY_EPS;
        const stockPresenceChanged =
          (curStock === null || curStock === undefined) !==
          (row.currentStock === null || row.currentStock === undefined);
        const stockMoved =
          !stockPresenceChanged &&
          Math.abs(toNum(curStock) - toNum(row.currentStock)) > QTY_EPS;
        if (
          stockPresenceChanged ||
          stockMoved ||
          costPresenceChanged ||
          costMoved ||
          currentLastMovementId !== row.lastMovementId ||
          JSON.stringify(currentLastMovementIds) !== JSON.stringify(row.lastMovementIds)
        ) {
          throw new Error("VALIDATION:تغيّر المنتج أثناء المراجعة — أعد التحليل.");
        }
        const now = serverTimestamp();
        const adjustmentRef = doc(collection(db, "inventory_cost_adjustments"));
        tx.update(pRef, { cost_price: row.recomputedCost, last_cost_adjustment_id: adjustmentRef.id });
        tx.set(adjustmentRef, {
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
