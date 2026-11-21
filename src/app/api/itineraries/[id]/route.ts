import { NextRequest, NextResponse } from "next/server";
import { applyDesignerPatches, designerPatchBody, getDesignerView, NoItineraryError } from "@/server/travel/designer";
import { ItineraryError } from "@/server/travel/itinerary";
import { rateLimit } from "@/server/rate-limit";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireTenantContext("itinerary:read");
    const { id } = await params;
    const view = await getDesignerView(ctx, id);
    if (!view) return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...view });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to load itinerary" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireTenantContext("itinerary:write");
    if (!(await rateLimit(`designer:${ctx.userId}`, 120, 60_000))) {
      return NextResponse.json({ error: "Too many edits. Please slow down." }, { status: 429 });
    }
    const { id } = await params;

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = designerPatchBody.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid edit" }, { status: 400 });

    const view = await applyDesignerPatches(ctx, id, parsed.data.patches);
    if (!view) return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...view });
  } catch (error) {
    if (error instanceof ItineraryError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NoItineraryError) return NextResponse.json({ error: error.message }, { status: 409 });
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to update itinerary" }, { status: 500 });
  }
}
