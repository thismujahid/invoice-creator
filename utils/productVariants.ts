import { unitReferenceCost } from "../functions/shared/unitPricing.mjs";
import type { Product } from "~/types";

export function cloneVariantSettings(source: Product): Product {
  return {
    name: "",
    variant_name: "",
    inventory_mode: source.inventory_mode ?? "convertible",
    variant_key: null,
    pack_size_name: source.pack_size_name ?? null,
    pack_size_order: source.pack_size_order,
    family_id: source.family_id,
    family_name: source.family_name,
    cost_price: null,
    base_unit_id: source.base_unit_id,
    base_unit_name: source.base_unit_name,
    units: (source.units || []).filter((unit) => !unit.archived).map((unit) => ({
      ...unit,
      profit_margin: unit.profit_margin ?? ((unitReferenceCost(source, unit) ?? 0) > 0 && unit.selling_price != null ? unit.selling_price / unitReferenceCost(source, unit)! - 1 : null),
      purchase_price_history: null,
    })),
    inventory: { loose_base_quantity: 0, closed_packages: {} },
    inventory_alerts: source.inventory_alerts ? {
      loose: source.inventory_alerts.loose ? { ...source.inventory_alerts.loose } : undefined,
      packages: Object.fromEntries(Object.entries(source.inventory_alerts.packages || {}).map(([id, alert]) => [id, { ...alert }])),
    } : undefined,
  };
}

export function productFamilyKey(product: Product): string {
  return product.family_id || product.family_name?.trim().toLocaleLowerCase() || product.id || product.name;
}

export function groupProductVariants(products: Product[]): Array<{ id: string; name: string; variants: Product[] }> {
  const groups = new Map<string, { id: string; name: string; variants: Product[] }>();
  for (const product of products) {
    const id = productFamilyKey(product);
    let group = groups.get(id);
    if (!group) {
      group = { id, name: product.family_name || product.name, variants: [] };
      groups.set(id, group);
    }
    group.variants.push(product);
  }
  return [...groups.values()].map((group) => ({ ...group, variants: group.variants.sort((a, b) => (a.variant_order ?? 0) - (b.variant_order ?? 0) || (a.pack_size_order ?? 0) - (b.pack_size_order ?? 0)) }));
}

export function groupProductsByVariant(products: Product[]): Array<{ key: string; name: string; products: Product[] }> {
  const groups = new Map<string, { key: string; name: string; products: Product[] }>();
  for (const product of products) {
    const key = product.variant_key || (product.uses_variants === false ? "default" : product.variant_name || product.id || "default");
    let group = groups.get(key);
    if (!group) {
      group = { key, name: product.uses_variants === false ? "أساسي" : product.variant_name || "أساسي", products: [] };
      groups.set(key, group);
    }
    group.products.push(product);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, products: group.products.sort((a, b) => (a.pack_size_order ?? 0) - (b.pack_size_order ?? 0)) }))
    .sort((a, b) => (a.products[0]?.variant_order ?? 0) - (b.products[0]?.variant_order ?? 0));
}

export function productSkuLabel(product: Product): string {
  if (product.inventory_mode === "independent") {
    return product.uses_variants === false
      ? product.pack_size_name || product.name
      : [product.variant_name, product.pack_size_name].filter(Boolean).join(" — ");
  }
  return product.uses_variants === false ? product.family_name || product.name : product.variant_name || product.name;
}
