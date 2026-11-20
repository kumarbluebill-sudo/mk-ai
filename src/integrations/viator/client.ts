/**
 * VIATOR Partner API v2 client for live activity search and pricing.
 */

export interface ViatorSearchParams {
  keyword: string;
  destinationId?: string;
  startDate?: string;
  currency?: string;
}

export interface ViatorActivity {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  duration: string;
  rating?: number;
  reviews?: number;
  imageUrl?: string;
  availability?: boolean;
  cancellationPolicy?: string;
  pricingType?: string;
  ageBands?: string[];
}

export interface ViatorPrice {
  recommendedRetailPrice?: number;
  partnerNetPrice?: number;
  partnerTotalPrice?: number;
  bookingFee?: number;
}

export interface ViatorBookableItem {
  productOptionCode?: string;
  startTime?: string;
  available: boolean;
  totalPrice?: {
    price?: ViatorPrice;
  };
}

export interface ViatorAvailabilityResponse {
  productCode: string;
  travelDate: string;
  currency: string;
  bookableItems: ViatorBookableItem[];
}

export interface ViatorSearchResponse {
  activities: ViatorActivity[];
  totalCount: number;
  hasMore: boolean;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export class ViatorClient {
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly environment: "sandbox" | "production";

  constructor() {
    this.environment =
      process.env.VIATOR_API_ENV === "production" ? "production" : "sandbox";
    this.apiKey =
      this.environment === "sandbox"
        ? process.env.VIATOR_SANDBOX_KEY || ""
        : process.env.VIATOR_PRODUCTION_KEY || "";
    this.apiBaseUrl =
      this.environment === "sandbox"
        ? "https://api.sandbox.viator.com/partner"
        : "https://api.viator.com/partner";

    if (!this.apiKey) {
      throw new Error(
        `VIATOR_${this.environment.toUpperCase()}_KEY not configured`
      );
    }
  }

  async searchActivities(
    params: ViatorSearchParams
  ): Promise<ViatorSearchResponse> {
    const productFiltering: JsonRecord = {
      includeAutomaticTranslations: true,
    };

    if (params.destinationId) {
      productFiltering.destination = params.destinationId;
    }

    if (params.startDate) {
      productFiltering.dateRange = {
        from: params.startDate,
        to: params.startDate,
      };
    }

    const data = await this.request("/search/freetext", {
      method: "POST",
      body: JSON.stringify({
        searchTerm: params.keyword.trim() || "activities",
        productFiltering,
        searchTypes: [
          {
            searchType: "PRODUCTS",
            pagination: { start: 1, count: 20 },
          },
        ],
        currency: params.currency || "USD",
      }),
    });

    const productResults = asRecord(data.products);
    const products = Array.isArray(productResults?.results)
      ? productResults.results
      : [];
    const activities = products
      .map((product) => asRecord(product))
      .filter((product): product is JsonRecord => product !== undefined)
      .map((product) => this.parseActivity(product, params.currency || "USD"));

    const totalCount = asNumber(productResults?.totalCount) ?? activities.length;
    return {
      activities,
      totalCount,
      hasMore: totalCount > activities.length,
    };
  }

  async getActivityDetails(activityId: string): Promise<ViatorActivity> {
    const data = await this.request(
      `/products/${encodeURIComponent(activityId)}`,
      { method: "GET" }
    );
    return this.parseActivity(data);
  }

  async checkAvailability(
    activityId: string,
    date: string,
    travelers: { adults: number; children: number },
    currency = "USD",
    productOptionCode?: string
  ): Promise<{ activity: ViatorActivity; availability: ViatorAvailabilityResponse }> {
    const activity = await this.getActivityDetails(activityId);
    const totalTravelers = travelers.adults + travelers.children;
    const paxMix: Array<{ ageBand: string; numberOfTravelers: number }> = [];
    const supportedAgeBands = new Set(activity.ageBands ?? []);

    if (activity.pricingType === "UNIT" || supportedAgeBands.has("TRAVELER")) {
      paxMix.push({ ageBand: "TRAVELER", numberOfTravelers: totalTravelers });
    } else {
      if (travelers.adults > 0) {
        if (supportedAgeBands.size && !supportedAgeBands.has("ADULT")) {
          throw new Error("This activity does not offer adult tickets.");
        }
        paxMix.push({
          ageBand: "ADULT",
          numberOfTravelers: travelers.adults,
        });
      }

      if (travelers.children > 0) {
        if (!supportedAgeBands.has("CHILD")) {
          throw new Error("This activity does not offer child tickets.");
        }
        paxMix.push({
          ageBand: "CHILD",
          numberOfTravelers: travelers.children,
        });
      }
    }

    const body: JsonRecord = {
      productCode: activityId,
      travelDate: date,
      currency,
      paxMix,
    };
    if (productOptionCode) body.productOptionCode = productOptionCode;

    const data = await this.request("/availability/check", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const bookableItems = Array.isArray(data.bookableItems)
      ? data.bookableItems
          .map((item) => asRecord(item))
          .filter((item): item is JsonRecord => item !== undefined)
          .map((item) => this.parseBookableItem(item))
      : [];

    return {
      activity,
      availability: {
        productCode: asString(data.productCode, activityId),
        travelDate: asString(data.travelDate, date),
        currency: asString(data.currency, currency),
        bookableItems,
      },
    };
  }

  private async request(path: string, init: RequestInit): Promise<JsonRecord> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "exp-api-key": this.apiKey,
        Accept: "application/json;version=2.0",
        "Accept-Language": "en-US",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    const responseText = await response.text();
    let data: JsonRecord = {};
    if (responseText) {
      try {
        data = asRecord(JSON.parse(responseText)) ?? {};
      } catch {
        if (response.ok) {
          throw new Error("Viator returned an invalid JSON response.");
        }
      }
    }

    if (!response.ok) {
      const code = asString(data.code);
      const message = asString(data.message, response.statusText);
      throw new Error(
        `Viator API error (${response.status})${code ? ` ${code}` : ""}: ${message}`
      );
    }

    return data;
  }

  private parseActivity(item: JsonRecord, currency = "USD"): ViatorActivity {
    const pricing = asRecord(item.pricing);
    const pricingInfo = asRecord(item.pricingInfo);
    const reviews = asRecord(item.reviews);
    const durationInfo = asRecord(item.duration);
    const image = Array.isArray(item.images)
      ? asRecord(item.images.find((entry) => asRecord(entry)?.isCover) ?? item.images[0])
      : undefined;
    const imageVariants = Array.isArray(image?.variants) ? image.variants : [];
    const imageUrl = imageVariants
      .map((variant) => asRecord(variant))
      .find((variant) => variant?.width === 480)?.url;
    const price =
      asNumber(pricing?.fromPrice) ??
      asNumber(asRecord(pricing?.summary)?.fromPrice) ??
      asNumber(asRecord(item.price)?.fromPrice) ??
      0;
    const durationMinutes = asNumber(durationInfo?.fixedDurationInMinutes);
    const ageBands = Array.isArray(pricingInfo?.ageBands)
      ? pricingInfo.ageBands
          .map((band) => asString(asRecord(band)?.ageBand))
          .filter(Boolean)
      : undefined;
    const reviewRating =
      asNumber(reviews?.combinedAverageRating) ??
      asNumber(reviews?.rating);

    return {
      id: asString(item.productCode, asString(item.id)),
      title: asString(item.title, "Unknown Activity"),
      description: asString(item.description),
      price,
      currency,
      duration: durationMinutes
        ? `${Math.round(durationMinutes / 60)} hours`
        : "Variable",
      rating: reviewRating,
      reviews: asNumber(reviews?.totalReviews),
      imageUrl: asString(imageUrl),
      availability: asString(item.status) !== "INACTIVE",
      cancellationPolicy: asString(
        asRecord(item.cancellationPolicy)?.description
      ),
      pricingType: asString(pricingInfo?.type),
      ageBands,
    };
  }

  private parseBookableItem(item: JsonRecord): ViatorBookableItem {
    const totalPrice = asRecord(item.totalPrice);
    const price = asRecord(totalPrice?.price);

    return {
      productOptionCode: asString(item.productOptionCode) || undefined,
      startTime: asString(item.startTime) || undefined,
      available: item.available === true,
      totalPrice: price
        ? {
            price: {
              recommendedRetailPrice: asNumber(
                price.recommendedRetailPrice
              ),
              partnerNetPrice: asNumber(price.partnerNetPrice),
              partnerTotalPrice: asNumber(price.partnerTotalPrice),
              bookingFee: asNumber(price.bookingFee),
            },
          }
        : undefined,
    };
  }

  getEnvironment(): string {
    return this.environment;
  }
}

export function getViatorClient(): ViatorClient {
  return new ViatorClient();
}
