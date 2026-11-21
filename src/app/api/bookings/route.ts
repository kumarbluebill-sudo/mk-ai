import { NextResponse } from "next/server";
import { bookingErrorResponse } from "@/server/booking/http";
import { listBookings } from "@/server/booking/traveldesk-booking";
import { requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireTenantContext("booking:read");
    return NextResponse.json({ success: true, bookings: await listBookings(ctx) });
  } catch (error) {
    return bookingErrorResponse(error, "Failed to load bookings");
  }
}
