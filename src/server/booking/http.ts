import { NextResponse } from "next/server";
import { authErrorResponse } from "@/server/tenant-context";
import { BookingError } from "./traveldesk-booking";

const STATUS: Record<BookingError["code"], number> = {
  NOT_CONFIGURED: 503,
  NO_CUSTOMER: 409,
  INVALID: 400,
  UNAVAILABLE: 409,
  PRICE_CHANGED: 409,
  NOT_FOUND: 404,
  WRONG_STATE: 409,
  SUPPLIER_ERROR: 502,
  CORRUPT: 500,
};

/** Maps domain errors to HTTP responses; anything unknown becomes a generic 500 (details stay in the server log). */
export function bookingErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof BookingError) {
    return NextResponse.json({ error: error.code, message: error.message, ...error.extra }, { status: STATUS[error.code] });
  }
  const auth = authErrorResponse(error);
  if (auth) return auth;
  console.error(`[bookings] ${fallback}:`, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
