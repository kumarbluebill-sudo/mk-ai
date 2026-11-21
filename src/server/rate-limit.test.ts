import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const deleteMany = vi.fn(async () => ({ count: 0 }));
vi.mock("@/lib/prisma", () => ({ getPrismaClient: () => ({ $queryRaw: queryRaw, rateLimitBucket: { deleteMany } }) }));

import { memoryRateLimit, rateLimit, resetRateLimits } from "./rate-limit";

beforeEach(() => {
  queryRaw.mockReset();
  deleteMany.mockClear();
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("shared (database) limiter", () => {
  it("allows calls up to the limit and refuses the next one, using the count the database returns", async () => {
    queryRaw.mockResolvedValueOnce([{ count: 4 }]).mockResolvedValueOnce([{ count: 5 }]).mockResolvedValueOnce([{ count: 6 }]);
    expect(await rateLimit("k", 5, 60_000)).toBe(true);
    expect(await rateLimit("k", 5, 60_000)).toBe(true);
    expect(await rateLimit("k", 5, 60_000)).toBe(false);
  });

  it("counts with a single atomic upsert that restarts the window when it has ended", async () => {
    queryRaw.mockResolvedValue([{ count: 1 }]);
    await rateLimit("login:a@x.com", 10, 900_000, Date.parse("2026-11-21T00:00:00Z"));
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toMatch(/INSERT INTO "RateLimitBucket"/);
    expect(sql).toMatch(/ON CONFLICT \("key"\) DO UPDATE/);
    expect(sql).toMatch(/CASE WHEN "RateLimitBucket"."resetAt" <= /);
    expect(values[0]).toBe("login:a@x.com"); // the key is a bound parameter, never concatenated into the SQL
    expect((values[1] as Date).toISOString()).toBe("2026-11-21T00:15:00.000Z");
  });

  it("falls back to a per-process counter, still enforcing the limit, when the database fails", async () => {
    queryRaw.mockRejectedValue(new Error("connection refused"));
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit("fallback", 3, 60_000));
    expect(results).toEqual([true, true, true, false]);
    expect(console.error).toHaveBeenCalled();
  });

  it("treats an unreadable database answer as a failure instead of allowing everything", async () => {
    queryRaw.mockResolvedValue([{ count: "not a number" }]);
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await rateLimit("odd", 2, 60_000));
    expect(results).toEqual([true, true, false]);
  });

  it("occasionally cleans up old buckets without ever blocking the request", async () => {
    queryRaw.mockResolvedValue([{ count: 1 }]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    deleteMany.mockRejectedValueOnce(new Error("cleanup failed"));
    expect(await rateLimit("c", 5, 1000)).toBe(true);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    await rateLimit("c", 5, 1000);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("memory limiter", () => {
  it("starts a fresh window after the old one ends", () => {
    expect(memoryRateLimit("m", 1, 1000, 0)).toBe(true);
    expect(memoryRateLimit("m", 1, 1000, 500)).toBe(false);
    expect(memoryRateLimit("m", 1, 1000, 1001)).toBe(true);
  });
});
