import { z } from "zod";
import { createTrialSubscription } from "@/server/billing/subscription";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "./password";

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
  agencyName: z.string().trim().min(2).max(120),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export class EmailInUseError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "EmailInUseError";
  }
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "agency";
}

/** Creates a user, their agency (tenant), owner membership and a customer profile atomically. */
export async function registerAgency(prisma: PrismaClient, input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new EmailInUseError();

  const passwordHash = await hashPassword(input.password);
  const slugBase = slugify(input.agencyName);

  return prisma.$transaction(async (tx) => {
    let slug = slugBase;
    for (let i = 2; await tx.tenant.findUnique({ where: { slug } }); i++) {
      slug = `${slugBase}-${i}`;
    }

    const tenant = await tx.tenant.create({ data: { name: input.agencyName, slug } });
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash, role: "ADMIN" },
    });
    await tx.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });
    await tx.customer.create({ data: { tenantId: tenant.id, userId: user.id } });
    await tx.companySettings.create({ data: { tenantId: tenant.id, name: input.agencyName } });
    await createTrialSubscription(tx, tenant.id);

    await tx.auditLog.create({
      data: { tenantId: tenant.id, userId: user.id, action: "tenant.registered", entity: "Tenant", entityId: tenant.id },
    });

    return { userId: user.id, tenantId: tenant.id, slug };
  });
}
