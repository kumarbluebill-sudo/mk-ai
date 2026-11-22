import type { DataStatus, InventoryPrice } from "./types";

/**
 * Normalised shapes for the products the platform will sell once a supplier with real API access is connected.
 * Nothing produces these yet: no flight or hotel supplier is integrated, and no endpoint is guessed. They exist so
 * an adapter written later from a supplier's official documentation maps into one agreed format, and so the
 * itinerary, quotation and booking code can be written against it.
 *
 * Every field that a supplier may not provide is optional. An adapter must leave a field out rather than guess it.
 */

export interface FlightSegment {
  carrierCode: string;
  carrierName?: string;
  flightNumber: string;
  from: string;
  to: string;
  /** ISO local date-time at the airport, exactly as the supplier gave it (no time-zone conversion). */
  departsAt: string;
  arrivesAt: string;
  cabin?: string;
}

export interface FlightOffer {
  supplier: string;
  supplierOfferId: string;
  /** One entry per direction: outbound, then return for round trips. */
  itineraries: { segments: FlightSegment[] }[];
  price: InventoryPrice;
  /** Whether the price includes taxes and fees; unknown stays undefined. */
  taxesIncluded?: boolean;
  baggage?: string;
  fareRules?: string;
  /** Price and seats must be confirmed again with the supplier before booking. */
  requiresRevalidation: true;
  dataStatus: DataStatus;
  checkedAt: string;
}

export interface HotelRoomOffer {
  supplierRoomId: string;
  name: string;
  mealPlan?: string;
  price: InventoryPrice;
  taxesIncluded?: boolean;
  cancellationPolicy?: string;
  /** True when the supplier says the room can be held at this price right now. */
  availableNow?: boolean;
}

export interface HotelOffer {
  supplier: string;
  supplierHotelId: string;
  name: string;
  starRating?: number;
  address?: string;
  lat?: number;
  lng?: number;
  imageUrls?: string[];
  amenities?: string[];
  rooms: HotelRoomOffer[];
  requiresRevalidation: true;
  dataStatus: DataStatus;
  checkedAt: string;
}
