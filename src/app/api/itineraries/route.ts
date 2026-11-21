import { NextRequest, NextResponse } from "next/server";
import { blankTripBody, createManualItinerary, listDesignerItineraries } from "@/server/travel/designer";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireTenantContext("itinerary:read");
    return NextResponse.json({ success: true, itineraries: await listDesignerItineraries(ctx) });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to load itineraries" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireTenantContext("itinerary:write");
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = blankTripBody.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid trip" }, { status: 400 });
    const created = await createManualItinerary(ctx, parsed.data);
    if (!created) return NextResponse.json({ error: "Customer profile not found" }, { status: 409 });
    return NextResponse.json({ success: true, ...created }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to create itinerary" }, { status: 500 });
  }
}
