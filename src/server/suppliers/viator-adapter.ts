import { getViatorClient, type ViatorActivity } from "@/integrations/viator/client";
import type {
  AdapterResult,
  InventoryItem,
  InventorySearchRequest,
  SupplierAdapter,
} from "./types";

/** Viator quotes prices in major units of 2-decimal currencies (USD, EUR, GBP, AUD, CAD). */
function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function normaliseViatorActivity(
  activity: ViatorActivity,
  environment: string,
  checkedAt: string
): InventoryItem {
  return {
    supplier: "viator",
    supplierItemId: activity.id,
    category: "activity",
    title: activity.title,
    description: activity.description,
    price:
      Number.isFinite(activity.price) && activity.price > 0
        ? { amountMinor: toMinor(activity.price), currency: activity.currency, basis: "FROM_PER_PERSON" }
        : null,
    rating: activity.rating,
    reviewCount: activity.reviews,
    duration: activity.duration || undefined,
    imageUrl: activity.imageUrl,
    cancellationPolicy: activity.cancellationPolicy,
    // Sandbox responses are test data and must never be presented as live inventory.
    dataStatus: environment === "production" ? "LIVE" : "SANDBOX",
    checkedAt,
  };
}

export const viatorAdapter: SupplierAdapter = {
  id: "viator",
  displayName: "Viator",
  categories: ["activity"],

  isConfigured() {
    try {
      getViatorClient();
      return true;
    } catch {
      return false;
    }
  },

  notConfiguredReason() {
    return "Viator API key is not configured (VIATOR_SANDBOX_KEY / VIATOR_PRODUCTION_KEY).";
  },

  async search(request: InventorySearchRequest, signal: AbortSignal): Promise<AdapterResult> {
    const client = getViatorClient();
    const environment = client.getEnvironment();
    // The existing client does not accept an AbortSignal; the engine enforces the timeout and
    // ignores late results. The request itself finishes in the background.
    const response = await Promise.race([
      client.searchActivities({
        keyword: request.keyword,
        startDate: request.startDate,
        currency: request.currency,
      }),
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    ]);
    const checkedAt = new Date().toISOString();
    return {
      environment,
      items: response.activities.map((a) => normaliseViatorActivity(a, environment, checkedAt)),
    };
  },
};
