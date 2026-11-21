import { NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/prisma";
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
  const status = database === "down" ? "down" : config.errors > 0 ? "degraded" : "ok";
  return NextResponse.json({ status, checks: { database, configErrors: config.errors, configWarnings: config.warnings } }, { status: database === "down" ? 503 : 200, headers: { "cache-control": "no-store" } });
}
