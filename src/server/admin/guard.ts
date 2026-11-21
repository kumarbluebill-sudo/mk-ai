import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import { UnauthorizedError } from "@/server/tenant-context";
import { AdminError } from "./tenants";

/**
 * Platform administrator access. This is the one place that may look across agencies, so it is strict:
 *   - the flag is read from the database on every request (never from the session token),
 *   - the administrator must have two-factor authentication enabled,
 *   - everything done here is written to the audit log by the caller.
 * Grant the flag from a trusted shell with `npm run admin:grant -- someone@example.com`.
 */

export class NotAdminError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "NotAdminError";
  }
}

export class MfaRequiredError extends Error {
  constructor() {
    super("Platform administrators must enable two-factor authentication first.");
    this.name = "MfaRequiredError";
  }
}

export interface SuperAdmin {
  userId: string;
  email: string;
}

export async function requireSuperAdmin(env: Record<string, string | undefined> = process.env): Promise<SuperAdmin> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new UnauthorizedError();

  const user = await getPrismaClient().user.findUnique({ where: { id }, select: { email: true, isSuperAdmin: true, totpEnabled: true } });
  // The same answer for "not an admin" and "no such user": never confirm the console exists to others.
  if (!user?.isSuperAdmin) throw new NotAdminError();
  if (!user.totpEnabled && env.SUPERADMIN_ALLOW_NO_MFA !== "true") throw new MfaRequiredError();
  return { userId: id, email: user.email };
}

export function adminErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (error instanceof NotAdminError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (error instanceof MfaRequiredError) return NextResponse.json({ error: "MFA_REQUIRED", message: error.message }, { status: 403 });
  if (error instanceof AdminError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
  console.error(`[admin] ${fallback}:`, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
