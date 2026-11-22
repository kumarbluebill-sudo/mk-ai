import { expect, test } from "@playwright/test";
import { BASE_A, json, newAgency, PASSWORD } from "./helpers";

const trip = {
  title: "Dubai test",
  destination: "Dubai",
  days: [{ title: "Arrival", items: [{ title: "Burj", category: "sightseeing", status: "UNVERIFIED", lat: 25.1972, lng: 55.2744 }] }],
};

test.describe("multi-tenant isolation", () => {
  test("one agency can never read, edit, quote or list another agency's trip", async () => {
    const a = await newAgency("alpha");
    const b = await newAgency("beta");

    const created = await a.ctx.post("/api/itineraries", { data: trip });
    expect(created.status()).toBe(201);
    const id = (await json<{ conversationId: string }>(created)).conversationId;

    // A sees it.
    expect((await a.ctx.get(`/api/itineraries/${id}`)).status()).toBe(200);
    expect((await json<{ itineraries: unknown[] }>(await a.ctx.get("/api/itineraries"))).itineraries).toHaveLength(1);

    // B sees nothing, and every way of reaching A's trip answers 404 (never 403: it must not even confirm it exists).
    expect((await json<{ itineraries: unknown[] }>(await b.ctx.get("/api/itineraries"))).itineraries).toHaveLength(0);
    expect((await b.ctx.get(`/api/itineraries/${id}`)).status()).toBe(404);
    expect((await b.ctx.get(`/api/itineraries/${id}/routes`)).status()).toBe(404);
    expect((await b.ctx.post(`/api/itineraries/${id}/optimize`, { data: { day: 1 } })).status()).toBe(404);
    expect((await b.ctx.patch(`/api/itineraries/${id}`, { data: { patches: [{ op: "add_day", title: "hack" }] } })).status()).toBe(404);
    expect((await b.ctx.post(`/api/itineraries/${id}/quotation`, { data: { discount: 0, validDays: 3 } })).status()).toBe(404);

    // The trip really is untouched.
    const after = await json<{ itinerary: { days: unknown[] } }>(await a.ctx.get(`/api/itineraries/${id}`));
    expect(after.itinerary.days).toHaveLength(1);
  });

  test("a trip owned by one agency shows 'not found' to another agency in the browser", async ({ browser }) => {
    const a = await newAgency("alphaui");
    const b = await newAgency("betaui");
    const id = (await json<{ conversationId: string }>(await a.ctx.post("/api/itineraries", { data: trip }))).conversationId;

    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE_A}/login`);
    await page.fill("input[name=email]", b.email);
    await page.fill("input[name=password]", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/");

    await page.goto(`${BASE_A}/designer/${id}`);
    // (Next.js also renders its own role=alert route announcer, so target the page's message.)
    await expect(page.locator("p[role=alert]")).toContainText(/not found/i);
    await expect(page.getByText("Dubai test")).toHaveCount(0);
  });

  test("the same email cannot register twice, and each agency gets its own tenant", async () => {
    const a = await newAgency("dup");
    const res = await a.ctx.post("/api/auth/register", {
      headers: { "x-forwarded-for": "10.9.9.9" },
      data: { name: "Again", email: a.email, password: PASSWORD, agencyName: "Another Agency" },
    });
    expect(res.status()).toBe(409);
    const s1 = await json<{ tenant: { slug: string } }>(await a.ctx.get("/api/billing/summary"));
    const b = await newAgency("dup2");
    const s2 = await json<{ tenant: { slug: string } }>(await b.ctx.get("/api/billing/summary"));
    expect(s1.tenant.slug).not.toBe(s2.tenant.slug);
  });

  test("a session cannot be reused after the person is removed from the agency", async () => {
    const owner = await newAgency("owner2");
    const email = `staff${Date.now()}@example.test`;
    const add = await owner.ctx.post("/api/team", { data: { name: "Staff", email, role: "CONSULTANT" } });
    expect(add.status()).toBe(201);
    const temp = (await json<{ temporaryPassword: string }>(add)).temporaryPassword;

    const { api, login } = await import("./helpers");
    const staff = await api();
    expect(await login(staff, email, { password: temp })).toBe(true);
    expect((await staff.get("/api/billing/summary")).status()).toBe(200);

    const members = (await json<{ members: { membershipId: string; email: string }[] }>(await owner.ctx.get("/api/team"))).members;
    const m = members.find((x) => x.email === email);
    expect((await owner.ctx.delete(`/api/team/${m?.membershipId}`)).status()).toBe(200);

    // The staff member still holds a valid sign-in token. It must stop working immediately.
    expect((await staff.get("/api/billing/summary")).status()).toBe(401);
  });
});
