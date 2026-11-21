import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";

/** Platform-admin actions are always recorded, against the affected tenant, so the tenant can see them too. */
export async function recordAdminAudit(
  prisma: Pick<PrismaClient, "auditLog">,
  entry: { actorId: string; tenantId?: string; action: string; entityId?: string; metadata?: unknown }
): Promise<void> {
  // Unlike the best-effort tenant audit, an admin action that cannot be recorded must fail loudly.
  await prisma.auditLog.create({
    data: {
      tenantId: entry.tenantId ?? null,
      userId: entry.actorId,
      action: entry.action,
      entity: entry.tenantId ? "Tenant" : "Platform",
      entityId: entry.entityId ?? entry.tenantId ?? null,
      metadata: { by: "platform_admin", ...((entry.metadata as object) ?? {}) } as unknown as Prisma.InputJsonValue,
    },
  });
}

export interface AuditRow {
  id: string;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  actorEmail: string | null;
  metadata: unknown;
}

export async function listAudit(
  opts: { tenantId?: string; action?: string; take?: number },
  prisma: PrismaClient = getPrismaClient()
): Promise<AuditRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(opts.tenantId && { tenantId: opts.tenantId }),
      ...(opts.action && { action: { startsWith: opts.action } }),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 100, 300),
    include: { tenant: { select: { name: true } }, user: { select: { email: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    tenantId: r.tenantId,
    tenantName: r.tenant?.name ?? null,
    actorEmail: r.user?.email ?? null,
    metadata: r.metadata,
  }));
}
