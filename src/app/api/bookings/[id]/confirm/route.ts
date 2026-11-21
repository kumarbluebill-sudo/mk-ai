import { NextRequest, NextResponse } from "next/server";
import { bookingErrorResponse } from "@/server/booking/http";
import { confirmBooking, confirmSchema } from "@/server/booking/traveldesk-booking";
import { rateLimit } from "@/server/rate-limit";
import { crossOriginResponse } from "@/server/same-origin";
import { requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/** Confirms a held reservation. The supplier charges the agency balance, so this needs booking:manage. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("booking:manage");
    if (!rateLimit(`confirm:${ctx.userId}`, 10, 60_000)) {
      return NextResponse.json({ error: "Too many attempts. Please slow down." }, { status: 429 });
    }
    const { id } = await params;
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = confirmSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "INVALID", message: "expectedTotal is required." }, { status: 400 });
    const booking = await confirmBooking(ctx, id, parsed.data.expectedTotal);
    return NextResponse.json({ success: true, booking });
  } catch (error) {
    return bookingErrorResponse(error, "Failed to confirm");
  }
}
