import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/server/tenant-context";
import { assertFeature, assertWithinLimit, LimitError, loadEntitlements, usageSummary } from "./limits";
import { effectiveLimits, limitsSchema } from "./plans";
import { subscriptionState, trialDays, trialPlanKey } from "./subscription";
import { monthStartUtc } from "./usage";

const planLimits = {
  aiTokensPerMonth: 1000,
  conversationsPerMonth: 5,
  quotationsPerMonth: 2,
  bookingsPerMonth: 1,
  seats: 3,
  features: { ai: true, bookings: false },
};

describe("effectiveLimits", () => {
  it("applies per-tenant overrides on top of the plan, including single features", () => {
    const l = effectiveLimits(planLimits, { quotationsPerMonth: null, seats: 10, features: { bookings: true } });
    expect(l.quotationsPerMonth).toBeNull(); // null = unlimited is a valid override
    expect(l.seats).toBe(10);
    expect(l.aiTokensPerMonth).toBe(1000);
    expect(l.features).toEqual({ ai: true, bookings: true });
  });

  it("ignores invalid overrides instead of trusting them", () => {
    expect(effectiveLimits(planLimits, { seats: -5 })).toEqual(planLimits);
    expect(effectiveLimits(planLimits, "garbage")).toEqual(planLimits);
    expect(effectiveLimits(planLimits, null)).toEqual(planLimits);
  });

  it("rejects a malformed plan", () => {
    expect(() => effectiveLimits({ seats: 1 }, null)).toThrow();
    expect(limitsSchema.safeParse({ ...planLimits, seats: 1.5 }).success).toBe(false);
  });
});

describe("subscriptionState", () => {
  const now = new Date("2026-11-21T00:00:00Z");
  const day = 86_400_000;

  it("a running trial can use the product and shows days left", () => {
    const s = subscriptionState({ status: "TRIAL", trialEndsAt: new Date(now.getTime() + 3 * day) }, now);
    expect(s).toMatchObject({ status: "TRIAL", canUse: true, trialDaysLeft: 3 });
  });
  it("an ended trial is blocked", () => {
    const s = subscriptionState({ status: "TRIAL", trialEndsAt: new Date(now.getTime() - 1) }, now);
    expect(s).toMatchObject({ status: "TRIAL_ENDED", canUse: false });
    expect(s.message).toMatch(/trial has ended/);
  });
  it("active and past-due can use (past-due with a warning); cancelled and suspended cannot", () => {
    expect(subscriptionState({ status: "ACTIVE", trialEndsAt: null }, now).canUse).toBe(true);
    const due = subscriptionState({ status: "PAST_DUE", trialEndsAt: null }, now);
    expect(due.canUse).toBe(true);
    expect(due.message).toMatch(/overdue/);
    expect(subscriptionState({ status: "CANCELLED", trialEndsAt: null }, now).canUse).toBe(false);
    expect(subscriptionState({ status: "SUSPENDED", trialEndsAt: null }, now).canUse).toBe(false);
  });
  it("trial settings come from the environment with safe defaults", () => {
    expect(trialDays({})).toBe(14);
    expect(trialDays({ TRIAL_DAYS: "30" })).toBe(30);
    expect(trialDays({ TRIAL_DAYS: "-1" })).toBe(14);
    expect(trialDays({ TRIAL_DAYS: "abc" })).toBe(14);
    expect(trialPlanKey({})).toBe("starter");
    expect(trialPlanKey({ TRIAL_PLAN_KEY: "growth" })).toBe("growth");
  });
});

