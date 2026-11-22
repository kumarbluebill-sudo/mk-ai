import { NextRequest, NextResponse } from "next/server";
import { quotationLedger } from "@/server/pricing/service";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/** The financial entries and margin of one quotation. Cost and margin are internal: cost:view roles only. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantContext("cost:view");
    const { id } = await params;
    const ledger = await quotationLedger(ctx, id);
    if (!ledger) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...ledger });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to load the ledger" }, { status: 500 });
  }
}
