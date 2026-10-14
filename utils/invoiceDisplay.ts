import type { InventoryMode, InvoiceProductLine } from "~/types";
import { round2, round4, toNum } from "~/composables/finance";
import { toDateSafe } from "~/types";

/**
 * Presentation-only invoice display rows.
 *
 * Pure, deterministic transformation from stored `InvoiceProductLine[]`
 * into compact printable rows that reproduce the Egyptian grocery reference:
 * one visible row per product family when unit semantics and price allow it,
 * otherwise separate rows. Never mutates the input, never parses identities
 * from human-readable strings, never changes financial semantics.
 */

export interface InvoiceDisplayRow {
  /** Stable display key (family/product identity + unit + price). */
  key: string;
  familyId: string | null;
  familyName: string;
  /** Shared sale-unit name when all grouped lines agree, else "". */
  unitName: string;
  displayQuantity: number;
  /** Common unit price when every grouped line shares it, else null. */
  displayPrice: number | null;
  /** Sorted unique unit prices of the grouped lines (money, raw numbers). */
  unitPrices: number[];
  displayTotal: number;
  /** Compact Arabic description, e.g. "كرتونة مكرونة فيروز 2ش 2ل 2ق". */
  name: string;
  /** Position of the first source line (preserves invoice ordering). */
  order: number;
  lineCount: number;
  inventoryMode: InventoryMode;
  /** Indexes into the original input array, in original order. */
  sourceIndexes: number[];
}

const NO_VARIANT_TOKENS = new Set(["", "أساسي", "اساسي", "default"]);

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function norm(value: unknown): string {
  return clean(value).toLocaleLowerCase();
}

function isNoVariant(variantName: string, familyName: string): boolean {
  if (NO_VARIANT_TOKENS.has(variantName.trim())) return true;
  if (!variantName) return true;
  if (norm(variantName) === norm(familyName) && familyName !== "") return true;
  return false;
}

/** Empty editor drafts carry no content and are skipped; legacy lines that
 *  kept a product name / price / quantity but lost their ids still print. */
function isEmptyDraft(line: InvoiceProductLine): boolean {
  if (clean(line.product_id) || clean(line.family_id)) return false;
  if (clean(line.product_name)) return false;
  if (toNum(line.product_price) !== 0 || toNum(line.product_quantity) !== 0) return false;
  return true;
}
/** Identity for grouping: stable ids only, never display names. */
function familyBucketKey(line: InvoiceProductLine, index: number): string {
  const family = clean(line.family_id);
  if (family) return `family:${family}`;
  const product = clean(line.product_id);
  if (product) return `product:${product}`;
  // Legacy lines without any id: never merge, one row each.
  return `__line__:${index}`;
}

/**
 * Compatibility inside one family bucket.
 * Same inventory mode + same unit identity (stable unit_id when present,
 * otherwise normalized name + factor + kind) + same pack (independent mode
 * only) + same unit price. Different prices always split so no average or
 * misleading single price is ever shown.
 */
function displaySubKey(line: InvoiceProductLine): string {
  const mode: InventoryMode = line.inventory_mode === "independent" ? "independent" : "convertible";
  const unitId = clean(line.unit_id);
  const factorNum = Number(line.unit_factor);
  const factorKey = Number.isFinite(factorNum) && factorNum > 0 ? String(factorNum) : "?";
  const stockKind = clean(line.stock_kind);
  const pack = mode === "independent" ? norm(line.pack_size_name) : "";
  const priceKey = `p:${round2(toNum(line.product_price))}`;
  const unitKey = unitId
    ? `uid:${unitId}|f:${factorKey}|s:${stockKind}|pack:${pack}`
    : `uname:${norm(line.unit_name)}|f:${factorKey}|s:${stockKind}|pack:${pack}`;
  return `${mode}|${unitKey}|${priceKey}`;
}

/** "25 كيلو" -> "25ك" | "كيلو" -> "ك" | "كرتونة" -> "ك" (suffix use only). */
export function abbreviateUnitSuffix(unitName: string): string {
  const raw = clean(unitName);
  if (!raw) return "";
  const numMatch = /^([\d.,\u0660-\u0669]+)\s+(.+)$/.exec(raw);
  if (numMatch) {
    const num = numMatch[1]!;
    const rest = clean(numMatch[2]);
    const first = firstLetter(rest);
    return first ? `${num}${first}` : num;
  }
  return firstLetter(raw) || raw;
}

function firstLetter(text: string): string {
  const t = clean(text).replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t[0] ?? "";
}

/**
 * Strip a leading definite article / hamza-alif so the abbreviation carries
 * the first *distinctive* letter: "أقلام" -> "قلام" -> "ق",
 * "الشعرية" -> "شعرية" -> "ش". Falls back to the raw name when nothing left.
 */
