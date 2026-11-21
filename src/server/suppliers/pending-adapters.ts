import type { InventoryCategory, SupplierAdapter } from "./types";

/**
 * Declared-but-not-integrated suppliers.
 *
 * These exist so the registry, admin screens and the AI can say honestly which suppliers are
 * missing. They never call a network endpoint: the real request/response contracts come from each
 * supplier's official documentation and credentials (see API_INTEGRATION_GUIDE.md). Do not add
 * guessed endpoints here.
 */
function pending(
  id: string,
  displayName: string,
  categories: readonly InventoryCategory[],
  requirement: string
): SupplierAdapter {
  return {
    id,
    displayName,
    categories,
    isConfigured: () => false,
    notConfiguredReason: () => requirement,
    async search() {
      throw new Error(`${displayName} adapter is not implemented. ${requirement}`);
    },
  };
}

export const yatraAdapter = pending(
  "yatra",
  "Yatra",
  ["hotel", "flight"],
  "Needs Yatra's official B2B API documentation and credentials."
);

export const klookAdapter = pending(
  "klook",
  "Klook",
  ["activity", "transfer"],
  "Needs Klook's official affiliate/partner API documentation and credentials."
);
