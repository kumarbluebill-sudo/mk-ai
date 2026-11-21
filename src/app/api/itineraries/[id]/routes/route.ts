import { NextRequest, NextResponse } from "next/server";
import { publicMapToken } from "@/server/maps/mapbox";
import { routeDays } from "@/server/maps/routing";
import { rateLimit } from "@/server/rate-limit";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";
import { getDesignerView } from "@/server/travel/designer";

export const dynamic = "force-dynamic";

/**
 * Real driving legs for each day of a trip (Mapbox). The designer calls this after loading or
 * editing and falls back to its straight-line estimates for any day not returned.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantContext("itinerary:read");
    if (!(await rateLimit(`routes:${ctx.userId}`, 60, 60_000))) {
      return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    }
    const { id } = await params;
    // Ownership first, configuration second: a trip that is not yours is "not found" in every environment,
    // never a hint (like "maps are off") that depends on how the server is set up.
    const view = await getDesignerView(ctx, id);
    if (!view) return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    if (publicMapToken() === null) return NextResponse.json({ error: "MAPS_NOT_CONFIGURED" }, { status: 503 });
    if (!view.itinerary) return NextResponse.json({ success: true, routes: {}, failedDays: [] });
    return NextResponse.json({ success: true, ...(await routeDays(view.itinerary)) });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to route" }, { status: 500 });
  }
}
