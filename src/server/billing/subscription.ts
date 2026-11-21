import type { Prisma } from "@/generated/prisma/client";

/**
 * What a subscription's stored status means right now. Pure, so it is easy to test.
 * There is no billing provider: a platform admin sets plan and status by hand.
 */

export type StoredStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "SUSPENDED";

export interface SubscriptionFacts {
  status: StoredStatus;
  trialEndsAt: Date | null;
}

export type EffectiveStatus = StoredStatus | "TRIAL_ENDED";

export interface SubscriptionState {
  status: EffectiveStatus;
  /** May the tenant start new billable work (chats, quotations, bookings, new members)? */
  canUse: boolean;
  /** User-facing explanation when canUse is false, or a warning when it is true. */
  message: string | null;
  trialDaysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function subscriptionState(s: SubscriptionFacts, now: Date = new Date()): SubscriptionState {
  switch (s.status) {
    case "TRIAL": {
      if (s.trialEndsAt && s.trialEndsAt.getTime() <= now.getTime()) {
        return { status: "TRIAL_ENDED", canUse: false, message: "Your free trial has ended. Contact the platform administrator to choose a plan.", trialDaysLeft: 0 };
      }
      const left = s.trialEndsAt ? Math.max(0, Math.ceil((s.trialEndsAt.getTime() - now.getTime()) / DAY_MS)) : null;
      return { status: "TRIAL", canUse: true, message: left === null ? null : `Free trial: ${left} day${left === 1 ? "" : "s"} left.`, trialDaysLeft: left };
    }
    case "ACTIVE":
      return { status: "ACTIVE", canUse: true, message: null, trialDaysLeft: null };
    case "PAST_DUE":
      // Still usable: the platform admin decides when to suspend.
      return { status: "PAST_DUE", canUse: true, message: "Your subscription payment is overdue. Please contact the platform administrator.", trialDaysLeft: null };
    case "CANCELLED":
      return { status: "CANCELLED", canUse: false, message: "This subscription is cancelled. You can still view your data.", trialDaysLeft: null };
    case "SUSPENDED":
      return { status: "SUSPENDED", canUse: false, message: "This account is suspended. Contact the platform administrator.", trialDaysLeft: null };
  }
}

export function trialDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TRIAL_DAYS);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : 14;
}

/** Plan a new agency starts on (key, not id). */
export function trialPlanKey(env: Record<string, string | undefined> = process.env): string {
  return env.TRIAL_PLAN_KEY?.trim() || "starter";
}

type Tx = Pick<Prisma.TransactionClient, "plan" | "subscription">;

/** Starts a trial for a new tenant. Fails loudly if the configured plan does not exist. */
export async function createTrialSubscription(tx: Tx, tenantId: string, now: Date = new Date()) {
  const key = trialPlanKey();
  const plan = await tx.plan.findUnique({ where: { key } });
  if (!plan || !plan.active) throw new Error(`Trial plan "${key}" does not exist or is inactive`);
  return tx.subscription.create({
    data: { tenantId, planId: plan.id, status: "TRIAL", trialEndsAt: new Date(now.getTime() + trialDays() * DAY_MS) },
  });
}
