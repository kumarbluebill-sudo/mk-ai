import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { geocode, MapboxError, publicMapToken } from "@/server/maps/mapbox";
import { rateLimit } from "@/server/rate-limit";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(2).max(200),
  country: z.string().regex(/^[a-zA-Z]{2}(,[a-zA-Z]{2})*$/).optional(),
  nearLat: z.coerce.number().min(-90).max(90).optional(),
  nearLng: z.coerce.number().min(-180).max(180).optional(),
});

/** Place search for the itinerary designer ("find on map"). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireTenantContext("itinerary:write");
    if (publicMapToken() === null) return NextResponse.json({ error: "MAPS_NOT_CONFIGURED" }, { status: 503 });
    if (!rateLimit(`geocode:${ctx.userId}`, 30, 60_000)) {
      return NextResponse.json({ error: "Too many searches. Please slow down." }, { status: 429 });
    }
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return NextResponse.json({ error: "Invalid search" }, { status: 400 });
    const { q, country, nearLat, nearLng } = parsed.data;

    const candidates = await geocode(q, {
      country,
      near: nearLat !== undefined && nearLng !== undefined ? { lat: nearLat, lng: nearLng } : undefined,
      limit: 5,
    });
    return NextResponse.json({ success: true, candidates });
  } catch (error) {
    if (error instanceof MapboxError) {
      return NextResponse.json({ error: "MAPS_ERROR", message: error.message }, { status: error.status === 429 ? 429 : 502 });
    }
    return authErrorResponse(error) ?? NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
