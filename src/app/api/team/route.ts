import { NextRequest, NextResponse } from "next/server";
import { crossOriginResponse } from "@/server/same-origin";
import { rateLimit } from "@/server/rate-limit";
import { requireTenantContext } from "@/server/tenant-context";
import { addStaff, addStaffSchema, listMembers } from "@/server/team/members";
import { teamErrorResponse } from "@/server/team/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireTenantContext("staff:manage");
    return NextResponse.json({ success: true, members: await listMembers(ctx) });
  } catch (error) {
    return teamErrorResponse(error, "Failed to load the team");
  }
}

/** Adds a team member with a temporary password, returned once. */
export async function POST(request: NextRequest) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("staff:manage");
    if (!rateLimit(`team:${ctx.userId}`, 20, 60_000)) return NextResponse.json({ error: "Too many attempts. Please slow down." }, { status: 429 });
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = addStaffSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "INVALID", message: "Check the name, email and role." }, { status: 400 });
    const result = await addStaff(ctx, parsed.data);
    return NextResponse.json({ success: true, ...result }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error, "Failed to add the team member");
  }
}
