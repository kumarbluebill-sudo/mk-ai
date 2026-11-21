/**
 * Supplier adapter framework.
 *
 * Every inventory source (Viator today; Yatra, Klook, hotel/flight/transfer suppliers later)
 * implements SupplierAdapter and returns normalised InventoryItems. The search engine never
 * invents data: an adapter that cannot answer reports a status, it does not fill gaps.
 */

export type InventoryCategory = "activity" | "hotel" | "flight" | "transfer" | "package";

/**
 * LIVE      - returned by a supplier production API just now.
 * SANDBOX   - returned by a supplier test API; not sellable inventory.
 * ESTIMATE  - not from a supplier. Never produced by adapters, reserved for planners.
 */
export type DataStatus = "LIVE" | "SANDBOX" | "ESTIMATE";

export interface InventoryPrice {
  /** Integer minor units (cents/paise), exactly as the supplier quoted it. */
  amountMinor: number;
  currency: string;
  /** What the amount represents, e.g. "from price per person". Never assume a total. */
  basis: "FROM_PER_PERSON" | "TOTAL" | "UNKNOWN";
}

export interface InventoryItem {
  supplier: string;
  supplierItemId: string;
  category: InventoryCategory;
  title: string;
  description: string;
  price: InventoryPrice | null;
  rating?: number;
  reviewCount?: number;
  duration?: string;
  imageUrl?: string;
  cancellationPolicy?: string;
  dataStatus: DataStatus;
  /** ISO timestamp of the supplier call that produced this item. */
  checkedAt: string;
}

export interface InventorySearchRequest {
  category: InventoryCategory;
  keyword: string;
  startDate?: string;
  currency: string;
  limit?: number;
}

export type SupplierStatus =
  | "OK"
  | "NOT_CONFIGURED"
  | "UNSUPPORTED"
  | "TIMEOUT"
  | "ERROR";

export interface SupplierOutcome {
  supplier: string;
  status: SupplierStatus;
  /** Present for OK, even when empty. */
  itemCount: number;
  latencyMs: number;
  /** Human readable, safe to show to the user. Never contains keys or raw upstream bodies. */
  message?: string;
  environment?: string;
  cached?: boolean;
}

export interface AdapterResult {
  items: InventoryItem[];
  environment: string;
}

export interface SupplierAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly categories: readonly InventoryCategory[];
  /** True only when credentials AND a verified integration exist. Must not make network calls. */
  isConfigured(): boolean;
  /** Why the adapter is not usable, shown to users/admins. */
  notConfiguredReason(): string;
  search(request: InventorySearchRequest, signal: AbortSignal): Promise<AdapterResult>;
}
