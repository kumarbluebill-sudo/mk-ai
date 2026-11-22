import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { isProviderId } from "@/server/ai/catalog";
import { AiConfigError, testProvider } from "@/server/ai/config";
import { rateLimit } from "@/server/rate-limit";
import { crossOriginResponse } from "@/server/same-origin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Sends one tiny real request to the provider and stores the result as its health. Costs a few tokens. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const admin = await requireSuperAdmin();
    if (!(await rateLimit(`ai-test:${admin.userId}`, 20, 60_000))) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    const { provider } = await params;
    if (!isProviderId(provider)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ success: true, health: await testProvider(provider) });
  } catch (error) {
    if (error instanceof AiConfigError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
    return adminErrorResponse(error, "Failed to test the AI provider");
  }
}
