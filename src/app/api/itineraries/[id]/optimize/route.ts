import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMapboxConfigured, MapboxError } from "@/server/maps/mapbox";
import { rateLimit } from "@/server/rate-limit";
import { crossOriginResponse } from "@/server/same-origin";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";
import { getDesignerView, NoItineraryError, optimizeDayByRoad } from "@/server/travel/designer";
import { ItineraryError } from "@/server/travel/itinerary";

export const dynamic = "force-dynamic";

const body = z.object({ day: z.number().int().min(1) });

/**
 * Re-order one day by road (Mapbox Optimization API). When road data is unavailable the answer is
 * 503 with `fallback: true`, and the designer uses its straight-line "optimize_day" instead.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("itinerary:write");
    if (!(await rateLimit(`optimize:${ctx.userId}`, 30, 60_000))) {
      return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    }
    const { id } = await params;
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    // Ownership first, configuration second (a trip that is not yours is "not found" everywhere).
    if (!(await getDesignerView(ctx, id))) return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    if (!isMapboxConfigured()) return NextResponse.json({ error: "Road routing is not configured", fallback: true }, { status: 503 });

    const view = await optimizeDayByRoad(ctx, id, parsed.data.day);
    if (!view) return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...view });
  } catch (error) {
    if (error instanceof MapboxError) return NextResponse.json({ error: error.message, fallback: true }, { status: 503 });
    if (error instanceof ItineraryError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NoItineraryError) return NextResponse.json({ error: error.message }, { status: 409 });
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to optimise" }, { status: 500 });
  }
}
