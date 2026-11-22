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

  test("scripts need a per-request nonce: no unsafe-inline, a new nonce each time, and Next's own scripts carry it", async () => {
    const ctx = await api();
    const nonceOf = (csp: string) => /script-src[^;]*'nonce-([^']+)'/.exec(csp)?.[1];
    const first = await ctx.get("/login");
    const second = await ctx.get("/login");
    const csp1 = first.headers()["content-security-policy"];
    const script = /script-src[^;]*/.exec(csp1)?.[0] ?? "";
    expect(script).not.toContain("unsafe-inline");
    expect(script).toContain("'strict-dynamic'");
    const n1 = nonceOf(csp1);
    expect(n1).toBeTruthy();
    expect(nonceOf(second.headers()["content-security-policy"])).not.toBe(n1);
    const html = await first.text();
    const tags = html.match(/<script[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => t.includes(`nonce="${n1}"`))).toBe(true);
  });

  test("markup injected into the page cannot run script (inline handlers and parser-inserted scripts are refused)", async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(`${BASE_A}/login`);
    await page.evaluate(() => {
      (window as unknown as { injected?: boolean }).injected = false;
      // The two classic XSS payloads: an inline event handler, and a script tag inside injected markup.
      const holder = document.createElement("div");
      holder.innerHTML = '<img src="x" onerror="window.injected = true">';
      document.body.appendChild(holder);
      const frame = document.createElement("iframe");
      frame.srcdoc = "<script>parent.injected = true</script>";
      document.body.appendChild(frame);
    });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { injected?: boolean }).injected)).toBe(false);
    await page.close();
  });

  test("protected pages redirect to sign-in and protected APIs answer 401", async ({ request }) => {
    for (const path of ["/", "/chat", "/dashboard", "/designer", "/bookings", "/team", "/admin", "/settings/security"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers().location, path).toContain("/login");
    }
    for (const path of ["/api/billing/summary", "/api/itineraries", "/api/bookings", "/api/team", "/api/admin/tenants", "/api/admin/system", "/api/admin/errors", "/api/maps/config", "/api/suppliers/status"]) {
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
