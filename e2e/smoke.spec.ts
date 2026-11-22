import { expect, test } from "@playwright/test";
import { api, BASE_A, json } from "./helpers";

test.describe("smoke", () => {
  test("health reports the database and configuration without leaking details", async () => {
    const ctx = await api();
    const res = await ctx.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await json<{ status: string; checks: { database: string; schema: string; configErrors: number; configWarnings: number } }>(res);
    expect(["ok", "degraded"]).toContain(body.status);
    expect(body.checks.schema).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(typeof body.checks.configErrors).toBe("number");
    // Public endpoint: counts only, never variable names or values.
    expect(JSON.stringify(body)).not.toMatch(/AUTH_SECRET|DATABASE_URL|ENCRYPTION_KEY|postgres/i);
    expect(res.headers()["cache-control"]).toContain("no-store");
  });

  test("security headers are present, including an enforced CSP", async () => {
    const ctx = await api();
    const h = (await ctx.get("/login")).headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("protected pages redirect to sign-in and protected APIs answer 401", async ({ request }) => {
    for (const path of ["/", "/chat", "/dashboard", "/designer", "/bookings", "/team", "/admin", "/settings/security"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers().location, path).toContain("/login");
    }
    for (const path of ["/api/billing/summary", "/api/itineraries", "/api/bookings", "/api/team", "/api/admin/tenants", "/api/admin/system", "/api/maps/config", "/api/suppliers/status"]) {
      expect((await request.get(path)).status(), path).toBe(401);
    }
  });

  test("the debug page does not exist in production", async ({ request }) => {
    expect((await request.get("/debug")).status()).toBe(404);
  });

  test("login and register pages render in a browser with no script errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE_A}/login`);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await page.goto(`${BASE_A}/register`);
    await expect(page.getByRole("button", { name: /create|register/i }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
