import { NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { listSupplierAdmin } from "@/server/suppliers/settings";

export const dynamic = "force-dynamic";

/** Names, switches, environment and health numbers. Never any credential value. */
export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json({ success: true, suppliers: await listSupplierAdmin() });
  } catch (error) {
    return adminErrorResponse(error, "Failed to load suppliers");
  }
}
