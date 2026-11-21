import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { listTenants } from "@/server/admin/tenants";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    return NextResponse.json({ success: true, tenants: await listTenants({ q }) });
  } catch (error) {
    return adminErrorResponse(error, "Failed to list tenants");
  }
}
