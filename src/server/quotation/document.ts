import type { Itinerary, ItineraryItem } from "@/server/travel/itinerary";
import type { PriceBreakdown, TaxLine } from "@/server/travel/pricing";

/**
 * Customer-facing quotation document. Built once, stored as Quotation.snapshot, and rendered to PDF
 * from that snapshot so a re-download always matches what was quoted.
 *
 * Deliberately absent: supplier cost and markup (the package price already includes the markup),
 * and any wording that implies a confirmed booking.
 */

export interface QuoteCompany {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  gstNumber?: string;
  terms?: string;
}

export interface QuoteDay {
  dayNumber: number;
  date?: string;
  title: string;
  items: {
    time?: string;
    title: string;
    category: ItineraryItem["category"];
    location?: string;
    /** "Supplier-checked" only for LIVE items; everything else is indicative. */
    indicative: boolean;
  }[];
}

export interface QuoteDocument {
  reference: string;
  issuedAt: string;
  validUntil: string;
  company: QuoteCompany;
  customerName: string;
  trip: { title: string; destination: string; startDate?: string; days: QuoteDay[] };
  price: {
    currency: string;
    /** Supplier cost plus markup. Cost and markup are not shown separately to the customer. */
    packagePrice: number;
    discount: number;
    taxable: number;
    taxLines: TaxLine[];
    total: number;
  };
  disclaimers: string[];
}

export interface BuildQuoteInput {
  reference: string;
  issuedAt: Date;
  validUntil: Date;
  company: QuoteCompany;
  customerName: string;
  itinerary: Itinerary;
  price: PriceBreakdown;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function buildQuoteDocument(input: BuildQuoteInput): QuoteDocument {
  const { itinerary, price } = input;

  const days: QuoteDay[] = itinerary.days.map((d) => ({
    dayNumber: d.dayNumber,
    date: d.date,
    title: d.title,
    items: d.items.map((i) => ({
      time: i.startTime ? (i.endTime ? `${i.startTime}-${i.endTime}` : i.startTime) : undefined,
      title: i.title,
      category: i.category,
      location: i.location,
      indicative: i.status !== "LIVE",
    })),
  }));

  const allItems = days.flatMap((d) => d.items);
  const indicativeCount = allItems.filter((i) => i.indicative).length;

  const disclaimers = [
    "This is a quotation, not a booking confirmation. Nothing has been reserved or paid for.",
    "Prices and availability are subject to confirmation with suppliers and may change until the booking is confirmed and paid.",
  ];
  if (indicativeCount > 0) {
    disclaimers.push(
      `${indicativeCount} of ${allItems.length} itinerary item(s) are marked "indicative": they have not been checked with a supplier, and any price shown for them is an estimate.`
    );
  }

  // Markup is folded into the package price using exact paise arithmetic.
  const packageMinor = Math.round(price.subtotal * 100) + Math.round(price.markup * 100);

  return {
    reference: input.reference,
    issuedAt: isoDay(input.issuedAt),
    validUntil: isoDay(input.validUntil),
    company: input.company,
    customerName: input.customerName,
    trip: { title: itinerary.title, destination: itinerary.destination, startDate: itinerary.startDate, days },
    price: {
      currency: price.currency,
      packagePrice: packageMinor / 100,
      discount: price.discount,
      taxable: price.taxable,
      taxLines: price.taxLines,
      total: price.total,
    },
    disclaimers,
  };
}
