export type InventoryBucket = "loose" | "package";

export interface PhysicalInventory {
  loose_base_quantity: number;
  closed_packages: Record<string, number>;
}

export interface InventoryUnit {
  id: string;
  name: string;
  factor: number;
  stock_kind: InventoryBucket;
  is_base?: boolean;
  can_purchase?: boolean;
  can_sell?: boolean;
  allows_fractional?: boolean;
}

export interface InventoryProduct {
  id?: string;
  base_unit_id?: string;
  base_unit_name?: string;
  units: InventoryUnit[];
  inventory?: PhysicalInventory;
  inventory_alerts?: {
    loose?: { reorder_point?: number | null; target_level?: number | null };
    packages?: Record<string, { reorder_point?: number | null; target_level?: number | null }>;
  };
}

export function round4(value: number): number;
export function roundMoney(value: number): number;
export function baseQuantityFor(quantity: number, factor: number): number;
export function emptyInventory(): PhysicalInventory;
export function normalizeInventory(value: unknown): PhysicalInventory;
export function inventoryTotal(inventory: PhysicalInventory, units: InventoryUnit[]): number;
export function inventoryLabel(inventory: PhysicalInventory, product: InventoryProduct): string;
export function addPurchase(inventory: PhysicalInventory, product: InventoryProduct, unitId: string, quantity: number): { inventory: PhysicalInventory; changes: { loose_base_quantity: number; closed_packages: Record<string, number> }; base_quantity: number; unit: InventoryUnit };
export function sellInventory(inventory: PhysicalInventory, product: InventoryProduct, unitId: string, quantity: number): { inventory: PhysicalInventory; changes: { loose_base_quantity: number; closed_packages: Record<string, number> }; base_quantity: number; unit: InventoryUnit; opened: Array<{ unit_id: string; unit_name: string; unit_factor: number; count: number }> };
export function restoreInventory(inventory: PhysicalInventory, product: InventoryProduct, bucket: InventoryBucket, unitId: string | null, baseQuantity: number): { inventory: PhysicalInventory; changes: { loose_base_quantity: number; closed_packages: Record<string, number> } };
export function removeInventory(inventory: PhysicalInventory, product: InventoryProduct, bucket: InventoryBucket, unitId: string | null, baseQuantity: number): { inventory: PhysicalInventory; changes: { loose_base_quantity: number; closed_packages: Record<string, number> } };
export function restoreSaleConsumption(inventory: PhysicalInventory, product: InventoryProduct, line: { unit_id: string; unit_factor: number; product_quantity: number; base_quantity: number }): { inventory: PhysicalInventory; changes: { loose_base_quantity: number; closed_packages: Record<string, number> }; base_quantity: number; unit: InventoryUnit };
export function replayMovementGroup(stock: number, average: number | null, movements: Array<{ direction: "in" | "out"; base_quantity?: number; quantity?: number; unit_cost?: number | null }>): { stock: number; average: number | null; untrusted: boolean };
export function setInventoryBucket(inventory: PhysicalInventory, product: InventoryProduct, bucket: InventoryBucket, unitId: string | null, quantity: number): { inventory: PhysicalInventory; changes: { loose_base_quantity: number; closed_packages: Record<string, number> } };
export function lowStockComponents(product: InventoryProduct): Array<{ bucket: InventoryBucket; unit_id?: string; unit_name?: string; current: number; reorder_point: number; target_level: number | null }>;
export function movingAverage(oldQuantity: number, oldCost: number | null, addedQuantity: number, addedValue: number): number | null;

