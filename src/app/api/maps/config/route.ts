import { NextResponse } from "next/server";
import { publicMapToken } from "@/server/maps/mapbox";
import { guardRoute } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/**
 * What the map UI may use. The token is only ever a public (pk.) token and only for signed-in users;
 * a secret token is never returned. Without one the UI falls back to OpenStreetMap and estimates.
 */
export async function GET() {
  const denied = await guardRoute("itinerary:read");
  if (denied) return denied;
  const token = publicMapToken();
  return NextResponse.json({
    provider: token ? "mapbox" : "osm",
    token,
    routing: token !== null,
    geocoding: token !== null,
  });
}
