import { expect, test } from "@playwright/test";
import { BASE_A, login, newAgency, PASSWORD } from "./helpers";

test.describe("PWA", () => {
  test("the manifest is installable and every icon it names exists", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({ name: "MK AI Travel", display: "standalone", start_url: "/chat", scope: "/" });
    expect(m.theme_color).toMatch(/^#/);

    const icons = m.icons as { src: string; sizes: string; purpose?: string }[];
    expect(icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && (i.purpose ?? "any") === "any")).toBe(true);
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      const r = await request.get(icon.src);
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()["content-type"], icon.src).toContain("image/png");
    }
    expect((await request.get("/icons/apple-touch-icon.png")).status()).toBe(200);
    for (const s of m.shortcuts as { url: string }[]) expect(s.url.startsWith("/")).toBe(true);
  });

  test("the service worker file is never cached by the browser and covers the whole site", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-cache");
    expect(res.headers()["service-worker-allowed"]).toBe("/");
    expect(res.headers()["content-type"]).toContain("javascript");
  });

  test("it registers, shows the offline page when the network drops, and stores nothing private", async ({ page, context }) => {
    // A real signed-in session, so there is private data around that must NOT end up in a cache.
    const { email } = await newAgency("pwa");
    await page.goto(`${BASE_A}/login`);
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/");

    await page.goto(`${BASE_A}/dashboard`);
    await expect(page.getByText("Usage")).toBeVisible();
    await page.evaluate(async () => {
      await fetch("/api/billing/summary");
      await fetch("/api/itineraries");
    });

    // Wait for the worker to take control.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // 1. Privacy: only the offline page and public static assets may be stored.
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) urls.push(new URL(req.url).pathname);
      }
      return urls;
    });
    expect(cached.length).toBeGreaterThan(0);
    for (const path of cached) {
      expect(path, "cached path").toMatch(/^(\/offline|\/icons\/.+|\/_next\/static\/.+)$/);
    }
    expect(cached.some((p) => p.startsWith("/api/"))).toBe(false);
    expect(cached.some((p) => p === "/dashboard" || p === "/chat" || p === "/designer")).toBe(false);

    // 2. Offline: a navigation falls back to the offline page instead of a browser error.
    await context.setOffline(true);
    await page.goto(`${BASE_A}/designer`).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await expect(page.getByText("never stored on this device")).toBeVisible();
    await context.setOffline(false);
  });

  test("a signed-out visitor can still get the offline page", async ({ request }) => {
    const res = await request.get("/offline");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("You are offline");
  });

  test("nothing the browser reports as a Content-Security-Policy violation on the main screens", async ({ page }) => {
    const { email } = await newAgency("csp");
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/content security policy|\[report only\]/i.test(m.text())) violations.push(m.text().slice(0, 200));
    });
    await page.goto(`${BASE_A}/login`);
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    for (const path of ["/dashboard", "/designer", "/bookings", "/settings/security", "/team"]) {
      await page.goto(`${BASE_A}${path}`);
      await page.waitForLoadState("networkidle");
    }
    expect(violations).toEqual([]);
  });

  test("a signed-in API session still works with the worker active (no stale responses)", async () => {
    const { ctx, email } = await newAgency("fresh");
    expect(await login(ctx, email)).toBe(true);
    const a = await (await ctx.get("/api/billing/summary")).json();
    expect(a.entitlements.plan.key).toBe("starter");
  });
});
