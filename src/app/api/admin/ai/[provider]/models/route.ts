import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { isProviderId } from "@/server/ai/catalog";
import { AiConfigError, listModels } from "@/server/ai/config";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** The model ids this provider's server really offers (GET {baseUrl}/models). Nothing is hardcoded. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const admin = await requireSuperAdmin();
    if (!(await rateLimit(`ai-models:${admin.userId}`, 30, 60_000))) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    const { provider } = await params;
    if (!isProviderId(provider)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const result = await listModels(provider);
    // A failed listing is a normal answer for the page to show (200 with ok:false), not a server error.
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AiConfigError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
    return adminErrorResponse(error, "Failed to load models");
  }
}
