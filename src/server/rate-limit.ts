import { getPrismaClient } from "@/lib/prisma";

/**
 * Fixed-window rate limiter shared by every server instance.
 *
 * Counters live in Postgres (RateLimitBucket) and are bumped with one atomic upsert, so the limit holds
 * even when Vercel runs many instances at once (an in-memory counter would give each instance its own
 * allowance). If the database call fails, it falls back to a per-process counter and logs it: a limiter
 * outage must never lock everyone out, and the fallback still blunts abuse on that instance.
 *
 * Use `await rateLimit(key, limit, windowMs)`; it resolves true when the call is allowed.
 */

const memory = new Map<string, { count: number; resetAt: number }>();

export function memoryRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const bucket = memory.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Roughly 1 call in 100 removes buckets that expired more than a day ago. */
const CLEANUP_ODDS = 0.01;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  try {
    const prisma = getPrismaClient();
    const resetAt = new Date(now + windowMs);
    const at = new Date(now);
    // One statement, atomic under concurrency: start a new window if the old one ended, otherwise count up.
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${at} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${at} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count"`;
    if (Math.random() < CLEANUP_ODDS) {
      void prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(now - DAY_MS) } } }).catch(() => undefined);
    }
    const count = Number(rows[0]?.count);
    if (!Number.isFinite(count)) throw new Error("unexpected rate limit result");
    return count <= limit;
  } catch (error) {
    console.error("[rate-limit] database limiter failed, using the in-memory fallback:", error instanceof Error ? error.message : error);
    return memoryRateLimit(key, limit, windowMs, now);
  }
}

export function resetRateLimits(): void {
  memory.clear();
}
