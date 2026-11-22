import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { recordAdminAudit } from "@/server/admin/audit";
import { getPrismaClient } from "@/lib/prisma";
import { AiConfigError, listProviders, saveProvider, saveSchema, usageSummary } from "@/server/ai/config";
import { crossOriginResponse } from "@/server/same-origin";

export const dynamic = "force-dynamic";

/** Providers (keys never included, only the last 4 characters) and the last 30 days of usage. */
export async function GET() {
  try {
    await requireSuperAdmin();
    const [providers, usage] = await Promise.all([listProviders(), usageSummary(30)]);
    return NextResponse.json({ success: true, providers, usage });
  } catch (error) {
    return adminErrorResponse(error, "Failed to load AI providers");
  }
}

export async function POST(request: NextRequest) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const admin = await requireSuperAdmin();
    const parsed = saveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the values." }, { status: 400 });
    const provider = await saveProvider(parsed.data);
    // The audit entry names what changed, never the key.
    await recordAdminAudit(getPrismaClient(), {
      actorId: admin.userId,
      action: "admin.ai_provider_saved",
      entityId: provider.provider,
      metadata: { provider: provider.provider, model: provider.model, enabled: provider.enabled, priority: provider.priority, keyChanged: Boolean(parsed.data.apiKey) },
    });
    return NextResponse.json({ success: true, provider });
  } catch (error) {
    if (error instanceof AiConfigError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
    return adminErrorResponse(error, "Failed to save the AI provider");
  }
}
