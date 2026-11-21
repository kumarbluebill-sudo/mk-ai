import type { TravelDeskClient, TravelDeskAvailabilityRow } from "@/integrations/traveldesk/client";

/**
 * Live Traveldesk availability and price for a tour on one date.
 * Totals are computed here from the supplier's unit prices (they are not a supplier-quoted basket
 * total) and are labelled as such. Nothing is reserved.
 */

export interface AvailabilityInput {
  tourId: number;
  date: string; // YYYY-MM-DD
  adults: number;
  children: number;
  offerId?: number;
}

export interface SlotResult {
  startTime: string | null;
  endTime: string | null;
  /** Raw supplier values; a reservation must copy them from the slot that was picked. */
  timeSlotId: number | null;
  startMinutes: number | null;
  endMinutes: number | null;
  available: boolean;
  /** Seats the supplier reports as left, if it says. */
  left: number | null;
  pricePerAdult: number | null;
  pricePerChild: number | null;
  /** adults x adult price + children x child price, or the per-trip price when the supplier sells by trip. */
  total: number | null;
  totalBasis: "COMPUTED_FROM_UNIT_PRICES" | "PER_TRIP";
  currency: string;
  vatPercent: number | null;
}

export interface OfferAvailability {
  offerId: number;
  name: string;
  /** 0 OnRequest (supplier must approve), 1 LiveBook (instant), 2 TicketOnly. */
  bookingType: number | null;
  /** False means a pick-up hotel is required to book. */
  isDirectReporting: boolean | null;
  infantsAllowed: boolean | null;
  withinPaxLimits: boolean;
  slots: SlotResult[];
}

export interface TravelDeskAvailability {
  tour: { id: number; name: string };
  date: string;
  environment: string;
  checkedAt: string;
  offers: OfferAvailability[];
  /** Supplier cancellation tiers, passed through uninterpreted. */
  cancellationPolicyRaw: { hours: number; percents: number }[];
}

const toMinor = (n: number) => Math.round(n * 100);

export function minutesToClock(minutes: number | null | undefined): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) return null;
  const h = Math.floor(minutes / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function slotFromRow(row: TravelDeskAvailabilityRow, pax: { adults: number; children: number }, withinLimits: boolean): SlotResult {
  const price = row.price;
  const perAdult = price?.pricePerAdult ?? null;
  const perChild = price?.pricePerChild ?? null;
  const perTrip = price?.pricePerTrip ?? 0;
  const left = row.availability.left ?? null;
  const people = pax.adults + pax.children;

  let total: number | null = null;
  let basis: SlotResult["totalBasis"] = "COMPUTED_FROM_UNIT_PRICES";
  if (perTrip > 0) {
    total = perTrip;
    basis = "PER_TRIP";
  } else if (perAdult !== null && (pax.children === 0 || perChild !== null)) {
    total = (toMinor(perAdult) * pax.adults + toMinor(perChild ?? 0) * pax.children) / 100;
  }

  return {
    startTime: minutesToClock(row.availability.startTime),
    endTime: minutesToClock(row.availability.endTime),
    timeSlotId: row.availability.timeSlotId ?? null,
    startMinutes: row.availability.startTime ?? null,
    endMinutes: row.availability.endTime ?? null,
    available: price?.isBookable !== false && (left === null || left >= people) && withinLimits && total !== null,
    left,
    pricePerAdult: perAdult,
    pricePerChild: perChild,
    total,
    totalBasis: basis,
    currency: (price?.currency ?? "USD").toUpperCase(),
    vatPercent: price?.vat ?? null,
  };
}

export async function checkTravelDeskAvailability(client: TravelDeskClient, input: AvailabilityInput): Promise<TravelDeskAvailability> {
  const details = await client.tourDetails(input.tourId, "USD");
  const allOffers = details.offers ?? [];
  const offers = input.offerId ? allOffers.filter((o) => o.id === input.offerId) : allOffers.slice(0, 5);

  const results: OfferAvailability[] = await Promise.all(
    offers.map(async (offer) => {
      const rows = await client.availability(offer.id, input.date, input.date, "USD");
      const sameDay = rows.filter((r) => r.availability.date.slice(0, 10) === input.date);
      const minAdults = offer.minNumberOfAdult ?? 0;
      const maxAdults = offer.maxNumberOfAdult ?? 0;
      const maxChildren = offer.maxNumberOfChild ?? 0;
      // A limit of 0 means "not stated", not "none allowed".
      const withinPaxLimits =
        input.adults >= minAdults && (maxAdults === 0 || input.adults <= maxAdults) && (maxChildren === 0 || input.children <= maxChildren);
      return {
        offerId: offer.id,
        name: offer.name,
        bookingType: offer.bookingType ?? null,
        isDirectReporting: offer.isDirectReporting ?? null,
        infantsAllowed: offer.infantsAllowed ?? null,
        withinPaxLimits,
        slots: sameDay.map((r) => slotFromRow(r, input, withinPaxLimits)),
      };
    })
  );

  return {
    tour: { id: details.id, name: details.name },
    date: input.date,
    environment: client.getEnvironment(),
    checkedAt: new Date().toISOString(),
    offers: results,
    cancellationPolicyRaw: (details.cancellationPolicy ?? []).map((c) => ({ hours: c.hours, percents: c.percents })),
  };
}
