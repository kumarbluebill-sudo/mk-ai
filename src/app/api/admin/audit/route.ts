import { NextRequest, NextResponse } from "next/server";
import { listAudit } from "@/server/admin/audit";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const sp = request.nextUrl.searchParams;
    const take = Number(sp.get("take"));
    return NextResponse.json({
      success: true,
      entries: await listAudit({ tenantId: sp.get("tenantId") ?? undefined, action: sp.get("action") ?? undefined, take: Number.isInteger(take) && take > 0 ? take : 100 }),
    });
  } catch (error) {
    return adminErrorResponse(error, "Failed to load the audit log");
  }
}
