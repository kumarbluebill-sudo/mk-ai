import { z } from "zod";

/**
 * Traveldesk B2B public API client (v1).
 *
 * Endpoints and field names come from Traveldesk's published OpenAPI document
 * (https://testapi.traveldesk.me/swagger/b2bpublic/swagger.json). Only read endpoints are used
 * here; booking endpoints (reserve / confirm / cancel) are deliberately not wired yet.
 *
 * Responses are parsed with tolerant zod schemas: only the fields we use are required, unknown
 * fields are ignored, so an additive API change does not break us.
 */

export class TravelDeskError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "TravelDeskError";
  }
}

const photo = z
  .object({
    srcSet: z
      .array(z.object({ type: z.string().optional(), sizes: z.array(z.object({ src: z.string(), width: z.number().optional() })).default([]) }))
      .nullish(),
  })
  .passthrough()
  .nullish();

export const tourSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    language: z.string().nullish(),
    // Category names are null on some tours in the real API.
    categories: z.array(z.object({ name: z.string().nullish() }).passthrough()).nullish(),
    heroImage: photo,
    totalRating: z.number().nullish(),
    totalRatingsCount: z.number().nullish(),
  })
  .passthrough();
export type TravelDeskTour = z.infer<typeof tourSchema>;

export const pricingPeriodSchema = z
  .object({
    dateStart: z.string(),
    dateEnd: z.string(),
    pricePerAdultUsd: z.number().nullish(),
    pricePerChildUsd: z.number().nullish(),
  })
  .passthrough();

export const offerListSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    tourId: z.number(),
    prices: z.array(pricingPeriodSchema).nullish(),
  })
  .passthrough();
export type TravelDeskOfferSummary = z.infer<typeof offerListSchema>;

const offerPriceSchema = z
  .object({
    currency: z.string().nullish(),
    pricePerAdult: z.number().nullish(),
    pricePerChild: z.number().nullish(),
    pricePerTrip: z.number().nullish(),
    isBookable: z.boolean().nullish(),
    vat: z.number().nullish(),
  })
  .passthrough();

export const availabilityRowSchema = z
  .object({
    availability: z
      .object({
        date: z.string(),
        startTime: z.number().nullish(),
        endTime: z.number().nullish(),
        timeSlotId: z.number().nullish(),
        left: z.number().nullish(),
      })
      .passthrough(),
    price: offerPriceSchema.nullish(),
  })
  .passthrough();
export type TravelDeskAvailabilityRow = z.infer<typeof availabilityRowSchema>;

export const tourDetailsSchema = tourSchema.extend({
  offers: z
    .array(
      z
        .object({
          id: z.number(),
          name: z.string(),
          numberOfHours: z.number().nullish(),
          minNumberOfAdult: z.number().nullish(),
          maxNumberOfAdult: z.number().nullish(),
          maxNumberOfChild: z.number().nullish(),
        })
        .passthrough()
    )
    .nullish(),
  cancellationPolicy: z.array(z.object({ hours: z.number(), percents: z.number() }).passthrough()).nullish(),
  salesDescription: z.string().nullish(),
});
export type TravelDeskTourDetails = z.infer<typeof tourDetailsSchema>;

export class TravelDeskClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  readonly environment: "sandbox" | "production";

  constructor(env: Record<string, string | undefined> = process.env) {
    this.apiKey = env.TRAVELDESK_API_KEY ?? "";
    this.baseUrl = (env.TRAVELDESK_API_BASE_URL || "https://testapi.traveldesk.me").replace(/\/+$/, "");
    // Anything not explicitly marked production is treated as test data, never as sellable inventory.
    this.environment = env.TRAVELDESK_API_ENV === "production" ? "production" : "sandbox";
    if (!this.apiKey) throw new TravelDeskError("TRAVELDESK_API_KEY not configured");
  }

  getEnvironment(): string {
    return this.environment;
  }

  private async get<T>(path: string, query: Record<string, string | number | boolean | undefined>, schema: z.ZodType<T>, timeoutMs = 10_000): Promise<T> {
    const url = new URL(`${this.baseUrl}/public/b2b/v1${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      // The URL never contains the key, but keep messages generic anyway.
      throw new TravelDeskError(error instanceof Error && error.name === "TimeoutError" ? "Traveldesk request timed out" : "Traveldesk request failed");
    }
    if (!res.ok) {
      throw new TravelDeskError(res.status === 401 || res.status === 403 ? "Traveldesk rejected the API key" : `Traveldesk returned HTTP ${res.status}`, res.status);
    }
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new TravelDeskError("Traveldesk returned an unexpected response shape");
    return parsed.data;
  }

  tours(currencyCode = "USD") {
    return this.get("/tours", { CurrencyCode: currencyCode }, z.array(tourSchema));
  }

  offers(includePrices: boolean) {
    return this.get("/offers", { IncludePrices: includePrices }, z.array(offerListSchema));
  }

  tourDetails(id: number, currencyCode = "USD") {
    return this.get(`/tours/${id}`, { CurrencyCode: currencyCode }, tourDetailsSchema);
  }

  /** Per-date availability with prices. `from`/`to` are YYYY-MM-DD. */
  availability(offerId: number, from: string, to: string, currencyCode = "USD") {
    return this.get(
      "/availability/byoffer",
      { Id: offerId, From: `${from}T00:00:00`, To: `${to}T00:00:00`, CurrencyCode: currencyCode },
      z.array(availabilityRowSchema)
    );
  }
}

let instance: TravelDeskClient | null = null;
export function getTravelDeskClient(): TravelDeskClient {
  instance ??= new TravelDeskClient();
  return instance;
}
/** Test hook. */
export function resetTravelDeskClient(): void {
  instance = null;
}
