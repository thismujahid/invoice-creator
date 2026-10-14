export interface PricingUnit {
  id: string;
  factor: number;
  selling_price: number | null;
  purchase_price?: number | null;
  profit_margin?: number | null;
  can_sell?: boolean;
  archived?: boolean;
}
export interface PricingProduct<U extends PricingUnit = PricingUnit> {
  cost_price?: number | null;
  last_purchase_base_cost?: number | null;
  units?: U[];
}
export function unitReferenceCost(product: PricingProduct, unit: PricingUnit): number | null;
export function repriceUnits<U extends PricingUnit>(product: PricingProduct<U>, newBaseCost: number, decisions?: Record<string, { mode: string; price?: number; approvedProposed?: number | null }>): U[];