describe("monthStartUtc", () => {
  it("is the first instant of the UTC month", () => {
    expect(monthStartUtc(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(monthStartUtc(new Date("2027-01-01T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

// ------------------------------------------------------------------ enforcement with a fake tenant database
interface Fake {
  status?: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "SUSPENDED";
  trialEndsAt?: Date | null;
  overrides?: unknown;
  limits?: unknown;
  tokens?: { input: number; output: number };
  conversations?: number;
  quotations?: number;
  bookings?: number;
  seats?: number;
  noSubscription?: boolean;
}

function ctxWith(f: Fake): { ctx: TenantContext; seen: Record<string, unknown[]> } {
  const seen: Record<string, unknown[]> = {};
  const note = (k: string, a: unknown) => (seen[k] = [...(seen[k] ?? []), a]);
  const db = {
    subscription: {
      findFirst: async () =>
        f.noSubscription
          ? null
          : {
              status: f.status ?? "ACTIVE",
              trialEndsAt: f.trialEndsAt ?? null,
              currentPeriodEnd: null,
              limitOverrides: f.overrides ?? null,
              plan: { id: "p1", key: "growth", name: "Growth", limits: f.limits ?? planLimits },
            },
    },
    aiUsage: {
      aggregate: async (a: unknown) => (note("ai", a), { _sum: { inputTokens: f.tokens?.input ?? 0, outputTokens: f.tokens?.output ?? 0 } }),
    },
    conversation: { count: async (a: unknown) => (note("conv", a), f.conversations ?? 0) },
    quotation: { count: async (a: unknown) => (note("quote", a), f.quotations ?? 0) },
    booking: { count: async (a: unknown) => (note("book", a), f.bookings ?? 0) },
    membership: { count: async () => f.seats ?? 1 },
  };
  return { ctx: { userId: "u", tenantId: "t", role: "OWNER", db } as unknown as TenantContext, seen };
}

const rejects = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as LimitError | null;

describe("assertWithinLimit", () => {
  it("allows work under the limit and blocks at it, with the numbers in the error", async () => {
    await expect(assertWithinLimit(ctxWith({ quotations: 1 }).ctx, "quotations")).resolves.toBeUndefined();
    const err = await rejects(assertWithinLimit(ctxWith({ quotations: 2 }).ctx, "quotations"));
    expect(err).toBeInstanceOf(LimitError);
    expect(err).toMatchObject({ code: "PLAN_LIMIT", detail: { metric: "quotations", used: 2, limit: 2 } });
    expect(err?.message).toMatch(/Growth plan allows 2/);
  });

  it("blocks AI once tokens used reach the limit", async () => {
    await expect(assertWithinLimit(ctxWith({ tokens: { input: 400, output: 500 } }).ctx, "aiTokens")).resolves.toBeUndefined();
    expect((await rejects(assertWithinLimit(ctxWith({ tokens: { input: 600, output: 400 } }).ctx, "aiTokens")))?.code).toBe("PLAN_LIMIT");
  });

  it("counts new members against the seat limit using the amount being added", async () => {
    await expect(assertWithinLimit(ctxWith({ seats: 2 }).ctx, "seats")).resolves.toBeUndefined();
    expect((await rejects(assertWithinLimit(ctxWith({ seats: 3 }).ctx, "seats")))?.code).toBe("PLAN_LIMIT");
    expect((await rejects(assertWithinLimit(ctxWith({ seats: 2 }).ctx, "seats", 2)))?.code).toBe("PLAN_LIMIT");
  });

  it("a null limit means unlimited and skips the usage query", async () => {
    const { ctx, seen } = ctxWith({ limits: { ...planLimits, quotationsPerMonth: null }, quotations: 9999 });
    await expect(assertWithinLimit(ctx, "quotations")).resolves.toBeUndefined();
    expect(seen.quote).toBeUndefined();
  });

  it("per-tenant overrides win over the plan", async () => {
    const { ctx } = ctxWith({ quotations: 2, overrides: { quotationsPerMonth: 50 } });
    await expect(assertWithinLimit(ctx, "quotations")).resolves.toBeUndefined();
  });

  it("only counts this month and only real supplier bookings", async () => {
    const { ctx, seen } = ctxWith({ bookings: 0 });
    await assertWithinLimit(ctx, "bookings");
    const where = (seen.book[0] as { where: { createdAt: { gte: Date }; idempotencyKey: unknown; status: unknown } }).where;
    expect(where.createdAt.gte.getUTCDate()).toBe(1);
    expect(where.idempotencyKey).toEqual({ not: null });
    expect(where.status).toEqual({ not: "FAILED" });
  });
});

describe("subscription gate", () => {
  it.each(["CANCELLED", "SUSPENDED"] as const)("refuses everything for a %s tenant, even under every limit", async (status) => {
    const { ctx } = ctxWith({ status });
    expect((await rejects(assertWithinLimit(ctx, "quotations")))?.code).toBe("SUBSCRIPTION_INACTIVE");
    expect((await rejects(assertFeature(ctx, "ai")))?.code).toBe("SUBSCRIPTION_INACTIVE");
  });

  it("refuses once a trial has ended", async () => {
    const err = await rejects(assertWithinLimit(ctxWith({ status: "TRIAL", trialEndsAt: new Date(Date.now() - 1000) }).ctx, "conversations"));
    expect(err?.code).toBe("SUBSCRIPTION_INACTIVE");
    expect(err?.message).toMatch(/trial/);
  });

  it("refuses a tenant with no subscription row", async () => {
    expect((await rejects(loadEntitlements(ctxWith({ noSubscription: true }).ctx)))?.code).toBe("SUBSCRIPTION_INACTIVE");
  });

  it("feature flags come from the plan and can be overridden", async () => {
    await expect(assertFeature(ctxWith({}).ctx, "ai")).resolves.toBeUndefined();
    const err = await rejects(assertFeature(ctxWith({}).ctx, "bookings"));
    expect(err?.code).toBe("FEATURE_DISABLED");
    await expect(assertFeature(ctxWith({ overrides: { features: { bookings: true } } }).ctx, "bookings")).resolves.toBeUndefined();
  });
});

describe("usageSummary", () => {
  it("returns entitlements with all five usage numbers", async () => {
    const { entitlements, usage } = await usageSummary(ctxWith({ tokens: { input: 10, output: 5 }, conversations: 2, quotations: 1, bookings: 0, seats: 2 }).ctx);
    expect(usage).toEqual({ aiTokens: 15, conversations: 2, quotations: 1, bookings: 0, seats: 2 });
    expect(entitlements.plan.key).toBe("growth");
    expect(entitlements.limits.seats).toBe(3);
  });
});
