import { can } from "@/server/permissions";
import { NextRequest, NextResponse } from "next/server";
import { createQuotation, QuotationError, quoteOptionsSchema, visiblePrice } from "@/server/quotation/service";
import { rateLimit } from "@/server/rate-limit";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";
import { getDesignerView } from "@/server/travel/designer";

export const dynamic = "force-dynamic";

/** Creates a DRAFT quotation from this trip. Nothing is booked or sent to a supplier. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantContext("quotation:write");
    if (!(await rateLimit(`quote:${ctx.userId}`, 20, 60_000))) {
      return NextResponse.json({ error: "Too many quotations. Please slow down." }, { status: 429 });
    }
    const { id } = await params;

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = quoteOptionsSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid quotation options" }, { status: 400 });

    const view = await getDesignerView(ctx, id);
    if (!view) return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    if (!view.itinerary) return NextResponse.json({ error: "This conversation has no itinerary yet" }, { status: 409 });

    const q = await createQuotation(ctx, view.itinerary, parsed.data);
    return NextResponse.json(
      {
        success: true,
        quotation: { id: q.id, reference: q.reference, status: "DRAFT", validUntil: q.validUntil, ...visiblePrice(ctx, q.price) },
        // Supplier cost, markup, commission and margin: only for roles allowed to see cost.
        ...(can(ctx.role, "cost:view") ? { margin: q.margin } : {}),
        warnings: q.warnings,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof QuotationError) {
      const status = error.code === "NOTHING_PRICED" || error.code === "PRICING_ERROR" ? 422 : 409;
      return NextResponse.json({ error: error.code, message: error.message }, { status });
    }
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to create quotation" }, { status: 500 });
  }
}
