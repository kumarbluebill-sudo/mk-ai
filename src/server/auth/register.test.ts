import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { verifyPassword } from "./password";
import { EmailInUseError, registerAgency, registerSchema, slugify } from "./register";

function fakePrisma(opts: { emailTaken?: boolean; takenSlugs?: string[] } = {}) {
  const calls = { tenant: vi.fn(), user: vi.fn(), membership: vi.fn(), customer: vi.fn(), settings: vi.fn(), audit: vi.fn() };
  const tx = {
    tenant: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
        opts.takenSlugs?.includes(where.slug) ? { id: "x" } : null
      ),
      create: vi.fn(async (a: unknown) => (calls.tenant(a), { id: "tenant1" })),
    },
    user: { create: vi.fn(async (a: unknown) => (calls.user(a), { id: "user1" })) },
    membership: { create: vi.fn(async (a: unknown) => calls.membership(a)) },
    customer: { create: vi.fn(async (a: unknown) => calls.customer(a)) },
    companySettings: { create: vi.fn(async (a: unknown) => calls.settings(a)) },
    auditLog: { create: vi.fn(async (a: unknown) => calls.audit(a)) },
  };
  const prisma = {
    user: { findUnique: vi.fn(async () => (opts.emailTaken ? { id: "existing" } : null)) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma: prisma as unknown as PrismaClient, calls };
}

const input = registerSchema.parse({
  name: "Asha",
  email: "  ASHA@Example.com ",
  password: "correct horse battery",
  agencyName: "Blue Sky Travels",
});

describe("registerSchema", () => {
  it("normalises email and rejects weak input", () => {
    expect(input.email).toBe("asha@example.com");
    expect(registerSchema.safeParse({ ...input, password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, email: "nope" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, agencyName: "" }).success).toBe(false);
  });
});

describe("slugify", () => {
  it("produces url-safe slugs", () => {
    expect(slugify("Blue Sky Travels!")).toBe("blue-sky-travels");
    expect(slugify("!!!")).toBe("agency");
  });
});

describe("registerAgency", () => {
  it("creates tenant, hashed user, owner membership, customer and settings", async () => {
    const { prisma, calls } = fakePrisma();
    const r = await registerAgency(prisma, input);
    expect(r).toEqual({ userId: "user1", tenantId: "tenant1", slug: "blue-sky-travels" });

    const userData = calls.user.mock.calls[0][0].data;
    expect(userData.passwordHash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", userData.passwordHash)).toBe(true);
    expect(calls.membership.mock.calls[0][0].data).toMatchObject({ userId: "user1", tenantId: "tenant1", role: "OWNER" });
    expect(calls.customer.mock.calls[0][0].data).toMatchObject({ tenantId: "tenant1", userId: "user1" });
    expect(calls.settings.mock.calls[0][0].data).toMatchObject({ tenantId: "tenant1" });
    expect(calls.audit.mock.calls[0][0].data).toMatchObject({ action: "tenant.registered", tenantId: "tenant1" });
  });

  it("picks a unique slug when taken", async () => {
    const { prisma } = fakePrisma({ takenSlugs: ["blue-sky-travels", "blue-sky-travels-2"] });
    expect((await registerAgency(prisma, input)).slug).toBe("blue-sky-travels-3");
  });

  it("rejects an existing email without writing anything", async () => {
    const { prisma, calls } = fakePrisma({ emailTaken: true });
    await expect(registerAgency(prisma, input)).rejects.toThrow(EmailInUseError);
    expect(calls.tenant).not.toHaveBeenCalled();
  });
});
