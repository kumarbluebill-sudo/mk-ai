import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { listErrors, resolveError } from "@/server/observability/errors";
import { crossOriginResponse } from "@/server/same-origin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const all = request.nextUrl.searchParams.get("all") === "1";
    return NextResponse.json({ success: true, errors: await listErrors({ includeResolved: all }) });
  } catch (error) {
    return adminErrorResponse(error, "Failed to load errors");
  }
}

const resolveSchema = z.object({ id: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    await requireSuperAdmin();
    const body = resolveSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
    return NextResponse.json({ success: true, resolved: await resolveError(body.data.id) });
  } catch (error) {
    return adminErrorResponse(error, "Failed to update the error");
  }
}
