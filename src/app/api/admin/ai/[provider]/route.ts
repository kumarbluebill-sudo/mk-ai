import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { recordAdminAudit } from "@/server/admin/audit";
import { getPrismaClient } from "@/lib/prisma";
import { isProviderId } from "@/server/ai/catalog";
import { removeProvider } from "@/server/ai/config";
import { crossOriginResponse } from "@/server/same-origin";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const admin = await requireSuperAdmin();
    const { provider } = await params;
    if (!isProviderId(provider)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const removed = await removeProvider(provider);
    if (removed) await recordAdminAudit(getPrismaClient(), { actorId: admin.userId, action: "admin.ai_provider_removed", entityId: provider, metadata: { provider } });
    return NextResponse.json({ success: true, removed });
  } catch (error) {
    return adminErrorResponse(error, "Failed to remove the AI provider");
  }
}
