import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { getTenantDetail, subscriptionPatchSchema, updateSubscription } from "@/server/admin/tenants";
import { crossOriginResponse } from "@/server/same-origin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    return NextResponse.json({ success: true, ...(await getTenantDetail(id)) });
  } catch (error) {
    return adminErrorResponse(error, "Failed to load the tenant");
  }
}

/** Change a tenant's plan, status, trial, limit overrides or notes. Always audited. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const admin = await requireSuperAdmin();
    const { id } = await params;
    const parsed = subscriptionPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the values." }, { status: 400 });
    return NextResponse.json({ success: true, ...(await updateSubscription(admin.userId, id, parsed.data)) });
  } catch (error) {
    return adminErrorResponse(error, "Failed to update the subscription");
  }
}
