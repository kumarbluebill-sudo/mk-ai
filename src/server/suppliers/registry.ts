import { klookAdapter, yatraAdapter } from "./pending-adapters";
import type { InventoryCategory, SupplierAdapter } from "./types";
import { viatorAdapter } from "./viator-adapter";

/** Add new supplier adapters here, nowhere else. */
export const ALL_ADAPTERS: readonly SupplierAdapter[] = [viatorAdapter, yatraAdapter, klookAdapter];

export function adaptersForCategory(
  category: InventoryCategory,
  adapters: readonly SupplierAdapter[] = ALL_ADAPTERS
): SupplierAdapter[] {
  return adapters.filter((a) => a.categories.includes(category));
}

export interface SupplierStatusRow {
  id: string;
  displayName: string;
  categories: readonly InventoryCategory[];
  configured: boolean;
  reason?: string;
}

/** Safe for the browser: names and booleans only, never credentials. */
export function supplierStatus(adapters: readonly SupplierAdapter[] = ALL_ADAPTERS): SupplierStatusRow[] {
  return adapters.map((a) => {
    const configured = a.isConfigured();
    return {
      id: a.id,
      displayName: a.displayName,
      categories: a.categories,
      configured,
      ...(configured ? {} : { reason: a.notConfiguredReason() }),
    };
  });
}
