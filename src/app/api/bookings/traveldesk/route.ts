import { NextRequest, NextResponse } from "next/server";
import { bookingErrorResponse } from "@/server/booking/http";
import { reserveSchema, reserveTraveldeskBooking } from "@/server/booking/traveldesk-booking";
import { rateLimit } from "@/server/rate-limit";
import { crossOriginResponse } from "@/server/same-origin";
import { requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Reserve (hold) a Traveldesk tour. Nothing is charged. Requires an Idempotency-Key header so a
 * retried request returns the same booking instead of creating a second hold.
 */
export async function POST(request: NextRequest) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("booking:create");
    if (!(await rateLimit(`reserve:${ctx.userId}`, 10, 60_000))) {
      return NextResponse.json({ error: "Too many booking attempts. Please slow down." }, { status: 429 });
    }
    const key = request.headers.get("idempotency-key") ?? "";
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
      return NextResponse.json({ error: "INVALID", message: "An Idempotency-Key header (8-64 letters, digits, - or _) is required." }, { status: 400 });
    }
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = reserveSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "INVALID", message: "Check the booking details." }, { status: 400 });

    const { booking, replay } = await reserveTraveldeskBooking(ctx, parsed.data, key);
    return NextResponse.json({ success: true, replay, booking }, { status: replay ? 200 : 201 });
  } catch (error) {
    return bookingErrorResponse(error, "Failed to reserve");
  }
}
