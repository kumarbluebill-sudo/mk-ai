import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";
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
  if (action) assertCan(user.role, action);
  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    db: scopedPrisma(getPrismaClient(), user.tenantId),
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
