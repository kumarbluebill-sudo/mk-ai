import { NextResponse } from "next/server";
import { listQuotations } from "@/server/quotation/service";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireTenantContext("quotation:read");
    return NextResponse.json({ success: true, quotations: await listQuotations(ctx) });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to load quotations" }, { status: 500 });
  }
}
