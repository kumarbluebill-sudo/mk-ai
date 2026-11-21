import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
import { LimitError } from "./billing/limits";
import { assertCan, Action, ForbiddenError, TenantRoleName } from "./permissions";
import { scopedPrisma, ScopedPrisma } from "./tenant-scope";

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: TenantRoleName;
  /** Prisma client restricted to the caller's tenant. Always use this, not getPrismaClient(). */
  db: ScopedPrisma;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthorizedError";
  }
}

/** Resolves the authenticated tenant context or throws UnauthorizedError / ForbiddenError. */
export async function requireTenantContext(action?: Action): Promise<TenantContext> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.tenantId) throw new UnauthorizedError();

  // The session token is only proof of who the user is. Their role is read from the database on every
  // request so that removing or demoting someone takes effect immediately, not when their token expires.
  const prisma = getPrismaClient();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: user.tenantId } },
    select: { role: true },
  });
  if (!membership) throw new UnauthorizedError();

  if (action) assertCan(membership.role, action);
  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: membership.role,
    db: scopedPrisma(prisma, user.tenantId),
  };
}

/** Maps auth errors to HTTP responses; returns null for unrelated errors. */
export function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (error instanceof LimitError) {
    // 403 with a machine-readable code, so the UI can show the plan message instead of a generic error.
    return NextResponse.json({ error: error.code, message: error.message, ...error.detail }, { status: 403 });
  }
  return null;
}

/**
 * Guard for simple route handlers: returns an error response if the caller is not
 * authenticated / permitted, otherwise null.
 */
export async function guardRoute(action: Action): Promise<NextResponse | null> {
  try {
    await requireTenantContext(action);
    return null;
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
