import { z } from "zod";

/**
 * Plan limits are DATA (Plan.limits and Subscription.limitOverrides), edited by a platform admin.
 * Nothing here hard-codes a tier. A null limit means unlimited.
 */

const limit = z.number().int().min(0).max(1_000_000_000).nullable();

export const featuresSchema = z.object({
  /** AI planner chat. */
  ai: z.boolean(),
  /** Supplier bookings (reserve / confirm / cancel). */
  bookings: z.boolean(),
});

export const limitsSchema = z.object({
  aiTokensPerMonth: limit,
  conversationsPerMonth: limit,
  quotationsPerMonth: limit,
  bookingsPerMonth: limit,
  seats: limit,
  features: featuresSchema,
});
export type Limits = z.infer<typeof limitsSchema>;

/** Per-tenant overrides: any subset of the limits. */
export const limitOverridesSchema = limitsSchema
  .omit({ features: true })
  .partial()
  .extend({ features: featuresSchema.partial().optional() });
export type LimitOverrides = z.infer<typeof limitOverridesSchema>;

/** Everything a subscription can be measured against. */
export type Metric = "aiTokens" | "conversations" | "quotations" | "bookings" | "seats";

export const METRIC_LIMIT_KEY: Record<Metric, keyof Omit<Limits, "features">> = {
  aiTokens: "aiTokensPerMonth",
  conversations: "conversationsPerMonth",
  quotations: "quotationsPerMonth",
  bookings: "bookingsPerMonth",
  seats: "seats",
};

export const METRIC_LABEL: Record<Metric, string> = {
  aiTokens: "AI tokens this month",
  conversations: "Trips and chats started this month",
  quotations: "Quotations this month",
  bookings: "Bookings this month",
  seats: "Team members",
};

/** Plan limits with the tenant's overrides applied. Invalid overrides are ignored, never trusted. */
export function effectiveLimits(planLimits: unknown, overrides: unknown): Limits {
  const base = limitsSchema.parse(planLimits);
  const parsed = overrides == null ? null : limitOverridesSchema.safeParse(overrides);
  if (!parsed?.success) return base;
  const { features, ...rest } = parsed.data;
  return {
    ...base,
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    features: { ...base.features, ...Object.fromEntries(Object.entries(features ?? {}).filter(([, v]) => v !== undefined)) },
  } as Limits;
}
