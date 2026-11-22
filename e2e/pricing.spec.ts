import { expect, test } from "@playwright/test";
import pg from "pg";
import { api, BASE_A, json, login, newAgency, PASSWORD, unique } from "./helpers";
import { e2eDatabase } from "./database";

const trip = {
  title: "Dubai pricing test",
  destination: "Dubai",
  days: [
    {
      title: "Day one",
      items: [
        { title: "Desert safari", category: "adventure", status: "LIVE", supplier: "viator", price: 1000, currency: "INR" },
        { title: "Museum visit", category: "museum", status: "ESTIMATE", price: 200, currency: "INR" },
      ],
    },
  ],
};

test.describe("pricing rules, commission and the ledger", () => {
  test("rules choose the markup per item, the ledger records it, staff cannot see it, and history cannot be rewritten", async () => {
    const owner = await newAgency("pricing");
    const other = await newAgency("pricing2");

    // The owner sets a general rule, a more specific rule for one supplier, and a commission for themselves.
    const members = await json<{ staff: { userId: string }[]; rules: unknown[] }>(await owner.ctx.get("/api/pricing/rules"));
    expect(members.rules).toHaveLength(0);
    const me = members.staff[0].userId;
    const post = (data: unknown) => owner.ctx.post("/api/pricing/rules", { data });
    expect((await post({ name: "All", percentage: 5 })).status()).toBe(201);
    const viator = await json<{ rule: { id: string } }>(await post({ name: "Viator", percentage: 20, supplierKey: "viator" }));
    expect((await post({ kind: "COMMISSION", name: "Mine", percentage: 10, userId: me })).status()).toBe(201);
    expect((await post({ name: "Bad" })).status()).toBe(400); // neither a percentage nor an amount
    expect((await post({ kind: "COMMISSION", name: "Stranger", percentage: 10, userId: "not-in-this-agency" })).status()).toBe(400);

    // A quotation applies the most specific rule to each item and writes the ledger with it.
    const created = await owner.ctx.post("/api/itineraries", { data: trip });
    expect(created.status()).toBe(201);
    const tripId = (await json<{ conversationId: string }>(created)).conversationId;
    const quoted = await owner.ctx.post(`/api/itineraries/${tripId}/quotation`, { data: { discount: 0, validDays: 3 } });
    expect(quoted.status()).toBe(201);
    const q = await json<{ quotation: { id: string; total: number; markup: number }; margin: { supplierCost: number; markup: number; grossMargin: number; commission: number; netMargin: number } }>(quoted);
    expect(q.quotation.markup).toBe(210); // 20% of 1000 (viator rule) + 5% of 200 (general rule)
    expect(q.quotation.total).toBe(1410);
    expect(q.margin).toMatchObject({ supplierCost: 1200, markup: 210, grossMargin: 210, commission: 21, netMargin: 189 });

    // The ledger shows the same figures and the rule that was used.
    const ledger = await json<{ entries: { kind: string; ruleId: string | null; label: string | null }[]; summary: { sellingTotal: number } }>(await owner.ctx.get(`/api/quotations/${q.quotation.id}/ledger`));
    expect(ledger.summary.sellingTotal).toBe(1410);
    expect(ledger.entries.find((e) => e.kind === "MARKUP" && e.label === "Desert safari")?.ruleId).toBe(viator.rule.id);

    // Another agency sees none of it.
    expect((await other.ctx.get(`/api/quotations/${q.quotation.id}/ledger`)).status()).toBe(404);
    expect((await json<{ rules: unknown[] }>(await other.ctx.get("/api/pricing/rules"))).rules).toHaveLength(0);
    expect((await other.ctx.put(`/api/pricing/rules/${viator.rule.id}`, { data: { name: "x", percentage: 1 } })).status()).toBe(404);
    expect((await other.ctx.delete(`/api/pricing/rules/${viator.rule.id}`)).status()).toBe(404);
    expect((await (await api()).get(`/api/quotations/${q.quotation.id}/ledger`)).status()).toBe(401);
    expect((await owner.ctx.post("/api/pricing/rules", { data: { name: "x", percentage: 1 }, headers: { origin: "https://evil.example" } })).status()).toBe(403);

    // A consultant cannot manage rules and never sees cost, margin or the ledger.
    const email = `staff${unique("")}@example.test`;
    const add = await owner.ctx.post("/api/team", { data: { name: "Staff", email, role: "CONSULTANT" } });
    expect(add.status()).toBe(201);
    const temp = (await json<{ temporaryPassword: string }>(add)).temporaryPassword;
    const staff = await api();
    expect(await login(staff, email, { password: temp })).toBe(true);
    await staff.post("/api/auth/password", { data: { currentPassword: temp, newPassword: PASSWORD } });
    expect((await staff.get("/api/pricing/rules")).status()).toBe(403);
    expect((await staff.post("/api/pricing/rules", { data: { name: "x", percentage: 50 } })).status()).toBe(403);
    expect((await staff.get(`/api/quotations/${q.quotation.id}/ledger`)).status()).toBe(403);

    // Editing a rule changes future quotations only; the ledger of the existing one is untouched.
    expect((await owner.ctx.put(`/api/pricing/rules/${viator.rule.id}`, { data: { name: "Viator", percentage: 50, supplierKey: "viator" } })).status()).toBe(200);
    const again = await json<{ summary: { sellingTotal: number; markup: number } }>(await owner.ctx.get(`/api/quotations/${q.quotation.id}/ledger`));
    expect(again.summary).toMatchObject({ sellingTotal: 1410, markup: 210 });

    // The database itself refuses to change or delete ledger rows, even with direct access.
    const client = new pg.Client({ connectionString: e2eDatabase().direct });
    await client.connect();
    try {
      await expect(client.query(`UPDATE "LedgerEntry" SET amount = 1 WHERE "quotationId" = $1`, [q.quotation.id])).rejects.toThrow(/append-only/);
      await expect(client.query(`DELETE FROM "LedgerEntry" WHERE "quotationId" = $1`, [q.quotation.id])).rejects.toThrow(/append-only/);
      const rows = await client.query(`SELECT count(*)::int AS n FROM "LedgerEntry" WHERE "quotationId" = $1`, [q.quotation.id]);
      expect(rows.rows[0].n).toBeGreaterThan(4);
    } finally {
      await client.end();
    }
  });

  test("the pricing page opens for an owner", async ({ page }) => {
    const { email } = await newAgency("pricingui");
    await page.goto(`${BASE_A}/login`);
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await page.goto(`${BASE_A}/settings/pricing`);
    await expect(page.getByRole("heading", { name: "Pricing rules" })).toBeVisible();
    await page.getByLabel("Name").fill("Everything");
    await page.getByText("Percentage markup").locator("input").fill("7");
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("7% added to supplier cost on everything")).toBeVisible();
  });
});
