import { NextRequest, NextResponse } from "next/server";
import { bookingErrorResponse } from "@/server/booking/http";
import { getBooking, refreshBooking } from "@/server/booking/traveldesk-booking";
import { requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/** GET reads our record; add ?refresh=1 to re-read the supplier's status first. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantContext("booking:read");
    const { id } = await params;
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    const booking = refresh ? await refreshBooking(ctx, id) : await getBooking(ctx, id);
    return NextResponse.json({ success: true, booking });
  } catch (error) {
    return bookingErrorResponse(error, "Failed to load booking");
  }
}
