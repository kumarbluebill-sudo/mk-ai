import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { createPlan, listPlans, planCreateSchema } from "@/server/admin/plans";
import { crossOriginResponse } from "@/server/same-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json({ success: true, plans: await listPlans() });
  } catch (error) {
    return adminErrorResponse(error, "Failed to list plans");
  }
}

export async function POST(request: NextRequest) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const admin = await requireSuperAdmin();
    const parsed = planCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the values." }, { status: 400 });
    return NextResponse.json({ success: true, plans: await createPlan(admin.userId, parsed.data) }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error, "Failed to create the plan");
  }
}
