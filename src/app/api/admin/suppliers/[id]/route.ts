import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrismaClient } from "@/lib/prisma";
import { recordAdminAudit } from "@/server/admin/audit";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { crossOriginResponse } from "@/server/same-origin";
import { SupplierAdminError, setSupplierEnabled } from "@/server/suppliers/settings";

export const dynamic = "force-dynamic";

const body = z.object({ enabled: z.boolean() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const admin = await requireSuperAdmin();
    const { id } = await params;
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });
    await setSupplierEnabled(id, parsed.data.enabled);
    await recordAdminAudit(getPrismaClient(), { actorId: admin.userId, action: parsed.data.enabled ? "admin.supplier_enabled" : "admin.supplier_disabled", entityId: id, metadata: { supplier: id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SupplierAdminError) return NextResponse.json({ error: error.code, message: error.message }, { status: 404 });
    return adminErrorResponse(error, "Failed to update the supplier");
  }
}
