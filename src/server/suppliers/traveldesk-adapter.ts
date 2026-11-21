import {
  getTravelDeskClient,
  type TravelDeskOfferSummary,
  type TravelDeskTour,
} from "@/integrations/traveldesk/client";
import type { AdapterResult, InventoryItem, InventorySearchRequest, SupplierAdapter } from "./types";

/**
 * Traveldesk adapter: tours as activities.
 *
 * Coverage: the API defaults every query to departures in the UAE (CountryId 50) and its catalogue
 * is UAE experiences, so we only answer searches that mention a UAE place. A "Goa safari" search
 * must return nothing from this supplier rather than a Dubai desert safari.
 */

const UAE_TERMS = ["dubai", "abu dhabi", "uae", "emirates", "sharjah", "ajman", "ras al khaimah", "fujairah", "umm al quwain", "al ain"];
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "tour", "tours", "trip", "trips", "best", "things", "activities", "activity",
  "package", "packages", "emirates", "dubai", "abu", "dhabi", "uae", "sharjah", "ajman", "ras", "khaimah", "fujairah", "umm", "quwain", "al", "ain",
]);

const CATALOGUE_TTL_MS = 5 * 60_000;
interface Catalogue {
  at: number;
  tours: TravelDeskTour[];
  offers: TravelDeskOfferSummary[];
}
let catalogue: Catalogue | null = null;

export function clearTravelDeskCatalogueCache(): void {
  catalogue = null;
}

async function loadCatalogue(): Promise<Catalogue> {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS) return catalogue;
  const client = getTravelDeskClient();
  const [tours, offers] = await Promise.all([client.tours("USD"), client.offers(true)]);
  catalogue = { at: Date.now(), tours, offers };
  return catalogue;
}

export function mentionsUae(keyword: string): boolean {
  const k = keyword.toLowerCase();
  return UAE_TERMS.some((t) => k.includes(t));
}

function keywordTokens(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/** Lowest per-adult USD price (agent price) among the tour's offers whose pricing period covers `now`. */
export function currentFromPriceUsd(offers: TravelDeskOfferSummary[], tourId: number, now: Date): number | null {
  const iso = now.toISOString().slice(0, 19);
  let best: number | null = null;
  for (const offer of offers) {
    if (offer.tourId !== tourId) continue;
    for (const p of offer.prices ?? []) {
      if (p.dateStart > iso || p.dateEnd < iso) continue;
      const price = p.pricePerAdultUsd;
      if (typeof price === "number" && price > 0 && (best === null || price < best)) best = price;
    }
  }
  return best;
}

function categoryNames(tour: TravelDeskTour): string[] {
  return (tour.categories ?? []).flatMap((c) => (c.name ? [c.name] : []));
}

function imageOf(tour: TravelDeskTour): string | undefined {
  const sizes = tour.heroImage?.srcSet?.flatMap((s) => s.sizes) ?? [];
  return (sizes.find((s) => s.width === 640) ?? sizes[0])?.src;
}

export function normaliseTour(
  tour: TravelDeskTour,
  offers: TravelDeskOfferSummary[],
  environment: string,
  checkedAt: string,
  now: Date
): InventoryItem {
  const priceUsd = currentFromPriceUsd(offers, tour.id, now);
  return {
    supplier: "traveldesk",
    supplierItemId: String(tour.id),
    category: "activity",
    title: tour.name,
    description: categoryNames(tour).join(", "),
    // Agent (net) price per adult. Our markup engine adds the selling margin on top.
    price: priceUsd === null ? null : { amountMinor: Math.round(priceUsd * 100), currency: "USD", basis: "FROM_PER_PERSON" },
    rating: tour.totalRating ?? undefined,
    reviewCount: tour.totalRatingsCount ?? undefined,
    imageUrl: imageOf(tour),
    // Test API data is never presented as live, sellable inventory.
    dataStatus: environment === "production" ? "LIVE" : "SANDBOX",
    checkedAt,
  };
}

export const traveldeskAdapter: SupplierAdapter = {
  id: "traveldesk",
  displayName: "Traveldesk",
  categories: ["activity"],

  isConfigured() {
    return Boolean(process.env.TRAVELDESK_API_KEY);
  },

  notConfiguredReason() {
    return "Traveldesk API key is not configured (TRAVELDESK_API_KEY).";
  },

  async search(request: InventorySearchRequest, signal: AbortSignal): Promise<AdapterResult> {
    const client = getTravelDeskClient();
    const environment = client.getEnvironment();

    if (!mentionsUae(request.keyword)) {
      return { environment, items: [], note: "Traveldesk covers the UAE only; mention a UAE place (e.g. Dubai) to search it." };
    }

    const cat = await Promise.race([
      loadCatalogue(),
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    ]);

    const tokens = keywordTokens(request.keyword);
    const now = new Date();
    const checkedAt = now.toISOString();

    const scored = cat.tours
      .filter((t) => !t.language || /english/i.test(t.language))
      .map((t) => {
        const haystack = `${t.name} ${categoryNames(t).join(" ")}`.toLowerCase();
        return { t, score: tokens.length === 0 ? 1 : tokens.filter((tok) => haystack.includes(tok)).length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.t.totalRating ?? 0) - (a.t.totalRating ?? 0));

    return {
      environment,
      items: scored.map(({ t }) => normaliseTour(t, cat.offers, environment, checkedAt, now)),
      note:
        request.currency !== "USD"
          ? "Traveldesk prices are shown in USD; no currency conversion is applied."
          : undefined,
    };
  },
};
