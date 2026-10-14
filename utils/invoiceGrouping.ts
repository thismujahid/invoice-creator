import type { InvoiceProductLine } from "~/types";
import { round2, round4, toNum } from "~/composables/finance";

export interface GroupedSubLine {
  /** Position inside the flat Invoice.products array. */
  index: number;
  line: InvoiceProductLine;
}

export interface InvoiceLineGroup {
  /** Stable grouping key: family id when present, else the SKU id. */
  key: string;
  familyId: string | null;
  familyName: string | null;
  inventoryMode: "convertible" | "independent";
  /** True when every sub-line is still an empty draft. */
  isEmpty: boolean;
  lines: GroupedSubLine[];
  total: number;
}

/** Grouping identity uses ids, never display names. */
export function invoiceLineGroupKey(
  line: Pick<InvoiceProductLine, "family_id" | "product_id">,
): string {
  const family = String(line.family_id ?? "").trim();
  if (family) return `family:${family}`;
  const product = String(line.product_id ?? "").trim();
  if (product) return `product:${product}`;
  return "__empty__";
}

export function invoiceGroupTitle(group: InvoiceLineGroup): string {
  if (group.familyName) return group.familyName;
  const first = group.lines[0]?.line;
  return first?.product_name || "منتج جديد";
}

/** Display label of one invoice line from its snapshot (variant — pack),
 *  never the live catalog. Single source for editor summaries and tables. */
export function invoiceVariantLabel(line: Pick<InvoiceProductLine, "variant_name" | "pack_size_name" | "product_name">): string {
  const parts = [line.variant_name, line.pack_size_name].map((part) => String(part ?? "").trim()).filter(Boolean);
  if (parts.length) return parts.join(" — ");
  return String(line.product_name || "صنف");
}
/** Display order = first occurrence in the flat array (single source of truth). */
export function groupInvoiceLines(lines: InvoiceProductLine[]): InvoiceLineGroup[] {
  const order = new Map<string, InvoiceLineGroup>();
  const empties: InvoiceLineGroup[] = [];
  lines.forEach((line, index) => {
    if (!line.product_id && !line.family_id) {
      empties.push({
        key: `__empty__:${index}`,
        familyId: null,
        familyName: null,
        inventoryMode: "convertible",
        isEmpty: true,
        lines: [{ index, line }],
        total: 0,
      });
      return;
    }
    const key = invoiceLineGroupKey(line);
    let group = order.get(key);
    if (!group) {
      group = {
        key,
        familyId: line.family_id ?? null,
        familyName: line.family_name ?? null,
        inventoryMode: line.inventory_mode === "independent" ? "independent" : "convertible",
        isEmpty: false,
        lines: [],
        total: 0,
      };
      order.set(key, group);
    }
    group.lines.push({ index, line });
    if (!group.familyName && line.family_name) group.familyName = line.family_name;
    if (line.inventory_mode === "independent") group.inventoryMode = "independent";
  });
  const groups = [...order.values(), ...empties];
  for (const group of groups) {
    group.isEmpty = group.lines.every(({ line }) => !line.product_id);
    group.total = round2(
      group.lines.reduce((sum, { line }) => sum + toNum(line.product_price) * toNum(line.product_quantity), 0),
    );
  }
  return groups;
}

/** Flatten grouped order back to the single flat list (reorder support). */
export function flattenGroupedLines(groups: InvoiceLineGroup[]): InvoiceProductLine[] {
  return groups.flatMap((group) => group.lines.map(({ line }) => line));
}

/** Move a whole group; identity and amounts travel with the lines. */
export function moveGroup(lines: InvoiceProductLine[], fromGroup: number, toGroup: number): InvoiceProductLine[] {
  const groups = groupInvoiceLines(lines);
  if (fromGroup < 0 || fromGroup >= groups.length || toGroup < 0 || toGroup >= groups.length) return [...lines];
  const [moved] = groups.splice(fromGroup, 1);
  if (!moved) return [...lines];
  groups.splice(toGroup, 0, moved);
  return flattenGroupedLines(groups);
}

/** Reorder sub-lines inside one group by their positions within the group. */
export function moveSubLine(
  lines: InvoiceProductLine[],
  groupKey: string,
  from: number,
  to: number,
): InvoiceProductLine[] {
  const groups = groupInvoiceLines(lines);
  const group = groups.find((entry) => entry.key === groupKey);
  if (!group || from < 0 || from >= group.lines.length || to < 0 || to >= group.lines.length) return [...lines];
  const [moved] = group.lines.splice(from, 1);
  if (!moved) return [...lines];
  group.lines.splice(to, 0, moved);
  return flattenGroupedLines(groups);
}

/** Client-stable id for a new draft line (server mints the persisted id). */
export function newDraftLineId(generate: () => string = defaultId): string {
  return `draft-${generate()}`;
}

function defaultId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

/** Assign stable draft ids to new lines lacking one (never rewrites kept ids). */
export function ensureStableLineIds(
  lines: InvoiceProductLine[],
  generate: () => string = defaultId,
): InvoiceProductLine[] {
  const used = new Set(lines.map((line) => String(line.line_id ?? "")).filter(Boolean));
  for (const line of lines) {
    if (line.line_id) continue;
    let candidate = newDraftLineId(generate);
    while (used.has(candidate)) candidate = newDraftLineId(generate);
    used.add(candidate);
    line.line_id = candidate;
  }
  return lines;
}

export function findDuplicateLineIds(lines: Pick<InvoiceProductLine, "line_id">[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const line of lines) {
    const id = String(line.line_id ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

/** Aggregate base-unit demand per SKU across ALL lines (multi-unit aware). */
export function aggregateBaseNeedByProduct(
  lines: Pick<InvoiceProductLine, "product_id" | "product_quantity" | "unit_factor">[],
): Map<string, number> {
  const need = new Map<string, number>();
  for (const line of lines) {
    const id = String(line.product_id ?? "");
    if (!id) continue;
    const factor = Number(line.unit_factor);
    if (!Number.isFinite(factor) || factor <= 0) {
      need.set(id, Number.POSITIVE_INFINITY);
      continue;
    }
    need.set(id, round4((need.get(id) ?? 0) + Number(line.product_quantity || 0) * factor));
  }
  return need;
}
