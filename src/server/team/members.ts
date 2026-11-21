import { randomBytes } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { assertWithinLimit } from "@/server/billing/limits";
import { assertCan, TENANT_ROLES, type TenantRoleName } from "@/server/permissions";
import type { TenantContext } from "@/server/tenant-context";

/**
 * Staff management for one agency. There is no email delivery yet, so a new member (or a password
 * reset) gets a temporary password that is shown once and must be changed at first use.
 *
 * Who may do what:
 *   - OWNER manages everyone below OWNER and is the only one who can assign ADMIN.
 *   - ADMIN manages roles below ADMIN.
 *   - Nobody can assign OWNER, change an OWNER, or touch themselves through these functions.
 */

export class TeamError extends Error {
  constructor(
    readonly code: "FORBIDDEN_ROLE" | "NOT_FOUND" | "EMAIL_IN_USE" | "SELF" | "INVALID",
    message: string
  ) {
    super(message);
    this.name = "TeamError";
  }
}

/** Roles each actor may assign or manage. */
const MANAGEABLE: Record<TenantRoleName, readonly TenantRoleName[]> = {
  OWNER: ["ADMIN", "MANAGER", "CONSULTANT", "SALES", "ACCOUNTS", "READONLY"],
  ADMIN: ["MANAGER", "CONSULTANT", "SALES", "ACCOUNTS", "READONLY"],
  MANAGER: [],
  CONSULTANT: [],
  SALES: [],
  ACCOUNTS: [],
  READONLY: [],
};

export function canManageRole(actor: TenantRoleName, target: TenantRoleName): boolean {
  return MANAGEABLE[actor].includes(target);
}

export const addStaffSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(TENANT_ROLES).refine((r) => r !== "OWNER", "An owner cannot be added."),
});
export type AddStaffInput = z.infer<typeof addStaffSchema>;

export const changeRoleSchema = z.object({ role: z.enum(TENANT_ROLES).refine((r) => r !== "OWNER", "Owner cannot be assigned.") });

/** 16 characters, ~96 bits of randomness. */
export function generateTemporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}

export interface MemberView {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  role: TenantRoleName;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  joinedAt: string;
  isYou: boolean;
}

export async function listMembers(ctx: TenantContext): Promise<MemberView[]> {
  assertCan(ctx.role, "staff:manage");
  const rows = await ctx.db.membership.findMany({
    include: { user: { select: { id: true, email: true, name: true, totpEnabled: true, mustChangePassword: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    membershipId: m.id,
    userId: m.user.id,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    totpEnabled: m.user.totpEnabled,
    mustChangePassword: m.user.mustChangePassword,
    joinedAt: m.createdAt.toISOString(),
    isYou: m.user.id === ctx.userId,
  }));
}

async function target(ctx: TenantContext, membershipId: string) {
  // Membership is a tenant-scoped model, so this can only ever find a member of the caller's agency.
  const m = await ctx.db.membership.findFirst({ where: { id: membershipId }, include: { user: { select: { id: true, email: true } } } });
  if (!m) throw new TeamError("NOT_FOUND", "Team member not found.");
  return m;
}

export async function addStaff(ctx: TenantContext, input: AddStaffInput): Promise<{ member: { userId: string; email: string; role: TenantRoleName }; temporaryPassword: string }> {
  assertCan(ctx.role, "staff:manage");
  if (!canManageRole(ctx.role, input.role)) throw new TeamError("FORBIDDEN_ROLE", `You cannot add someone as ${input.role}.`);
  await assertWithinLimit(ctx, "seats");

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const existing = await ctx.db.user.findUnique({
    where: { email: input.email },
    include: { memberships: { select: { id: true } }, customer: { select: { id: true, tenantId: true } } },
  });

  let userId: string;
  if (existing) {
    // An account that belongs to (or once belonged to) another agency cannot be taken over.
    if (existing.memberships.length > 0) throw new TeamError("EMAIL_IN_USE", "That email already belongs to a team.");
    if (existing.customer && existing.customer.tenantId !== ctx.tenantId) throw new TeamError("EMAIL_IN_USE", "That email already has an account elsewhere.");
    userId = existing.id;
    await ctx.db.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true, name: input.name } });
    if (!existing.customer) await ctx.db.customer.create({ data: { tenantId: ctx.tenantId, userId } });
  } else {
    const user = await ctx.db.user.create({
      data: { email: input.email, name: input.name, passwordHash, mustChangePassword: true, role: "AGENT" },
    });
    userId = user.id;
    await ctx.db.customer.create({ data: { tenantId: ctx.tenantId, userId } });
  }
  await ctx.db.membership.create({ data: { tenantId: ctx.tenantId, userId, role: input.role } });

  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "team.member_added", entity: "User", entityId: userId, metadata: { role: input.role } });
  return { member: { userId, email: input.email, role: input.role }, temporaryPassword };
}

export async function changeRole(ctx: TenantContext, membershipId: string, role: TenantRoleName): Promise<void> {
  assertCan(ctx.role, "staff:manage");
  const m = await target(ctx, membershipId);
  if (m.userId === ctx.userId) throw new TeamError("SELF", "You cannot change your own role.");
  if (!canManageRole(ctx.role, m.role)) throw new TeamError("FORBIDDEN_ROLE", `You cannot change a ${m.role}.`);
  if (!canManageRole(ctx.role, role)) throw new TeamError("FORBIDDEN_ROLE", `You cannot assign ${role}.`);
  await ctx.db.membership.update({ where: { id: m.id }, data: { role } });
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "team.role_changed", entity: "User", entityId: m.userId, metadata: { from: m.role, to: role } });
}

/** Removes access immediately: the session check reads the membership from the database on every request. */
export async function removeMember(ctx: TenantContext, membershipId: string): Promise<void> {
  assertCan(ctx.role, "staff:manage");
  const m = await target(ctx, membershipId);
  if (m.userId === ctx.userId) throw new TeamError("SELF", "You cannot remove yourself.");
  if (!canManageRole(ctx.role, m.role)) throw new TeamError("FORBIDDEN_ROLE", `You cannot remove a ${m.role}.`);
  await ctx.db.membership.delete({ where: { id: m.id } });
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "team.member_removed", entity: "User", entityId: m.userId, metadata: { role: m.role } });
}

export async function resetMemberPassword(ctx: TenantContext, membershipId: string): Promise<{ temporaryPassword: string }> {
  assertCan(ctx.role, "staff:manage");
  const m = await target(ctx, membershipId);
  if (m.userId === ctx.userId) throw new TeamError("SELF", "Use Change password for your own account.");
  if (!canManageRole(ctx.role, m.role)) throw new TeamError("FORBIDDEN_ROLE", `You cannot reset a ${m.role}'s password.`);
  const temporaryPassword = generateTemporaryPassword();
  await ctx.db.user.update({ where: { id: m.userId }, data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true } });
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "team.password_reset", entity: "User", entityId: m.userId });
  return { temporaryPassword };
}
