import { expect, test } from "@playwright/test";
import { api, BASE_A, BASE_B, login, newAgency, PASSWORD, register, unique } from "./helpers";

test.describe("rate limits are shared across server instances", () => {
  test("registration allows 5 per IP per hour in total, even when requests hit two different servers", async () => {
    const a = await api(BASE_A);
    const b = await api(BASE_B);
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}`; // documentation range, unique enough per run

    // Fire them all at once, alternating between the two servers. A per-process counter would let
    // each server allow 5 (10 in total); a shared counter allows exactly 5.
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => register(i % 2 === 0 ? a : b, { email: `burst${unique("")}${i}@example.test`, agency: `Burst ${unique("")}${i}`, ip }))
    );
    const statuses = results.map((r) => r.status());
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });

  test("repeated wrong passwords lock the account on every server, even for the right password", async () => {
    const { email } = await newAgency("lockout");
    const a = await api(BASE_A);
    const b = await api(BASE_B);

    // 10 failed attempts are allowed per 15 minutes; spread them over both servers.
    for (let i = 0; i < 10; i++) {
      expect(await login(i % 2 === 0 ? a : b, email, { password: "definitely-wrong-1" })).toBe(false);
    }
    // The 11th attempt is refused by whichever server gets it, including with the correct password.
    expect(await login(b, email, { password: PASSWORD })).toBe(false);
    expect(await login(a, email, { password: PASSWORD })).toBe(false);
  });

  test("a normal user is not throttled by other people's traffic", async () => {
    const { ctx } = await newAgency("calm");
    for (let i = 0; i < 5; i++) expect((await ctx.get("/api/billing/summary")).status()).toBe(200);
  });
});
