import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";
import { limitsSchema, type Limits } from "@/server/billing/plans";
import { recordAdminAudit } from "./audit";
import { AdminError } from "./tenants";

export interface PlanRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  priceMonthlyMinor: number | null;
  currency: string;
  limits: Limits | null;
  /** True when the stored limits no longer match the expected shape (should not happen). */
  invalidLimits: boolean;
  tenants: number;
}

export async function listPlans(prisma: PrismaClient = getPrismaClient()): Promise<PlanRow[]> {
  const plans = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { subscriptions: true } } } });
  return plans.map((p) => {
    const limits = limitsSchema.safeParse(p.limits);
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      active: p.active,
      sortOrder: p.sortOrder,
      priceMonthlyMinor: p.priceMonthlyMinor,
      currency: p.currency,
      limits: limits.success ? limits.data : null,
      invalidLimits: !limits.success,
      tenants: p._count.subscriptions,
    };
  });
}

const planFields = {
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000),
  priceMonthlyMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
  currency: z.string().length(3).toUpperCase(),
  limits: limitsSchema,
};

export const planCreateSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/, "Use lowercase letters, digits, - or _ (2-31 characters)."),
  ...planFields,
  sortOrder: planFields.sortOrder.default(0),
  currency: planFields.currency.default("INR"),
});
export type PlanCreate = z.infer<typeof planCreateSchema>;

/**
 * `key` is permanent: subscriptions and the trial setting refer to it. Built from the fields WITHOUT
 * defaults, so a partial update can never silently reset sortOrder or currency.
 */
export const planUpdateSchema = z
  .object(planFields)
  .partial()
  .extend({ active: z.boolean().optional() })
  .refine((p) => Object.keys(p).length > 0, "Nothing to change.");
export type PlanUpdate = z.infer<typeof planUpdateSchema>;

export async function createPlan(actorId: string, input: PlanCreate, prisma: PrismaClient = getPrismaClient()): Promise<PlanRow[]> {
  if (await prisma.plan.findUnique({ where: { key: input.key } })) throw new AdminError("INVALID", `A plan with key "${input.key}" already exists.`);
  const plan = await prisma.plan.create({
    data: {
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      sortOrder: input.sortOrder,
      priceMonthlyMinor: input.priceMonthlyMinor ?? null,
      currency: input.currency,
      limits: input.limits as unknown as Prisma.InputJsonValue,
    },
  });
  await recordAdminAudit(prisma, { actorId, action: "admin.plan_created", entityId: plan.id, metadata: { key: input.key, limits: input.limits } });
  return listPlans(prisma);
}

export async function updatePlan(actorId: string, id: string, patch: PlanUpdate, prisma: PrismaClient = getPrismaClient()): Promise<PlanRow[]> {
  const before = await prisma.plan.findUnique({ where: { id } });
  if (!before) throw new AdminError("NOT_FOUND", "Plan not found.");
  await prisma.plan.update({
    where: { id },
    data: {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.active !== undefined && { active: patch.active }),
      ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
      ...(patch.priceMonthlyMinor !== undefined && { priceMonthlyMinor: patch.priceMonthlyMinor }),
      ...(patch.currency !== undefined && { currency: patch.currency }),
      ...(patch.limits !== undefined && { limits: patch.limits as unknown as Prisma.InputJsonValue }),
    },
  });
  await recordAdminAudit(prisma, { actorId, action: "admin.plan_updated", entityId: id, metadata: { key: before.key, beforeLimits: before.limits, change: patch } });
  return listPlans(prisma);
}