function strippedVariant(name: string): string {
  const raw = clean(name).replace(/\s+/g, " ").trim();
  if (!raw) return "";
  let s = raw.replace(/^(ال|أل|إل|آل)/, "").trim();
  s = s.replace(/^[اأإآءؤئ]+/, "").trim();
  return s || raw;
}

/**
 * Concise Arabic variant abbreviations with collision expansion.
 * "شعرية" -> "ش", "لسان عصفور" -> "ل", "أقلام" -> "ق".
 * Only colliding groups are lengthened ("شعرية"/"شوفان" -> "شع"/"شو"
 * while a unique "ق" stays single-letter) — never ambiguous, never
 * hardcoded to one family.
 */
export function abbreviateVariants(names: string[]): Map<string, string> {
  const cleaned = names.map((n) => clean(n));
  const stripped = cleaned.map((n) => strippedVariant(n));
  const lens = cleaned.map(() => 1);
  const abbrOf = (i: number): string => {
    const s = stripped[i] ?? "";
    const len = lens[i] ?? 1;
    return s.slice(0, Math.max(1, len)) || cleaned[i]!;
  };
  for (;;) {
    const seen = new Map<string, number[]>();
    cleaned.forEach((_, i) => {
      const a = abbrOf(i);
      const list = seen.get(a);
      if (list) list.push(i);
      else seen.set(a, [i]);
    });
    const colliding = new Set<number>();
    for (const list of seen.values()) {
      if (list.length > 1) for (const i of list) colliding.add(i);
    }
    if (colliding.size === 0) break;
    let progressed = false;
    for (const i of colliding) {
      const maxLen = Math.max(stripped[i]!.length, cleaned[i]!.length);
      if (lens[i]! < maxLen) {
        lens[i]! += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const out = new Map<string, string>();
  cleaned.forEach((name, i) => {
    const s = stripped[i] ?? "";
    const abbr = s.slice(0, Math.max(1, lens[i] ?? 1)) || name;
    // Still colliding identical strippings (e.g. exact duplicates that
    // arrived as distinct keys): fall back to the full original name.
    const dup = cleaned.some((other, j) => j !== i && ((stripped[j] ?? "").slice(0, Math.max(1, lens[j] ?? 1)) || other) === abbr);
    out.set(name, dup && abbr !== name ? name : abbr);
  });
  return out;
}

/** Quantity formatting: integers plain, fractions up to 4 decimals trimmed. */
export function formatDisplayQuantity(qty: unknown): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return "";
  const r = round4(n);
  if (Number.isInteger(r)) return String(r);
  return String(r).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

interface VariantAccumulator {
  name: string;
  key: string;
  qty: number;
  firstIndex: number;
}

function variantIdentity(line: InvoiceProductLine): string {
  const key = clean(line.variant_key);
  if (key) return `key:${key}`;
  return `name:${norm(line.variant_name)}`;
}

function buildRowName(args: {
  familyName: string;
  commonUnit: string;
  commonPack: string;
  lines: InvoiceProductLine[];
}): string {
  const family = clean(args.familyName);
  const unit = clean(args.commonUnit);
  const pack = clean(args.commonPack);
  // Distinct variants in first-appearance order (qty summed per variant).
  const acc = new Map<string, VariantAccumulator>();
  for (const line of args.lines) {
    const vRaw = clean(line.variant_name);
    if (isNoVariant(vRaw, family)) continue;
    const id = variantIdentity(line);
    const entry = acc.get(id);
    if (entry) {
      entry.qty = round4(entry.qty + toNum(line.product_quantity));
    } else {
      acc.set(id, { name: vRaw, key: id, qty: toNum(line.product_quantity), firstIndex: acc.size });
    }
  }
  const variants = [...acc.values()];
  const base = family || clean(args.lines[0]?.product_name) || "صنف";

  if (variants.length === 0) {
    // No variants (e.g. uses_variants=false): unit + family + pack.
    const head = unit && norm(unit) !== norm(base) ? unit : "";
    const tail = pack && norm(pack) !== norm(base) && norm(pack) !== norm(unit) ? pack : "";
    return [head, base, tail].filter(Boolean).join(" ").trim() || base;
  }

  if (variants.length === 1) {
    // Single variant: "{variant} {family} {unit-abbrev} {pack?}".
    const v = variants[0]!.name;
    const suffix: string[] = [];
    if (unit && norm(unit) !== norm(v)) {
      const abbr = abbreviateUnitSuffix(unit);
      if (abbr) suffix.push(abbr);
    }
    if (pack && norm(pack) !== norm(v) && norm(pack) !== norm(unit)) suffix.push(pack);
    return [v, base, ...suffix].filter(Boolean).join(" ").trim();
  }

  // Multi-variant: "{unit} {family} {pack?} {qty+abbr...}".
  const abbrs = abbreviateVariants(variants.map((v) => v.name));
  const breakdown = variants
    .map((v) => `${formatDisplayQuantity(v.qty)}${abbrs.get(v.name) ?? v.name}`)
    .join(" ");
  const head = [unit, base, pack].filter(Boolean).join(" ").trim();
  return [head, breakdown].filter(Boolean).join(" ").trim();
}

/**
 * Build compact printable rows from stored invoice lines.
 * Pure: never mutates `lines`, preserves order deterministically.
 */
export function buildInvoiceDisplayRows(lines: InvoiceProductLine[]): InvoiceDisplayRow[] {
  const input = Array.isArray(lines) ? lines : [];
  // Bucket by family identity first (stable ids), keeping first-seen order.
  const buckets = new Map<string, { order: number; entries: { line: InvoiceProductLine; index: number }[] }>();
  input.forEach((line, index) => {
    if (!line || isEmptyDraft(line as InvoiceProductLine)) return;
    const bucket = familyBucketKey(line, index);
    let entry = buckets.get(bucket);
    if (!entry) {
      entry = { order: index, entries: [] };
      buckets.set(bucket, entry);
    }
    entry.entries.push({ line, index });
  });

  const rows: InvoiceDisplayRow[] = [];
  for (const [, bucket] of [...buckets.entries()].sort((a, b) => a[1].order - b[1].order)) {
    // Split each family bucket by unit compatibility + price.
    const subs = new Map<string, { line: InvoiceProductLine; index: number }[]>();
    for (const entry of bucket.entries) {
      const key = displaySubKey(entry.line);
      const list = subs.get(key);
      if (list) list.push(entry);
      else subs.set(key, [entry]);
    }
    const orderedSubs = [...subs.entries()].sort(
      (a, b) => Math.min(...a[1].map((e) => e.index)) - Math.min(...b[1].map((e) => e.index)),
    );
    for (const [subKey, entries] of orderedSubs) {
      const sorted = [...entries].sort((a, b) => a.index - b.index);
      const first = sorted[0]!.line;
      const familyId = clean(first.family_id) ? clean(first.family_id) : null;
      const familyName = clean(first.family_name) || clean(first.product_name) || "صنف";
      const mode: InventoryMode = first.inventory_mode === "independent" ? "independent" : "convertible";
      // Common unit only when every line agrees (normalized name + factor).
      const unitNames = sorted.map((e) => clean(e.line.unit_name));
      const factors = sorted.map((e) => Number(e.line.unit_factor));
      const sameUnitName = unitNames.every((u) => norm(u) === norm(unitNames[0]));
      const sameFactor = factors.every((f) => f === factors[0]);
      const commonUnit = sameUnitName ? unitNames[0] ?? "" : "";
      void sameFactor;
      const packs = sorted.map((e) => clean(e.line.pack_size_name));
      const commonPack = mode === "independent" && packs.every((p) => norm(p) === norm(packs[0])) ? (packs[0] ?? "") : "";
      const displayQuantity = round4(sorted.reduce((s, e) => s + toNum(e.line.product_quantity), 0));
      const unitPrices = [...new Set(sorted.map((e) => round2(toNum(e.line.product_price))))].sort((a, b) => a - b);
      const displayPrice = unitPrices.length === 1 ? (unitPrices[0] ?? 0) : null;
      const displayTotal = round2(sorted.reduce((s, e) => s + toNum(e.line.product_price) * toNum(e.line.product_quantity), 0));
      const name = buildRowName({
        familyName,
        commonUnit,
        commonPack,
        lines: sorted.map((e) => e.line),
      });
      const order = Math.min(...sorted.map((e) => e.index));
      rows.push({
        key: `${familyBucketKey(first, order)}|${subKey}`,
        familyId,
        familyName,
        unitName: commonUnit,
        displayQuantity,
        displayPrice,
        unitPrices,
        displayTotal,
        name,
        order,
        lineCount: sorted.length,
        inventoryMode: mode,
        sourceIndexes: sorted.map((e) => e.index),
      });
    }
  }
  return rows.sort((a, b) => a.order - b.order);
}

/** Lines-only subtotal of display rows (must match invoiceLinesSubtotal). */
export function displayRowsSubtotal(rows: Pick<InvoiceDisplayRow, "displayTotal">[]): number {
  return round2((rows ?? []).reduce((s, r) => s + toNum(r.displayTotal), 0));
}

/** Stored invoice timestamp (never the render time, never invented). */
export function resolveInvoiceDateTime(invoice: { date?: unknown; time?: unknown }): Date | null {
  return toDateSafe(invoice.date) ?? toDateSafe(invoice.time) ?? null;
}

/** DD/MM/YYYY from the stored invoice timestamp; "—" when missing. */
export function formatInvoiceDateDMY(invoice: { date?: unknown; time?: unknown }): string {
  const d = resolveInvoiceDateTime(invoice);
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/** hh:mm AM/PM from the stored invoice timestamp; "—" when missing. */
export function formatInvoiceTimeAMPM(invoice: { date?: unknown; time?: unknown }): string {
  const d = resolveInvoiceDateTime(invoice);
  if (!d) return "—";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${m} ${suffix}`;
}
