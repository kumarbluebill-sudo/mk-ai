import { NextRequest, NextResponse } from "next/server";
import { bookingErrorResponse } from "@/server/booking/http";
import { cancelBooking } from "@/server/booking/traveldesk-booking";
import { rateLimit } from "@/server/rate-limit";
import { crossOriginResponse } from "@/server/same-origin";
import { requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("booking:manage");
    if (!(await rateLimit(`cancel:${ctx.userId}`, 10, 60_000))) {
      return NextResponse.json({ error: "Too many attempts. Please slow down." }, { status: 429 });
    }
    const { id } = await params;
    return NextResponse.json({ success: true, booking: await cancelBooking(ctx, id) });
  } catch (error) {
    return bookingErrorResponse(error, "Failed to cancel");
  }
}
