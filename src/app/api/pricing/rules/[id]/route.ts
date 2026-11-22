import { NextRequest, NextResponse } from "next/server";
import { ruleErrorResponse } from "@/server/pricing/http";
import { deleteRule, updateRule } from "@/server/pricing/service";
import { crossOriginResponse } from "@/server/same-origin";
import { requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("markup:manage");
    const { id } = await params;
    return NextResponse.json({ success: true, rule: await updateRule(ctx, id, await request.json().catch(() => null)) });
  } catch (error) {
    return ruleErrorResponse(error, "Failed to update the rule");
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("markup:manage");
    const { id } = await params;
    await deleteRule(ctx, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return ruleErrorResponse(error, "Failed to delete the rule");
  }
}
