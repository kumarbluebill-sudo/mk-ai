import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

const authMock = vi.fn();
const findUser = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/prisma", () => ({ getPrismaClient: () => ({ user: { findUnique: findUser } }) }));

import { adminErrorResponse, MfaRequiredError, NotAdminError, requireSuperAdmin } from "./guard";
import { createPlan, planCreateSchema, planUpdateSchema, updatePlan } from "./plans";
import { AdminError, subscriptionPatchSchema, updateSubscription } from "./tenants";
import { UnauthorizedError } from "@/server/tenant-context";

const rejection = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as Error | null;

describe("requireSuperAdmin", () => {
  beforeEach(() => {
    authMock.mockReset();
    findUser.mockReset();
  });

  it("needs a signed-in user", async () => {
    authMock.mockResolvedValue(null);
    expect(await rejection(requireSuperAdmin({}))).toBeInstanceOf(UnauthorizedError);
  });

  it("reads the flag from the database, so a session that claims to be admin is not enough", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", isSuperAdmin: true } });
    findUser.mockResolvedValue({ email: "a@x.com", isSuperAdmin: false, totpEnabled: true });
    expect(await rejection(requireSuperAdmin({}))).toBeInstanceOf(NotAdminError);
    findUser.mockResolvedValue(null);
    expect(await rejection(requireSuperAdmin({}))).toBeInstanceOf(NotAdminError);
  });

  it("requires two-factor authentication unless explicitly waived", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    findUser.mockResolvedValue({ email: "a@x.com", isSuperAdmin: true, totpEnabled: false });
    expect(await rejection(requireSuperAdmin({}))).toBeInstanceOf(MfaRequiredError);
    await expect(requireSuperAdmin({ SUPERADMIN_ALLOW_NO_MFA: "true" })).resolves.toEqual({ userId: "u1", email: "a@x.com" });
  });

  it("lets a real administrator with MFA in", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    findUser.mockResolvedValue({ email: "a@x.com", isSuperAdmin: true, totpEnabled: true });
    await expect(requireSuperAdmin({})).resolves.toEqual({ userId: "u1", email: "a@x.com" });
  });

  it("maps errors to 401 / 403 and hides unexpected ones", () => {
    expect(adminErrorResponse(new UnauthorizedError(), "x").status).toBe(401);
    expect(adminErrorResponse(new NotAdminError(), "x").status).toBe(403);
    expect(adminErrorResponse(new MfaRequiredError(), "x").status).toBe(403);
    expect(adminErrorResponse(new AdminError("NOT_FOUND", "no"), "x").status).toBe(404);
    expect(adminErrorResponse(new Error("secret detail"), "Failed").status).toBe(500);
  });
});

// ------------------------------------------------------------------ fake prisma for the services
function fakePrisma(opts: { sub?: boolean; plans?: { id: string; key: string; active: boolean; limits?: unknown }[] } = {}) {
  const audits: { data: Record<string, unknown> }[] = [];
  const updates: { data: Record<string, unknown> }[] = [];
  const plans = opts.plans ?? [{ id: "p-growth", key: "growth", active: true }, { id: "p-old", key: "old", active: false }];
  const sub = {
    id: "s1",
    tenantId: "t1",
    planId: "p-starter",
    status: "TRIAL",
    trialEndsAt: new Date("2026-12-01T00:00:00Z"),
    currentPeriodEnd: null,
    limitOverrides: null,
    notes: null,
    plan: { id: "p-starter", key: "starter", name: "Starter", limits: {} },
  };
  const tenantRow = {
    id: "t1",
    name: "Alpha",
    slug: "alpha",
    createdAt: new Date(),
    subscription: { ...sub, plan: { ...sub.plan, limits: { aiTokensPerMonth: 1, conversationsPerMonth: 1, quotationsPerMonth: 1, bookingsPerMonth: 1, seats: 1, features: { ai: true, bookings: true } } } },
    memberships: [],
  };
  const prisma = {
    subscription: {
      findUnique: async () => (opts.sub === false ? null : sub),
      update: async (a: { data: Record<string, unknown> }) => (updates.push(a), sub),
    },
    plan: {
      findUnique: async ({ where }: { where: { key?: string; id?: string } }) => plans.find((p) => p.key === where.key || p.id === where.id) ?? null,
      findMany: async () => [],
      create: async ({ data }: { data: { key: string } }) => ({ id: "p-new", ...data }),
      update: async () => ({}),
    },
    tenant: { findUnique: async () => tenantRow },
    auditLog: { create: async (a: { data: Record<string, unknown> }) => (audits.push(a), a), findMany: async () => [] },
    aiUsage: { aggregate: async () => ({ _sum: { inputTokens: 0, outputTokens: 0 } }) },
    conversation: { count: async () => 0 },
    quotation: { count: async () => 0 },
    booking: { count: async () => 0 },
    membership: { count: async () => 0 },
    $extends: () => ({
      aiUsage: { aggregate: async () => ({ _sum: { inputTokens: 0, outputTokens: 0 } }) },
      conversation: { count: async () => 0 },
      quotation: { count: async () => 0 },
      booking: { count: async () => 0 },
      membership: { count: async () => 0 },
    }),
  };
  return { prisma: prisma as unknown as PrismaClient, audits, updates };
}

