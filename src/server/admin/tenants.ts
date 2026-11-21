import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";
import { effectiveLimits, limitOverridesSchema, type Limits } from "@/server/billing/plans";
import { subscriptionState, type SubscriptionState } from "@/server/billing/subscription";
import { monthStartUtc, measureAll, type Usage, type UsageDb } from "@/server/billing/usage";
import { scopedPrisma } from "@/server/tenant-scope";
import { recordAdminAudit } from "./audit";

/**
 * Platform-wide tenant management. This module deliberately uses the unscoped Prisma client: it is
 * the only code that reads across agencies, and it is only reachable through requireSuperAdmin().
 */

export class AdminError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID",
    message: string
  ) {
    super(message);
    this.name = "AdminError";
  }
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  members: number;
  subscription: { status: string; planKey: string; planName: string; trialEndsAt: string | null } | null;
  state: SubscriptionState | null;
  usage: { aiTokens: number; conversations: number; quotations: number; bookings: number };
}

export async function listTenants(opts: { q?: string; take?: number } = {}, prisma: PrismaClient = getPrismaClient()): Promise<TenantRow[]> {
  const q = opts.q?.trim();
  const tenants = await prisma.tenant.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 50, 200),
    include: { subscription: { include: { plan: { select: { key: true, name: true } } } }, _count: { select: { memberships: true } } },
  });
  const ids = tenants.map((t) => t.id);
  const since = monthStartUtc();

  // Four grouped queries for the whole page instead of four per tenant.
  const [tokens, convs, quotes, books] = await Promise.all([
    prisma.aiUsage.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } }),
    prisma.conversation.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.quotation.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, createdAt: { gte: since }, idempotencyKey: { not: null }, status: { not: "FAILED" } }, _count: { _all: true } }),
  ]);
  const byTenant = <T extends { tenantId: string }>(rows: T[]) => new Map(rows.map((r) => [r.tenantId, r]));
  const tk = byTenant(tokens);
  const cv = byTenant(convs);
  const qt = byTenant(quotes);
  const bk = byTenant(books);

  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    createdAt: t.createdAt.toISOString(),
    members: t._count.memberships,
    subscription: t.subscription
      ? { status: t.subscription.status, planKey: t.subscription.plan.key, planName: t.subscription.plan.name, trialEndsAt: t.subscription.trialEndsAt?.toISOString() ?? null }
      : null,
    state: t.subscription ? subscriptionState({ status: t.subscription.status, trialEndsAt: t.subscription.trialEndsAt }) : null,
    usage: {
      aiTokens: (tk.get(t.id)?._sum.inputTokens ?? 0) + (tk.get(t.id)?._sum.outputTokens ?? 0),
      conversations: cv.get(t.id)?._count._all ?? 0,
      quotations: qt.get(t.id)?._count._all ?? 0,
      bookings: bk.get(t.id)?._count._all ?? 0,
    },
  }));
}

export interface TenantDetail {
  tenant: { id: string; name: string; slug: string; createdAt: string };
  subscription: {
    status: string;
    planId: string;
    planKey: string;
    planName: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    limitOverrides: unknown;
    notes: string | null;
  } | null;
  state: SubscriptionState | null;
  limits: Limits | null;
  usage: Usage;
  members: { email: string; name: string | null; role: string; totpEnabled: boolean }[];
  recentAudit: { at: string; action: string; entity: string; actorId: string | null }[];
}

export async function getTenantDetail(id: string, prisma: PrismaClient = getPrismaClient()): Promise<TenantDetail> {
  const t = await prisma.tenant.findUnique({
    where: { id },
    include: {
      subscription: { include: { plan: true } },
      memberships: { include: { user: { select: { email: true, name: true, totpEnabled: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!t) throw new AdminError("NOT_FOUND", "Tenant not found.");

  const [usage, audit] = await Promise.all([
    // The same measuring code the product uses, through a client locked to this one tenant.
    measureAll(scopedPrisma(prisma, id) as unknown as UsageDb),
    prisma.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const sub = t.subscription;
  return {
    tenant: { id: t.id, name: t.name, slug: t.slug, createdAt: t.createdAt.toISOString() },
    subscription: sub
      ? {
          status: sub.status,
          planId: sub.planId,
          planKey: sub.plan.key,
          planName: sub.plan.name,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          limitOverrides: sub.limitOverrides,
          notes: sub.notes,
        }
      : null,
    state: sub ? subscriptionState({ status: sub.status, trialEndsAt: sub.trialEndsAt }) : null,
    limits: sub ? effectiveLimits(sub.plan.limits, sub.limitOverrides) : null,
    usage,
    members: t.memberships.map((m) => ({ email: m.user.email, name: m.user.name, role: m.role, totpEnabled: m.user.totpEnabled })),
    recentAudit: audit.map((a) => ({ at: a.createdAt.toISOString(), action: a.action, entity: a.entity, actorId: a.userId })),
  };
}

const isoOrNull = z.string().datetime({ offset: true }).nullable();

export const subscriptionPatchSchema = z
  .object({
    planKey: z.string().min(1).max(40).optional(),
    status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED", "SUSPENDED"]).optional(),
    trialEndsAt: isoOrNull.optional(),
    currentPeriodEnd: isoOrNull.optional(),
    limitOverrides: limitOverridesSchema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, "Nothing to change.");
export type SubscriptionPatch = z.infer<typeof subscriptionPatchSchema>;

export async function updateSubscription(
  actorId: string,
  tenantId: string,
  patch: SubscriptionPatch,
  prisma: PrismaClient = getPrismaClient()
): Promise<TenantDetail> {
  const sub = await prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  if (!sub) throw new AdminError("NOT_FOUND", "This tenant has no subscription.");

  let planId: string | undefined;
  if (patch.planKey !== undefined) {
    const plan = await prisma.plan.findUnique({ where: { key: patch.planKey } });
    if (!plan || !plan.active) throw new AdminError("INVALID", `Plan "${patch.planKey}" does not exist or is inactive.`);
    planId = plan.id;
  }

  await prisma.subscription.update({
    where: { tenantId },
    data: {
      ...(planId !== undefined && { planId }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.trialEndsAt !== undefined && { trialEndsAt: patch.trialEndsAt === null ? null : new Date(patch.trialEndsAt) }),
      ...(patch.currentPeriodEnd !== undefined && { currentPeriodEnd: patch.currentPeriodEnd === null ? null : new Date(patch.currentPeriodEnd) }),
      // Prisma needs DbNull to clear a JSON column; undefined leaves it untouched.
      ...(patch.limitOverrides !== undefined && { limitOverrides: patch.limitOverrides === null ? Prisma.DbNull : (patch.limitOverrides as Prisma.InputJsonValue) }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
    },
  });

  await recordAdminAudit(prisma, {
    actorId,
    tenantId,
    action: "admin.subscription_updated",
    metadata: {
      before: { plan: sub.plan.key, status: sub.status, trialEndsAt: sub.trialEndsAt?.toISOString() ?? null, limitOverrides: sub.limitOverrides },
      change: patch,
    },
  });
  return getTenantDetail(tenantId, prisma);
}
