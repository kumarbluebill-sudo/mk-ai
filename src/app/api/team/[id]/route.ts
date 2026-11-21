import { NextRequest, NextResponse } from "next/server";
import { crossOriginResponse } from "@/server/same-origin";
import { requireTenantContext } from "@/server/tenant-context";
import { changeRole, changeRoleSchema, removeMember } from "@/server/team/members";
import { teamErrorResponse } from "@/server/team/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("staff:manage");
    const { id } = await params;
    const parsed = changeRoleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID", message: "Choose a valid role." }, { status: 400 });
    await changeRole(ctx, id, parsed.data.role);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamErrorResponse(error, "Failed to change the role");
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("staff:manage");
    const { id } = await params;
    await removeMember(ctx, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamErrorResponse(error, "Failed to remove the member");
  }
}
