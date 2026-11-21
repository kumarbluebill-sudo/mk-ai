import { NextResponse } from "next/server";
import { adminErrorResponse, requireSuperAdmin } from "@/server/admin/guard";
import { getPrismaClient } from "@/lib/prisma";
import { checkEnvironment } from "@/server/env-check";

export const dynamic = "force-dynamic";

/** Configuration problems and runtime facts for the platform admin. Names and reasons only, never values. */
export async function GET() {
  try {
    await requireSuperAdmin();
    const started = Date.now();
    let database: { ok: boolean; latencyMs: number | null } = { ok: false, latencyMs: null };
    try {
      await getPrismaClient().$queryRaw`SELECT 1`;
      database = { ok: true, latencyMs: Date.now() - started };
    } catch {
      // reported as not ok
    }
    return NextResponse.json({
      success: true,
      issues: checkEnvironment(),
      database,
      runtime: {
        node: process.version,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        region: process.env.VERCEL_REGION ?? null,
      },
    });
  } catch (error) {
    return adminErrorResponse(error, "Failed to load system status");
  }
}
