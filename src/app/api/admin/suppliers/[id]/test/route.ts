import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { rateLimit } from "@/server/rate-limit";
import { crossOriginResponse } from "@/server/same-origin";
import { SupplierAdminError, testSupplier } from "@/server/suppliers/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One real search against this supplier. Uses the supplier's quota, so it is rate limited. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const admin = await requireSuperAdmin();
    if (!(await rateLimit(`supplier-test:${admin.userId}`, 20, 60_000))) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    const { id } = await params;
    return NextResponse.json({ success: true, result: await testSupplier(id) });
  } catch (error) {
    if (error instanceof SupplierAdminError) return NextResponse.json({ error: error.code, message: error.message }, { status: 404 });
    return adminErrorResponse(error, "Failed to test the supplier");
  }
}
