import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import type { TenantContext } from "@/server/tenant-context";
import { marginSummary, reversalDrafts, type MarginSummary } from "./ledger";
import { ruleInputSchema, type PricingRule, type RuleInput } from "./rules";

export class PricingRuleError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID",
    message: string
  ) {
    super(message);
    this.name = "PricingRuleError";
  }
}

type Row = {
  id: string;
  kind: string;
  name: string;
  percentage: Prisma.Decimal | null;
  fixedAmount: Prisma.Decimal | null;
  currency: string;
  supplierKey: string | null;
  productType: string | null;
  destination: string | null;
  customerId: string | null;
  userId: string | null;
  priority: number;
  active: boolean;
  createdAt: Date;
};

export function toRule(r: Row): PricingRule {
  return {
    id: r.id,
    kind: r.kind === "COMMISSION" ? "COMMISSION" : "MARKUP",
    name: r.name,
    percentage: r.percentage !== null ? Number(r.percentage) : null,
    fixedAmount: r.fixedAmount !== null ? Number(r.fixedAmount) : null,
    currency: r.currency,
    supplierKey: r.supplierKey,
    productType: r.productType,
    destination: r.destination,
    customerId: r.customerId,
    userId: r.userId,
    priority: r.priority,
    active: r.active,
    createdAt: r.createdAt,
  };
}

export async function listRules(ctx: TenantContext): Promise<PricingRule[]> {
  const rows = await ctx.db.markupSetting.findMany({ orderBy: [{ kind: "asc" }, { priority: "asc" }, { createdAt: "asc" }], take: 200 });
  return rows.map(toRule);
}

/** People who can earn a commission (name and email only), for the rule form. */
export async function listStaff(ctx: TenantContext): Promise<{ userId: string; name: string }[]> {
  const rows = await ctx.db.membership.findMany({ include: { user: { select: { id: true, name: true, email: true } } }, take: 200 });
  return rows.map((m) => ({ userId: m.user.id, name: m.user.name ?? m.user.email }));
}

/** Rules that point at a person or customer must point at one of this agency's own. */
async function checkReferences(ctx: TenantContext, input: RuleInput): Promise<void> {
  if (input.userId) {
    const m = await ctx.db.membership.findFirst({ where: { userId: input.userId } });
    if (!m) throw new PricingRuleError("INVALID", "That staff member is not part of this agency.");
  }
  if (input.customerId) {
    const c = await ctx.db.customer.findFirst({ where: { id: input.customerId } });
    if (!c) throw new PricingRuleError("INVALID", "That customer was not found.");
  }
}

function data(input: RuleInput) {
  return {
    kind: input.kind,
    name: input.name,
    percentage: input.percentage ?? null,
    fixedAmount: input.fixedAmount ?? null,
    currency: input.currency,
    supplierKey: input.supplierKey ? input.supplierKey.toLowerCase() : null,
    productType: input.productType ?? null,
    destination: input.destination,
    customerId: input.customerId,
    userId: input.userId,
    priority: input.priority,
    active: input.active,
  };
}

export function parseRule(raw: unknown): RuleInput {
  const parsed = ruleInputSchema.safeParse(raw);
  if (!parsed.success) throw new PricingRuleError("INVALID", parsed.error.issues[0]?.message ?? "Check the values.");
  return parsed.data;
}

export async function createRule(ctx: TenantContext, raw: unknown): Promise<PricingRule> {
  const input = parseRule(raw);
  await checkReferences(ctx, input);
  const row = await ctx.db.markupSetting.create({ data: { ...data(input), tenantId: ctx.tenantId } });
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "pricing.rule_created", entity: "MarkupSetting", entityId: row.id, metadata: { kind: input.kind, name: input.name } });
  return toRule(row);
}

export async function updateRule(ctx: TenantContext, id: string, raw: unknown): Promise<PricingRule> {
  const input = parseRule(raw);
  const existing = await ctx.db.markupSetting.findFirst({ where: { id } });
  if (!existing) throw new PricingRuleError("NOT_FOUND", "Rule not found.");
  await checkReferences(ctx, input);
  await ctx.db.markupSetting.updateMany({ where: { id }, data: data(input) });
  const row = await ctx.db.markupSetting.findFirst({ where: { id } });
  if (!row) throw new PricingRuleError("NOT_FOUND", "Rule not found.");
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "pricing.rule_updated", entity: "MarkupSetting", entityId: id, metadata: { kind: input.kind, name: input.name } });
  return toRule(row);
}

/** Deleting a rule never changes past quotations or ledger entries; they keep the figures they were made with. */
export async function deleteRule(ctx: TenantContext, id: string): Promise<void> {
  const res = await ctx.db.markupSetting.deleteMany({ where: { id } });
  if (res.count === 0) throw new PricingRuleError("NOT_FOUND", "Rule not found.");
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "pricing.rule_deleted", entity: "MarkupSetting", entityId: id });
}

export interface LedgerRow {
  id: string;
  kind: string;
  amount: number;
  currency: string;
  label: string | null;
  supplierKey: string | null;
  ruleId: string | null;
  reversesId: string | null;
  createdAt: string;
}

/** A quotation's ledger and its totals. Callers must have checked the cost:view permission. */
export async function quotationLedger(ctx: TenantContext, quotationId: string): Promise<{ entries: LedgerRow[]; summary: MarginSummary | null } | null> {
  const q = await ctx.db.quotation.findFirst({ where: { id: quotationId }, select: { id: true } });
  if (!q) return null;
  const rows = await ctx.db.ledgerEntry.findMany({ where: { quotationId }, orderBy: { createdAt: "asc" }, take: 500 });
  const entries = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    amount: Number(r.amount),
    currency: r.currency,
    label: r.label,
    supplierKey: r.supplierKey,
    ruleId: r.ruleId,
    reversesId: r.reversesId,
    createdAt: r.createdAt.toISOString(),
  }));
  return { entries, summary: marginSummary(entries) };
}

/** Cancels a quotation's financial entries by appending reversing rows. Safe to repeat: nothing is reversed twice. */
export async function reverseQuotationLedger(ctx: TenantContext, quotationId: string): Promise<number> {
  const rows = await ctx.db.ledgerEntry.findMany({ where: { quotationId }, take: 500 });
  const drafts = reversalDrafts(rows.map((r) => ({ id: r.id, kind: r.kind, amount: Number(r.amount), currency: r.currency, reversesId: r.reversesId, supplierKey: r.supplierKey, label: r.label, ruleId: r.ruleId, userId: r.userId })));
  if (drafts.length === 0) return 0;
  await ctx.db.ledgerEntry.createMany({
    data: drafts.map((d) => ({ tenantId: ctx.tenantId, quotationId, kind: d.kind, amount: d.amount, currency: d.currency, supplierKey: d.supplierKey ?? null, label: d.label ?? null, ruleId: d.ruleId ?? null, userId: d.userId ?? null, reversesId: d.reversesId })),
  });
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "ledger.reversed", entity: "Quotation", entityId: quotationId, metadata: { entries: drafts.length } });
  return drafts.length;
}