describe("subscriptionPatchSchema", () => {
  it("accepts partial changes and rejects empty or malformed ones", () => {
    expect(subscriptionPatchSchema.safeParse({}).success).toBe(false);
    expect(subscriptionPatchSchema.safeParse({ status: "SUSPENDED" }).success).toBe(true);
    expect(subscriptionPatchSchema.safeParse({ status: "DELETED" }).success).toBe(false);
    expect(subscriptionPatchSchema.safeParse({ trialEndsAt: "2026-12-31T00:00:00Z" }).success).toBe(true);
    expect(subscriptionPatchSchema.safeParse({ trialEndsAt: "tomorrow" }).success).toBe(false);
    expect(subscriptionPatchSchema.safeParse({ limitOverrides: { seats: -1 } }).success).toBe(false);
    expect(subscriptionPatchSchema.safeParse({ limitOverrides: { seats: 10, features: { bookings: true } } }).success).toBe(true);
    expect(subscriptionPatchSchema.safeParse({ limitOverrides: null, notes: null }).success).toBe(true);
  });
});

describe("updateSubscription", () => {
  it("changes plan and status, and audits who did what with the previous values", async () => {
    const { prisma, audits, updates } = fakePrisma();
    await updateSubscription("admin1", "t1", { planKey: "growth", status: "ACTIVE" }, prisma);
    expect(updates[0].data).toMatchObject({ planId: "p-growth", status: "ACTIVE" });
    expect(audits).toHaveLength(1);
    expect(audits[0].data).toMatchObject({ tenantId: "t1", userId: "admin1", action: "admin.subscription_updated" });
    expect(audits[0].data.metadata).toMatchObject({ by: "platform_admin", before: { plan: "starter", status: "TRIAL" }, change: { planKey: "growth", status: "ACTIVE" } });
  });

  it("refuses unknown and inactive plans without changing anything", async () => {
    for (const key of ["nope", "old"]) {
      const { prisma, audits, updates } = fakePrisma();
      const err = await rejection(updateSubscription("a", "t1", { planKey: key }, prisma));
      expect(err).toBeInstanceOf(AdminError);
      expect(updates).toHaveLength(0);
      expect(audits).toHaveLength(0);
    }
  });

  it("reports a tenant without a subscription", async () => {
    const { prisma } = fakePrisma({ sub: false });
    expect((await rejection(updateSubscription("a", "t1", { status: "ACTIVE" }, prisma)) as AdminError).code).toBe("NOT_FOUND");
  });

  it("only touches the fields it was given", async () => {
    const { prisma, updates } = fakePrisma();
    await updateSubscription("a", "t1", { notes: "paid by bank transfer" }, prisma);
    expect(Object.keys(updates[0].data)).toEqual(["notes"]);
  });
});

describe("plans", () => {
  const limits = { aiTokensPerMonth: null, conversationsPerMonth: 10, quotationsPerMonth: 10, bookingsPerMonth: 0, seats: 3, features: { ai: true, bookings: false } };

  it("validates keys and limits", () => {
    expect(planCreateSchema.safeParse({ key: "pro-2", name: "Pro", limits }).success).toBe(true);
    expect(planCreateSchema.safeParse({ key: "Bad Key", name: "Pro", limits }).success).toBe(false);
    expect(planCreateSchema.safeParse({ key: "ok", name: "Pro", limits: { ...limits, seats: 1.5 } }).success).toBe(false);
    expect(planCreateSchema.parse({ key: "ok", name: "Pro", limits }).currency).toBe("INR");
    expect(planUpdateSchema.safeParse({}).success).toBe(false);
    expect(planUpdateSchema.safeParse({ key: "changed" } as unknown).success).toBe(false); // empty after stripping: key is permanent
    // A partial update must contain only what was sent: no defaults may sneak in and reset other fields.
    expect(planUpdateSchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });

  it("refuses a duplicate key and audits a new plan", async () => {
    const { prisma, audits } = fakePrisma();
    expect(((await rejection(createPlan("a", planCreateSchema.parse({ key: "growth", name: "Dup", limits }), prisma))) as AdminError).code).toBe("INVALID");
    await createPlan("a", planCreateSchema.parse({ key: "fresh", name: "Fresh", limits }), prisma);
    expect(audits[0].data).toMatchObject({ action: "admin.plan_created", userId: "a", tenantId: null });
  });

  it("update audits the previous limits", async () => {
    const { prisma, audits } = fakePrisma({ plans: [{ id: "p1", key: "growth", active: true, limits: { seats: 5 } }] });
    await updatePlan("a", "p1", { name: "Growth+" }, prisma);
    expect(audits[0].data.metadata).toMatchObject({ key: "growth", beforeLimits: { seats: 5 }, change: { name: "Growth+" } });
    expect(((await rejection(updatePlan("a", "missing", { name: "x" }, prisma))) as AdminError).code).toBe("NOT_FOUND");
  });
});
