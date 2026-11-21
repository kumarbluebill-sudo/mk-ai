import { NextRequest, NextResponse } from "next/server";
import { crossOriginResponse } from "@/server/same-origin";
import { rateLimit } from "@/server/rate-limit";
import { requireTenantContext } from "@/server/tenant-context";
import { resetMemberPassword } from "@/server/team/members";
import { teamErrorResponse } from "@/server/team/http";

export const dynamic = "force-dynamic";

/** Gives a team member a new temporary password (returned once). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext("staff:manage");
    if (!(await rateLimit(`team-reset:${ctx.userId}`, 10, 60_000))) return NextResponse.json({ error: "Too many attempts. Please slow down." }, { status: 429 });
    const { id } = await params;
    const { temporaryPassword } = await resetMemberPassword(ctx, id);
    return NextResponse.json({ success: true, temporaryPassword }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error, "Failed to reset the password");
  }
}
