import { NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/prisma";
import { isSchemaMismatch } from "@/server/db-schema";
import { checkEnvironment, summarise } from "@/server/env-check";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness for load balancers and uptime monitors. Public, so it only reports counts:
 *   503 when the database cannot be reached;
 *   200 "degraded" when it can but the configuration has errors (details: admin System page).
 */
export async function GET() {
  const config = summarise(checkEnvironment());
  let database: "ok" | "down" = "ok";
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }
  // Reachable but missing the latest migrations (Vercel does not run them): sign-up and sign-in would fail.
  let schema: "ok" | "outdated" = "ok";
  if (database === "ok") {
    try {
      await getPrismaClient().plan.findFirst({ select: { id: true } });
    } catch (error) {
      if (isSchemaMismatch(error)) schema = "outdated";
    }
  }
  const status = database === "down" ? "down" : config.errors > 0 || schema === "outdated" ? "degraded" : "ok";
  return NextResponse.json({ status, checks: { database, schema, configErrors: config.errors, configWarnings: config.warnings } }, { status: database === "down" ? 503 : 200, headers: { "cache-control": "no-store" } });
}
