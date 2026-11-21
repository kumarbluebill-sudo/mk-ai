import { describe, expect, it, vi } from "vitest";
import * as limits from "@/server/billing/limits";
import { verifyPassword } from "@/server/auth/password";
import { ForbiddenError, type TenantRoleName } from "@/server/permissions";
import type { TenantContext } from "@/server/tenant-context";
import {
  addStaff,
  addStaffSchema,
  canManageRole,
  changeRole,
  changeRoleSchema,
  generateTemporaryPassword,
  listMembers,
  removeMember,
  resetMemberPassword,
  TeamError,
} from "./members";

vi.mock("@/server/billing/limits", () => ({
  assertWithinLimit: vi.fn(async () => undefined),
  assertFeature: vi.fn(async () => undefined),
  LimitError: class LimitError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

// ------------------------------------------------------------------ fake tenant database
interface M {
  id: string;
  userId: string;
  tenantId: string;
  role: TenantRoleName;
  createdAt: Date;
}
interface U {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  role?: string;
}

function setup(role: TenantRoleName = "OWNER", extra: { users?: U[]; members?: M[]; customers?: { id: string; userId: string; tenantId: string }[] } = {}) {
  const users: U[] = extra.users ?? [
    { id: "me", email: "me@x.com", name: "Me", passwordHash: "h", mustChangePassword: false, totpEnabled: false },
    { id: "u-admin", email: "admin@x.com", name: "Ad", passwordHash: "h", mustChangePassword: false, totpEnabled: false },
    { id: "u-cons", email: "cons@x.com", name: "Co", passwordHash: "h", mustChangePassword: false, totpEnabled: false },
    { id: "u-owner", email: "owner@x.com", name: "Ow", passwordHash: "h", mustChangePassword: false, totpEnabled: false },
  ];
  const members: M[] = extra.members ?? [
    { id: "m-me", userId: "me", tenantId: "t1", role, createdAt: new Date() },
    { id: "m-admin", userId: "u-admin", tenantId: "t1", role: "ADMIN", createdAt: new Date() },
    { id: "m-cons", userId: "u-cons", tenantId: "t1", role: "CONSULTANT", createdAt: new Date() },
    { id: "m-owner", userId: "u-owner", tenantId: "t1", role: "OWNER", createdAt: new Date() },
    { id: "m-other-tenant", userId: "stranger", tenantId: "t2", role: "CONSULTANT", createdAt: new Date() },
  ];
  const customers = extra.customers ?? [];
  let n = 0;
  const db = {
    membership: {
      // Scoped model: only the caller's tenant is ever visible.
      findMany: async () =>
        members.filter((m) => m.tenantId === "t1").map((m) => ({ ...m, user: users.find((u) => u.id === m.userId) ?? { id: m.userId, email: "?", name: null, totpEnabled: false, mustChangePassword: false } })),
      findFirst: async ({ where }: { where: { id: string } }) => {
        const m = members.find((x) => x.id === where.id && x.tenantId === "t1");
        return m ? { ...m, user: users.find((u) => u.id === m.userId) ?? { id: m.userId, email: "?" } } : null;
      },
      create: async ({ data }: { data: Omit<M, "id" | "createdAt"> }) => {
        const m = { ...data, id: `m-new-${++n}`, createdAt: new Date() };
        members.push(m);
        return m;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<M> }) => Object.assign(members.find((m) => m.id === where.id) as M, data),
      delete: async ({ where }: { where: { id: string } }) => {
        members.splice(members.findIndex((m) => m.id === where.id), 1);
      },
    },
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        const u = users.find((x) => x.email === where.email);
        if (!u) return null;
        return { ...u, memberships: members.filter((m) => m.userId === u.id), customer: customers.find((c) => c.userId === u.id) ?? null };
      },
      create: async ({ data }: { data: Omit<U, "id" | "totpEnabled"> }) => {
        const u = { ...data, id: `u-new-${++n}`, totpEnabled: false } as U;
        users.push(u);
        return u;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<U> }) => Object.assign(users.find((u) => u.id === where.id) as U, data),
    },
    customer: {
      create: async ({ data }: { data: { tenantId: string; userId: string } }) => {
        const c = { ...data, id: `c-${++n}` };
        customers.push(c);
        return c;
      },
    },
  };
  const ctx = { userId: "me", tenantId: "t1", role, db } as unknown as TenantContext;
  return { ctx, users, members, customers };
}

