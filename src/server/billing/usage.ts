import type { Metric } from "./plans";

/** Calendar month in UTC. There is no billing cycle yet, so "this month" is the one predictable period. */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The slice of the scoped Prisma client that usage needs (kept narrow so it is easy to fake in tests). */
export interface UsageDb {
  aiUsage: { aggregate(args: { _sum: { inputTokens: true; outputTokens: true }; where: { createdAt: { gte: Date } } }): Promise<{ _sum: { inputTokens: number | null; outputTokens: number | null } }> };
  conversation: { count(args: { where: { createdAt: { gte: Date } } }): Promise<number> };
  quotation: { count(args: { where: { createdAt: { gte: Date } } }): Promise<number> };
  booking: { count(args: { where: { createdAt: { gte: Date }; idempotencyKey: { not: null }; status: { not: "FAILED" } } }): Promise<number> };
  membership: { count(args: { where: Record<string, never> }): Promise<number> };
}

export type Usage = Record<Metric, number>;

export async function measure(db: UsageDb, metric: Metric, now: Date = new Date()): Promise<number> {
  const since = monthStartUtc(now);
  switch (metric) {
    case "aiTokens": {
      const r = await db.aiUsage.aggregate({ _sum: { inputTokens: true, outputTokens: true }, where: { createdAt: { gte: since } } });
      return (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
    }
    case "conversations":
      return db.conversation.count({ where: { createdAt: { gte: since } } });
    case "quotations":
      return db.quotation.count({ where: { createdAt: { gte: since } } });
    case "bookings":
      // Supplier bookings only (they carry an idempotency key); failed attempts do not count.
      return db.booking.count({ where: { createdAt: { gte: since }, idempotencyKey: { not: null }, status: { not: "FAILED" } } });
    case "seats":
      return db.membership.count({ where: {} });
  }
}

export async function measureAll(db: UsageDb, now: Date = new Date()): Promise<Usage> {
  const [aiTokens, conversations, quotations, bookings, seats] = await Promise.all(
    (["aiTokens", "conversations", "quotations", "bookings", "seats"] as const).map((m) => measure(db, m, now))
  );
  return { aiTokens, conversations, quotations, bookings, seats };
}
