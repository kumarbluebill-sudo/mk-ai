import { NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/prisma";
import { usageSummary } from "@/server/billing/limits";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/** Plan, subscription state, limits and this month's usage for the caller's agency. */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [summary, tenant, me] = await Promise.all([
      usageSummary(ctx),
      getPrismaClient().tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true, slug: true } }),
      getPrismaClient().user.findUnique({ where: { id: ctx.userId }, select: { mustChangePassword: true, totpEnabled: true } }),
    ]);
    return NextResponse.json({
      success: true,
      tenant,
      role: ctx.role,
      mustChangePassword: me?.mustChangePassword ?? false,
      totpEnabled: me?.totpEnabled ?? false,
      ...summary,
    });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to load the summary" }, { status: 500 });
  }
}