const rejection = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as Error | null;
const teamCode = (e: Error | null) => (e instanceof TeamError ? e.code : e?.name);

describe("role rules", () => {
  it("owner manages everyone below owner; admin manages below admin; others manage nobody", () => {
    expect(canManageRole("OWNER", "ADMIN")).toBe(true);
    expect(canManageRole("OWNER", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "MANAGER")).toBe(true);
    expect(canManageRole("ADMIN", "ADMIN")).toBe(false);
    expect(canManageRole("ADMIN", "OWNER")).toBe(false);
    for (const r of ["MANAGER", "CONSULTANT", "SALES", "ACCOUNTS", "READONLY"] as const) expect(canManageRole(r, "READONLY")).toBe(false);
  });

  it("owner can never be assigned through input validation", () => {
    expect(addStaffSchema.safeParse({ name: "A", email: "a@x.com", role: "OWNER" }).success).toBe(false);
    expect(changeRoleSchema.safeParse({ role: "OWNER" }).success).toBe(false);
    expect(addStaffSchema.safeParse({ name: "A", email: "A@X.com ", role: "SALES" }).data?.email).toBe("a@x.com");
  });

  it("temporary passwords are long and different every time", () => {
    const a = generateTemporaryPassword();
    expect(a).toHaveLength(16);
    expect(generateTemporaryPassword()).not.toBe(a);
  });
});

describe("listMembers", () => {
  it("shows only the caller's agency and marks the caller", async () => {
    const { ctx } = setup();
    const rows = await listMembers(ctx);
    expect(rows.map((r) => r.membershipId)).not.toContain("m-other-tenant");
    expect(rows.find((r) => r.isYou)?.userId).toBe("me");
  });
  it("is only for roles that manage staff", async () => {
    const { ctx } = setup("CONSULTANT");
    expect(await rejection(listMembers(ctx))).toBeInstanceOf(ForbiddenError);
  });
});

describe("addStaff", () => {
  it("creates a user on a hashed temporary password that must be changed, plus membership and customer", async () => {
    const { ctx, users, members, customers } = setup();
    const r = await addStaff(ctx, { name: "New Person", email: "new@x.com", role: "SALES" });
    const user = users.find((u) => u.email === "new@x.com") as U;
    expect(user.passwordHash).not.toContain(r.temporaryPassword);
    expect(await verifyPassword(r.temporaryPassword, user.passwordHash as string)).toBe(true);
    expect(user.mustChangePassword).toBe(true);
    expect(members.find((m) => m.userId === user.id)).toMatchObject({ tenantId: "t1", role: "SALES" });
    expect(customers.find((c) => c.userId === user.id)?.tenantId).toBe("t1");
  });

  it("checks the seat limit before creating anything", async () => {
    const { ctx, users } = setup();
    vi.mocked(limits.assertWithinLimit).mockRejectedValueOnce(new limits.LimitError("PLAN_LIMIT", "No seats left"));
    const err = await rejection(addStaff(ctx, { name: "X", email: "x@x.com", role: "SALES" }));
    expect(err?.message).toBe("No seats left");
    expect(users.find((u) => u.email === "x@x.com")).toBeUndefined();
    expect(limits.assertWithinLimit).toHaveBeenCalledWith(ctx, "seats");
  });

  it("an admin cannot add another admin, a consultant cannot add anyone", async () => {
    expect(teamCode(await rejection(addStaff(setup("ADMIN").ctx, { name: "X", email: "x@x.com", role: "ADMIN" })))).toBe("FORBIDDEN_ROLE");
    expect(await rejection(addStaff(setup("CONSULTANT").ctx, { name: "X", email: "x@x.com", role: "READONLY" }))).toBeInstanceOf(ForbiddenError);
  });

  it("refuses an email that belongs to a team or to another agency's customer profile", async () => {
    const { ctx } = setup();
    expect(teamCode(await rejection(addStaff(ctx, { name: "X", email: "cons@x.com", role: "SALES" })))).toBe("EMAIL_IN_USE");
    const s = setup("OWNER", {
      users: [{ id: "ghost", email: "ghost@x.com", name: null, passwordHash: "h", mustChangePassword: false, totpEnabled: false }],
      members: [{ id: "m-me", userId: "me", tenantId: "t1", role: "OWNER", createdAt: new Date() }],
      customers: [{ id: "c-ghost", userId: "ghost", tenantId: "other-agency" }],
    });
    expect(teamCode(await rejection(addStaff(s.ctx, { name: "X", email: "ghost@x.com", role: "SALES" })))).toBe("EMAIL_IN_USE");
  });

  it("re-adds someone who was removed from this agency, with a fresh password", async () => {
    const s = setup("OWNER", {
      users: [{ id: "back", email: "back@x.com", name: "Old", passwordHash: "old", mustChangePassword: false, totpEnabled: false }],
      members: [{ id: "m-me", userId: "me", tenantId: "t1", role: "OWNER", createdAt: new Date() }],
      customers: [{ id: "c-back", userId: "back", tenantId: "t1" }],
    });
    const r = await addStaff(s.ctx, { name: "Back Again", email: "back@x.com", role: "CONSULTANT" });
    expect(s.users[0]).toMatchObject({ id: "back", mustChangePassword: true, name: "Back Again" });
    expect(await verifyPassword(r.temporaryPassword, s.users[0].passwordHash as string)).toBe(true);
    expect(s.members.some((m) => m.userId === "back" && m.role === "CONSULTANT")).toBe(true);
    expect(s.customers).toHaveLength(1); // the existing profile is reused
  });
});

