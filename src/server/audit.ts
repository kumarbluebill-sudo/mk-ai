import { getPrismaClient } from "@/lib/prisma";

export interface AuditEntry {
  tenantId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  /** Never put secrets, passwords or full payment data here. */
  metadata?: Record<string, string | number | boolean | null>;
}

/** Best-effort audit write: failures are logged but never break the user's request. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await getPrismaClient().auditLog.create({
      data: {
        tenantId: entry.tenantId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? undefined,
      },
    });
  } catch (error) {
    console.error("Audit log write failed:", error instanceof Error ? error.message : error);
  }
}
