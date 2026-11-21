import { z } from "zod";

/**
 * Traveldesk B2B public API client (v1).
 *
 * Endpoints and field names come from Traveldesk's published OpenAPI document
 * (https://testapi.traveldesk.me/swagger/b2bpublic/swagger.json).
 *
 * Responses are parsed with tolerant zod schemas: only the fields we use are required, unknown
 * fields are ignored, so an additive API change does not break us.
 */

export class TravelDeskError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Short supplier-written reason for a refused request (HTTP 4xx), already length-limited. */
    readonly detail?: string
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
          /** 0 OnRequest (needs supplier approval), 1 LiveBook (instant), 2 TicketOnly. */
          bookingType: z.number().nullish(),
          /** When false, a booking needs a pick-up hotel. */
          isDirectReporting: z.boolean().nullish(),
          infantsAllowed: z.boolean().nullish(),
          maxNumberOfInfant: z.number().nullish(),
        })
        .passthrough()
    )
    .nullish(),
  cancellationPolicy: z.array(z.object({ hours: z.number(), percents: z.number() }).passthrough()).nullish(),
  salesDescription: z.string().nullish(),
});
export type TravelDeskTourDetails = z.infer<typeof tourDetailsSchema>;

/** BookingStatus values from the OpenAPI document. */
export const BOOKING_STATUS = {
  New: 0,
  PendingVerification: 1,
  PendingOnRequest: 2,
  PaymentRequired: 3,
  Cancelled: 4,
  Completed: 5,
  PaymentFailed: 6,
  Prebooked: 7,
  TimedOut: 8,
} as const;

export const bookingSchema = z
  .object({
    id: z.number(),
    guid: z.string().nullish(),
    /** NOTE: the API echoes our own referenceNumber here. It is not a supplier-issued reference. */
    bookingReference: z.string().nullish(),
    status: z.number(),
    bookingType: z.number().nullish(),
    offerId: z.number(),
    offerName: z.string().nullish(),
    tourId: z.number(),
    tourName: z.string().nullish(),
    date: z.string(),
    adults: z.number(),
    children: z.number(),
    infants: z.number().nullish(),
    guestName: z.string().nullish(),
    totalCost: z.number(),
    totalCostUsd: z.number().nullish(),
    paymentCurrency: z.string().nullish(),
    reservationTimeout: z.number().nullish(),
    reservationDeadline: z.string().nullish(),
    isExternalBookingFailed: z.boolean().nullish(),
    externalBookingFailureMessage: z.string().nullish(),
    isExternalConfirmationInProgress: z.boolean().nullish(),
    isExternalVoucherNotReady: z.boolean().nullish(),
    paymentErrorMessage: z.string().nullish(),
    customerSupportPhone: z.string().nullish(),
    cancellationPolicy: z.array(z.object({ hours: z.number(), percents: z.number() }).passthrough()).nullish(),
    // Present in responses; never stored or returned by us: it embeds the anonymous-access guid.
    downloadVoucherUrl: z.string().nullish(),
  })
  .passthrough();
export type TravelDeskBooking = z.infer<typeof bookingSchema>;

export const hotelSchema = z
  .object({ id: z.number(), name: z.string(), regionName: z.string().nullish(), cityName: z.string().nullish() })
  .passthrough();
export type TravelDeskHotel = z.infer<typeof hotelSchema>;

export interface ReserveRequest {
  date: string; // YYYY-MM-DD
  offerId: number;
  adults: number;
  children: number;
  infants: number;
  guestName: string;
  referenceNumber: string;
  totalCost: number;
  totalCostUsd: number;
  currency: string;
  timeSlotId?: number;
  startTime?: number;
  endTime?: number;
  hotelId?: number;
  pickUpLocation?: string;
  email?: string;
  phone?: string;
  remarks?: string;
}

type Query = Record<string, string | number | boolean | undefined>;

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

  private async request(method: "GET" | "POST", path: string, query: Query, body: unknown, timeoutMs: number): Promise<Response> {
    const url = new URL(`${this.baseUrl}/public/b2b/v1${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      // The URL never contains the key, but keep messages generic anyway.
      throw new TravelDeskError(error instanceof Error && error.name === "TimeoutError" ? "Traveldesk request timed out" : "Traveldesk request failed");
    }
    if (!res.ok) {
      let detail: string | undefined;
      if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403) {
        const text = await res.text().catch(() => "");
        try {
          const j = JSON.parse(text) as { message?: unknown; detail?: unknown; title?: unknown };
          detail = [j.message, j.detail, j.title].find((x): x is string => typeof x === "string" && x.length > 0)?.slice(0, 200);
        } catch {
          detail = text.trim().slice(0, 200) || undefined;
        }
      }
      throw new TravelDeskError(
        res.status === 401 || res.status === 403 ? "Traveldesk rejected the API key" : `Traveldesk returned HTTP ${res.status}`,
        res.status,
        detail
      );
    }
    return res;
  }

  private async get<T>(path: string, query: Query, schema: z.ZodType<T>, timeoutMs = 10_000): Promise<T> {
    const res = await this.request("GET", path, query, undefined, timeoutMs);
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new TravelDeskError("Traveldesk returned an unexpected response shape");
    return parsed.data;
  }

  private async post<T>(path: string, body: unknown, schema: z.ZodType<T>, timeoutMs = 20_000): Promise<T> {
    const res = await this.request("POST", path, {}, body, timeoutMs);
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

  hotelsForOffer(offerId: number) {
    return this.get("/hotels/foroffer", { OfferId: offerId }, z.array(hotelSchema));
  }

  /** Holds inventory for a short time (see reservationTimeout). Nothing is charged until confirmed. */
  reserve(req: ReserveRequest) {
    const body = {
      date: `${req.date}T00:00:00`,
      offerId: req.offerId,
      adults: req.adults,
      children: req.children,
      infants: req.infants,
      guestName: req.guestName,
      referenceNumber: req.referenceNumber,
      totalCost: req.totalCost,
      totalCostUsd: req.totalCostUsd,
      currency: req.currency,
      cashCollect: 0,
      ...(req.timeSlotId !== undefined && { timeSlotId: req.timeSlotId }),
      ...(req.startTime !== undefined && { startTime: req.startTime }),
      ...(req.endTime !== undefined && { endTime: req.endTime }),
      ...(req.hotelId !== undefined && { hotelId: req.hotelId }),
      ...(req.pickUpLocation && { pickUpLocation: req.pickUpLocation }),
      ...(req.email && { email: req.email }),
      ...(req.phone && { phone: req.phone }),
      ...(req.remarks && { remarks: req.remarks }),
    };
    return this.post("/bookings/reserve", body, bookingSchema);
  }

  /** Confirms a reservation; the supplier charges the agency balance. Never retry blindly: re-read with booking(). */
  confirm(reservationId: number) {
    return this.post("/bookings/confirm", { id: reservationId }, bookingSchema, 30_000);
  }

  cancel(bookingId: number) {
    return this.post("/bookings/cancel", { id: bookingId }, z.object({ isSuccess: z.boolean() }).passthrough());
  }

  booking(bookingId: number) {
    return this.get(`/bookings/${bookingId}`, {}, bookingSchema);
  }

  /** The supplier's own voucher PDF. */
  async voucher(bookingId: number): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await this.request("GET", `/bookings/${bookingId}/downloadvoucher`, {}, undefined, 30_000);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.includes("pdf")) throw new TravelDeskError("Traveldesk did not return a PDF voucher");
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType };
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