describe("changeRole / removeMember / resetMemberPassword", () => {
  it("owner can change a consultant, and cannot touch an owner or themselves", async () => {
    const { ctx, members } = setup();
    await changeRole(ctx, "m-cons", "MANAGER");
    expect(members.find((m) => m.id === "m-cons")?.role).toBe("MANAGER");
    expect(teamCode(await rejection(changeRole(ctx, "m-owner", "ADMIN")))).toBe("FORBIDDEN_ROLE");
    expect(teamCode(await rejection(changeRole(ctx, "m-me", "ADMIN")))).toBe("SELF");
  });

  it("an admin cannot demote or remove another admin or the owner, and cannot promote to admin", async () => {
    const { ctx } = setup("ADMIN");
    expect(teamCode(await rejection(changeRole(ctx, "m-admin", "READONLY")))).toBe("FORBIDDEN_ROLE");
    expect(teamCode(await rejection(removeMember(ctx, "m-owner")))).toBe("FORBIDDEN_ROLE");
    expect(teamCode(await rejection(changeRole(ctx, "m-cons", "ADMIN")))).toBe("FORBIDDEN_ROLE");
  });

  it("removing a member deletes their membership; you cannot remove yourself", async () => {
    const { ctx, members } = setup();
    await removeMember(ctx, "m-cons");
    expect(members.some((m) => m.id === "m-cons")).toBe(false);
    expect(teamCode(await rejection(removeMember(ctx, "m-me")))).toBe("SELF");
  });

  it("another agency's member is invisible: not found, never forbidden", async () => {
    const { ctx, members } = setup();
    for (const act of [changeRole(ctx, "m-other-tenant", "SALES"), removeMember(ctx, "m-other-tenant"), resetMemberPassword(ctx, "m-other-tenant")]) {
      expect(teamCode(await rejection(act))).toBe("NOT_FOUND");
    }
    expect(members.some((m) => m.id === "m-other-tenant")).toBe(true);
  });

  it("a password reset sets a new temporary password that must be changed", async () => {
    const { ctx, users } = setup();
    const { temporaryPassword } = await resetMemberPassword(ctx, "m-cons");
    const u = users.find((x) => x.id === "u-cons") as U;
    expect(u.mustChangePassword).toBe(true);
    expect(await verifyPassword(temporaryPassword, u.passwordHash as string)).toBe(true);
    expect(teamCode(await rejection(resetMemberPassword(ctx, "m-me")))).toBe("SELF");
  });
});
