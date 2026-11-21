import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { planUpdateSchema, updatePlan } from "@/server/admin/plans";
import { crossOriginResponse } from "@/server/same-origin";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const admin = await requireSuperAdmin();
    const { id } = await params;
    const parsed = planUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the values." }, { status: 400 });
    return NextResponse.json({ success: true, plans: await updatePlan(admin.userId, id, parsed.data) });
  } catch (error) {
    return adminErrorResponse(error, "Failed to update the plan");
  }
}
