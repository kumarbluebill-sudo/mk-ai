import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTravelDeskClient } from "@/integrations/traveldesk/client";
import { guardRoute } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const querySchema = z.object({ offerId: z.coerce.number().int().positive() });

/** Pick-up hotels for an offer that needs one (offers with isDirectReporting = false). */
export async function GET(request: NextRequest) {
  const denied = await guardRoute("booking:create");
  if (denied) return denied;
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

  let client;
  try {
    client = getTravelDeskClient();
  } catch {
    return NextResponse.json({ error: "SUPPLIER_NOT_CONFIGURED" }, { status: 503 });
  }
  try {
    const hotels = await client.hotelsForOffer(parsed.data.offerId);
    return NextResponse.json({
      success: true,
      hotels: hotels.map((h) => ({ id: h.id, name: h.name, area: h.regionName ?? null, city: h.cityName ?? null })),
    });
  } catch {
    return NextResponse.json({ error: "SUPPLIER_ERROR" }, { status: 502 });
  }
}
