import type { TenantContext } from "@/server/tenant-context";
import { effectiveLimits, METRIC_LABEL, METRIC_LIMIT_KEY, type Limits, type Metric } from "./plans";
import { subscriptionState, type SubscriptionState } from "./subscription";
import { measure, measureAll, type Usage, type UsageDb } from "./usage";

/**
 * Plan enforcement. Every billable action calls one of these before it starts work:
 *   assertWithinLimit(ctx, "quotations")   a count/quota metric
 *   assertFeature(ctx, "bookings")         a feature switched on for the plan
 * A suspended, cancelled or trial-ended tenant is refused everything here.
 */

export class LimitError extends Error {
  constructor(
    readonly code: "PLAN_LIMIT" | "SUBSCRIPTION_INACTIVE" | "FEATURE_DISABLED",
    message: string,
    readonly detail?: { metric?: Metric; used?: number; limit?: number }
  ) {
    super(message);
    this.name = "LimitError";
  }
}

export interface Entitlements {
  plan: { id: string; key: string; name: string };
  state: SubscriptionState;
  limits: Limits;
  subscription: { trialEndsAt: string | null; currentPeriodEnd: string | null };
}

const usageDb = (ctx: TenantContext) => ctx.db as unknown as UsageDb;

export async function loadEntitlements(ctx: TenantContext, now: Date = new Date()): Promise<Entitlements> {
  const sub = await ctx.db.subscription.findFirst({ include: { plan: true } });
  if (!sub) throw new LimitError("SUBSCRIPTION_INACTIVE", "This account has no subscription. Contact the platform administrator.");
  return {
    plan: { id: sub.plan.id, key: sub.plan.key, name: sub.plan.name },
    state: subscriptionState({ status: sub.status, trialEndsAt: sub.trialEndsAt }, now),
    limits: effectiveLimits(sub.plan.limits, sub.limitOverrides),
    subscription: { trialEndsAt: sub.trialEndsAt?.toISOString() ?? null, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null },
  };
}

function requireActive(ent: Entitlements): void {
  if (!ent.state.canUse) throw new LimitError("SUBSCRIPTION_INACTIVE", ent.state.message ?? "This subscription is not active.");
}

export async function assertFeature(ctx: TenantContext, feature: keyof Limits["features"]): Promise<void> {
  const ent = await loadEntitlements(ctx);
  requireActive(ent);
  if (!ent.limits.features[feature]) {
    throw new LimitError("FEATURE_DISABLED", `${ent.plan.name} does not include ${feature === "ai" ? "the AI planner" : "supplier bookings"}. Ask the platform administrator to change your plan.`);
  }
}

export async function assertWithinLimit(ctx: TenantContext, metric: Metric, adding = 1): Promise<void> {
  const ent = await loadEntitlements(ctx);
  requireActive(ent);
  const limit = ent.limits[METRIC_LIMIT_KEY[metric]];
  if (limit === null) return;
  const used = await measure(usageDb(ctx), metric);
  if (used + adding > limit) {
    throw new LimitError("PLAN_LIMIT", `Your ${ent.plan.name} plan allows ${limit} for "${METRIC_LABEL[metric]}" and ${used} are used. Ask the platform administrator to raise the limit.`, { metric, used, limit });
  }
}

export async function usageSummary(ctx: TenantContext): Promise<{ entitlements: Entitlements; usage: Usage }> {
  const [entitlements, usage] = await Promise.all([loadEntitlements(ctx), measureAll(usageDb(ctx))]);
  return { entitlements, usage };
}
