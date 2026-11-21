import { NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Liveness + DB readiness. Public by design; returns no internal details. */
export async function GET() {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
