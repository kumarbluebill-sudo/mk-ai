import { NextRequest, NextResponse } from "next/server";
import { ruleErrorResponse } from "@/server/pricing/http";
import { createRule, listRules, listStaff } from "@/server/pricing/service";
import { crossOriginResponse } from "@/server/same-origin";
import { requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireTenantContext("markup:manage");
    return NextResponse.json({ success: true, rules: await listRules(ctx), staff: await listStaff(ctx) });
  } catch (error) {
    return ruleErrorResponse(error, "Failed to load pricing rules");
  }
}

export async function POST(request: NextRequest) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("markup:manage");
    return NextResponse.json({ success: true, rule: await createRule(ctx, await request.json().catch(() => null)) }, { status: 201 });
  } catch (error) {
    return ruleErrorResponse(error, "Failed to create the rule");
  }
}
