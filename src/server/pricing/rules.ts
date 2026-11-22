import { z } from "zod";
import type { ItineraryItem } from "@/server/travel/itinerary";

/**
 * Pricing rules.
 *
 * MARKUP rules say what the agency adds to the supplier's NET price. A rule may be limited to a supplier, a kind
 * of product, a destination or one customer. For every priced line the most specific matching rule wins; if two
 * are equally specific the lower `priority` number wins, then the older rule. Exactly one markup rule is applied
 * per line, never several stacked, so nothing is counted twice.
 *
 * The supplier's own commission is already inside the net price a supplier quotes and is not added here. Only the
 * agency's markup is. COMMISSION rules are a different thing: what a staff member or sub-agent earns from the
 * agency's margin. They never change the price the customer sees.
 */

export const PRODUCT_TYPES = ["activity", "hotel", "flight", "transfer"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** Itinerary categories grouped into the product types rules can target. */
export function productTypeOf(category: ItineraryItem["category"]): ProductType {
  switch (category) {
    case "hotel":
    case "checkin":
      return "hotel";
    case "flight":
      return "flight";
    case "transfer":
    case "bus":
    case "train":
      return "transfer";
    default:
      return "activity";
  }
}

export interface PricingRule {
  id: string;
  kind: "MARKUP" | "COMMISSION";
  name: string;
  percentage: number | null;
  fixedAmount: number | null;
  currency: string;
  supplierKey: string | null;
  productType: string | null;
  destination: string | null;
  customerId: string | null;
  userId: string | null;
  priority: number;
  active: boolean;
  createdAt: Date;
}

export interface LineFacts {
  supplierKey: string | null;
  productType: ProductType;
  destination: string;
  customerId: string;
  currency: string;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** How many conditions a rule has; used as its specificity. */
export function specificity(rule: PricingRule): number {
  return [rule.supplierKey, rule.productType, rule.destination, rule.customerId].filter((c) => c !== null && c !== "").length;
}

function matches(rule: PricingRule, facts: LineFacts): boolean {
  if (!rule.active || rule.kind !== "MARKUP") return false;
  if (rule.supplierKey && norm(rule.supplierKey) !== norm(facts.supplierKey)) return false;
  if (rule.productType && rule.productType !== facts.productType) return false;
  if (rule.destination && norm(rule.destination) !== norm(facts.destination)) return false;
  if (rule.customerId && rule.customerId !== facts.customerId) return false;
  // A fixed amount is money in one currency; it is never applied to a line in another currency (no conversion here).
  if ((rule.fixedAmount ?? 0) > 0 && rule.currency.toUpperCase() !== facts.currency.toUpperCase()) return false;
  return true;
}

export function selectMarkupRule(rules: readonly PricingRule[], facts: LineFacts): PricingRule | null {
  const hits = rules.filter((r) => matches(r, facts));
  if (hits.length === 0) return null;
  return [...hits].sort((a, b) => specificity(b) - specificity(a) || a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
}

/** The commission a staff member earns: the most recent active rule for them (percentage of the agency's margin). */
export function selectCommissionRule(rules: readonly PricingRule[], userId: string): PricingRule | null {
  const hits = rules.filter((r) => r.active && r.kind === "COMMISSION" && r.userId === userId && (r.percentage ?? 0) > 0);
  if (hits.length === 0) return null;
  return [...hits].sort((a, b) => a.priority - b.priority || b.createdAt.getTime() - a.createdAt.getTime())[0];
}

// ---------------------------------------------------------------------------------------------
// Input validation (used by the admin API)
// ---------------------------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const ruleInputSchema = z
  .object({
    kind: z.enum(["MARKUP", "COMMISSION"]).default("MARKUP"),
    name: z.string().trim().min(1, "Give the rule a name").max(80),
    percentage: z.number().min(0).max(500).nullable().optional(),
    fixedAmount: z.number().min(0).max(10_000_000).nullable().optional(),
    currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).default("INR"),
    supplierKey: optionalText(60),
    productType: z.enum(PRODUCT_TYPES).nullable().optional(),
    destination: optionalText(120),
    customerId: optionalText(60),
    userId: optionalText(60),
    priority: z.number().int().min(1).max(1000).default(100),
    active: z.boolean().default(true),
  })
  .superRefine((r, ctx) => {
    const pct = r.percentage ?? 0;
    const fixed = r.fixedAmount ?? 0;
    if (r.kind === "MARKUP") {
      if (pct <= 0 && fixed <= 0) ctx.addIssue({ code: "custom", message: "Enter a percentage, a fixed amount, or both", path: ["percentage"] });
      if (r.userId) ctx.addIssue({ code: "custom", message: "A markup rule is not tied to a person", path: ["userId"] });
    } else {
      if (!r.userId) ctx.addIssue({ code: "custom", message: "Choose the staff member who earns this commission", path: ["userId"] });
      if (pct <= 0 || pct > 100) ctx.addIssue({ code: "custom", message: "Commission is a percentage of the margin, between 0 and 100", path: ["percentage"] });
      if (fixed > 0) ctx.addIssue({ code: "custom", message: "Commission is a percentage only", path: ["fixedAmount"] });
      if (r.supplierKey || r.productType || r.destination || r.customerId) ctx.addIssue({ code: "custom", message: "Commission rules have no product conditions", path: ["supplierKey"] });
    }
  });

export type RuleInput = z.infer<typeof ruleInputSchema>;
