import { expect, test } from "@playwright/test";
import { api, json, login, newAgency, newPlatformAdmin, PASSWORD, revokeAdmin, unique } from "./helpers";

/**
 * Plans, trials, limits, suspension, team and the platform admin console, end to end against a real
 * database. Mirrors what was verified by hand during Phase 8 so it can be re-run on every change.
 */
test.describe.serial("plans, team and platform admin", () => {
  let owner: Awaited<ReturnType<typeof newAgency>>;
  let admin: Awaited<ReturnType<typeof newPlatformAdmin>>;
  let tenantId = "";
  const staffEmail = `staff${unique("")}@example.test`;

  test.beforeAll(async () => {
    owner = await newAgency("saas");
    admin = await newPlatformAdmin();
    const found = await json<{ tenants: { id: string }[] }>(await admin.ctx.get(`/api/admin/tenants?q=${encodeURIComponent(owner.agency)}`));
    tenantId = found.tenants[0].id;
  });

  test.afterAll(async () => {
    revokeAdmin(admin.email);
    await admin.ctx.post("/api/admin/plans", { data: {} }).catch(() => undefined);
  });

  test("a new agency starts a 14-day trial on the Starter plan, read from plan data", async () => {
    const s = await json<{ entitlements: { plan: { key: string }; state: { status: string; trialDaysLeft: number }; limits: { seats: number; features: { bookings: boolean } } } }>(await owner.ctx.get("/api/billing/summary"));
    expect(s.entitlements.plan.key).toBe("starter");
    expect(s.entitlements.state.status).toBe("TRIAL");
    expect(s.entitlements.state.trialDaysLeft).toBe(14);
    expect(s.entitlements.limits.seats).toBe(2);
    expect(s.entitlements.limits.features.bookings).toBe(false);
  });

  test("Starter cannot place a booking: refused before any supplier is contacted", async () => {
    const r = await owner.ctx.post("/api/bookings/traveldesk", {
      headers: { "idempotency-key": `e2e-${unique("")}-aaaa` },
      data: { tourId: 5, offerId: 62, date: "2099-12-15", timeSlotId: 18, adults: 1, guestName: "x" },
    });
    expect(r.status()).toBe(403);
    expect((await json<{ error: string }>(r)).error).toBe("FEATURE_DISABLED");
  });

  test("team: temporary password, seat limit, role change, and instant removal", async () => {
    const add = await owner.ctx.post("/api/team", { data: { name: "Staff", email: staffEmail, role: "CONSULTANT" } });
    expect(add.status()).toBe(201);
    const temp = (await json<{ temporaryPassword: string }>(add)).temporaryPassword;
    expect(temp).toHaveLength(16);

    const third = await owner.ctx.post("/api/team", { data: { name: "Third", email: `third${unique("")}@example.test`, role: "SALES" } });
    expect(third.status()).toBe(403);
    expect((await json<{ error: string }>(third)).error).toBe("PLAN_LIMIT");

    const staff = await api();
    expect(await login(staff, staffEmail, { password: temp })).toBe(true);
    expect((await json<{ mustChangePassword: boolean }>(await staff.get("/api/billing/summary"))).mustChangePassword).toBe(true);
    expect((await staff.get("/api/team")).status()).toBe(403); // a consultant cannot manage the team
    expect((await staff.post("/api/auth/password", { data: { currentPassword: "wrong-wrong-wrong", newPassword: "Another-pw-12345" } })).status()).toBe(403);
    expect((await staff.post("/api/auth/password", { data: { currentPassword: temp, newPassword: "Another-pw-12345" } })).status()).toBe(200);
    expect((await json<{ mustChangePassword: boolean }>(await staff.get("/api/billing/summary"))).mustChangePassword).toBe(false);

    const members = (await json<{ members: { membershipId: string; email: string; isYou: boolean }[] }>(await owner.ctx.get("/api/team"))).members;
    const staffRow = members.find((m) => m.email === staffEmail);
    const ownerRow = members.find((m) => m.isYou);
    expect((await owner.ctx.patch(`/api/team/${staffRow?.membershipId}`, { data: { role: "SALES" } })).status()).toBe(200);
    expect((await json<{ role: string }>(await staff.get("/api/billing/summary"))).role).toBe("SALES"); // existing session, new role
    expect((await owner.ctx.delete(`/api/team/${ownerRow?.membershipId}`)).status()).toBe(400); // not yourself
    expect((await owner.ctx.delete(`/api/team/${staffRow?.membershipId}`)).status()).toBe(200);
    expect((await staff.get("/api/billing/summary")).status()).toBe(401);

    const again = await api();
    expect(await login(again, staffEmail, { password: "Another-pw-12345" })).toBe(false);
  });

  test("the admin console is closed to everyone but an administrator with two-factor", async () => {
    expect((await owner.ctx.get("/api/admin/tenants")).status()).toBe(403);
    expect((await (await api()).get("/api/admin/tenants")).status()).toBe(401);
    expect((await owner.ctx.get("/api/admin/system")).status()).toBe(403);
    expect((await owner.ctx.get("/api/admin/errors")).status()).toBe(403);
    expect((await owner.ctx.get("/api/admin/ai")).status()).toBe(403);
    expect((await owner.ctx.post("/api/admin/ai", { data: { provider: "groq", model: "m", apiKey: "gsk_ownerownerowner0000" } })).status()).toBe(403);
    expect((await (await api()).get("/api/admin/ai")).status()).toBe(401);

    // An administrator who has not turned on two-factor is refused too.
    const weak = await newAgency("weakadmin");
    const { grantAdmin } = await import("./helpers");
    grantAdmin(weak.email);
    try {
      const r = await weak.ctx.get("/api/admin/tenants");
      expect(r.status()).toBe(403);
      expect((await json<{ error: string }>(r)).error).toBe("MFA_REQUIRED");
    } finally {
      revokeAdmin(weak.email);
    }

    const list = await admin.ctx.get(`/api/admin/tenants?q=${encodeURIComponent(owner.agency)}`);
    expect(list.status()).toBe(200);
    const sys = await json<{ issues: unknown[]; database: { ok: boolean } }>(await admin.ctx.get("/api/admin/system"));
    expect(sys.database.ok).toBe(true);
    const errs = await json<{ errors: unknown[] }>(await admin.ctx.get("/api/admin/errors"));
    expect(Array.isArray(errs.errors)).toBe(true);
    // AI providers: a key is stored but never comes back, and is removed again at the end.
    const secret = "gsk_e2esecretvalue0000abcd";
    const saved = await admin.ctx.post("/api/admin/ai", { data: { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: secret, enabled: false, priority: 50 } });
    expect(saved.status()).toBe(200);
    expect(await saved.text()).not.toContain(secret);
    const listing = await admin.ctx.get("/api/admin/ai");
    const listingText = await listing.text();
    expect(listingText).not.toContain(secret);
    expect(JSON.parse(listingText).providers.find((p: { provider: string }) => p.provider === "groq")).toMatchObject({ hasKey: true, keyLast4: "abcd", enabled: false });
    expect((await admin.ctx.post("/api/admin/ai", { data: { provider: "groq", model: "m", baseUrl: "http://169.254.169.254/x" } })).status()).toBe(400);
    expect((await admin.ctx.post("/api/admin/ai/nonsense/test")).status()).toBe(404);
    expect((await admin.ctx.post("/api/admin/ai", { data: { provider: "groq", model: "m" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    expect((await admin.ctx.delete("/api/admin/ai/groq")).status()).toBe(200);
    // Cross-origin writes are blocked even for an administrator.
    expect((await admin.ctx.patch(`/api/admin/tenants/${tenantId}`, { data: { status: "ACTIVE" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
  });

  test("an administrator changes the plan; limits and overrides are enforced and audited", async () => {
    const changed = await admin.ctx.patch(`/api/admin/tenants/${tenantId}`, { data: { planKey: "growth", status: "ACTIVE", limitOverrides: { quotationsPerMonth: 1 }, notes: "e2e" } });
    expect(changed.status()).toBe(200);
    expect((await json<{ limits: { quotationsPerMonth: number; features: { bookings: boolean } } }>(changed)).limits).toMatchObject({ quotationsPerMonth: 1, features: { bookings: true } });

    expect((await admin.ctx.patch(`/api/admin/tenants/${tenantId}`, { data: { planKey: "does-not-exist" } })).status()).toBe(400);
    expect((await admin.ctx.patch(`/api/admin/tenants/${tenantId}`, { data: { limitOverrides: { seats: -3 } } })).status()).toBe(400);

    const trip = await owner.ctx.post("/api/itineraries", { data: { title: "Quote me", destination: "Dubai", days: [{ title: "d1", items: [{ title: "Safari", category: "adventure", status: "ESTIMATE", price: 100, currency: "USD" }] }] } });
    const id = (await json<{ conversationId: string }>(trip)).conversationId;
    expect((await owner.ctx.post(`/api/itineraries/${id}/quotation`, { data: { discount: 0, validDays: 3 } })).status()).toBe(201);
    const second = await owner.ctx.post(`/api/itineraries/${id}/quotation`, { data: { discount: 0, validDays: 3 } });
    expect(second.status()).toBe(403);
    expect((await json<{ error: string }>(second)).error).toBe("PLAN_LIMIT");

    const audit = await json<{ entries: { action: string }[] }>(await admin.ctx.get("/api/admin/audit?action=admin."));
    expect(audit.entries.map((e) => e.action)).toContain("admin.subscription_updated");
    expect((await owner.ctx.get("/api/admin/audit")).status()).toBe(403);
  });

  test("suspending stops new work but leaves the data readable; an ended trial says so", async () => {
    await admin.ctx.patch(`/api/admin/tenants/${tenantId}`, { data: { status: "SUSPENDED" } });
    const blocked = await owner.ctx.post("/api/itineraries", { data: { title: "after", destination: "x", days: [{ title: "d", items: [] }] } });
    expect(blocked.status()).toBe(403);
    expect((await json<{ error: string }>(blocked)).error).toBe("SUBSCRIPTION_INACTIVE");
    expect((await owner.ctx.get("/api/itineraries")).status()).toBe(200);
    expect((await json<{ entitlements: { state: { canUse: boolean } } }>(await owner.ctx.get("/api/billing/summary"))).entitlements.state.canUse).toBe(false);

    await admin.ctx.patch(`/api/admin/tenants/${tenantId}`, { data: { status: "TRIAL", trialEndsAt: new Date(Date.now() - 86_400_000).toISOString() } });
    const ended = await owner.ctx.post("/api/itineraries", { data: { title: "after", destination: "x", days: [{ title: "d", items: [] }] } });
    expect((await json<{ message: string }>(ended)).message).toMatch(/trial/i);

    await admin.ctx.patch(`/api/admin/tenants/${tenantId}`, { data: { status: "ACTIVE" } });
    expect((await owner.ctx.post("/api/itineraries", { data: { title: "back", destination: "x", days: [{ title: "d", items: [] }] } })).status()).toBe(201);
  });

  test("plans are data: create, rename without side effects, reject duplicates", async () => {
    const key = `e2e-${unique("").slice(-8)}`.toLowerCase();
    const limits = { aiTokensPerMonth: null, conversationsPerMonth: 5, quotationsPerMonth: 5, bookingsPerMonth: 0, seats: 2, features: { ai: true, bookings: false } };
    const created = await admin.ctx.post("/api/admin/plans", { data: { key, name: "E2E", limits } });
    expect(created.status()).toBe(201);
    const plan = (await json<{ plans: { id: string; key: string }[] }>(created)).plans.find((p) => p.key === key);
    const renamed = await admin.ctx.patch(`/api/admin/plans/${plan?.id}`, { data: { name: "E2E renamed" } });
    const after = (await json<{ plans: { key: string; name: string; currency: string; sortOrder: number; limits: { conversationsPerMonth: number } }[] }>(renamed)).plans.find((p) => p.key === key);
    // A partial update must not reset anything it did not mention.
    expect(after).toMatchObject({ name: "E2E renamed", currency: "INR", sortOrder: 0 });
    expect(after?.limits.conversationsPerMonth).toBe(5);
    expect((await admin.ctx.post("/api/admin/plans", { data: { key, name: "dup", limits } })).status()).toBe(400);
    await admin.ctx.patch(`/api/admin/plans/${plan?.id}`, { data: { active: false } });
  });

  test("password sign-in still works for the owner throughout", async () => {
    const fresh = await api();
    expect(await login(fresh, owner.email, { password: PASSWORD })).toBe(true);
  });
});
