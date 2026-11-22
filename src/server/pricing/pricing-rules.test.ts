import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/server/tenant-context";
import { createItinerary } from "@/server/travel/itinerary";
import { calculatePackagePrice } from "@/server/travel/pricing";
import { commissionMinor, marginSummary, quotationLedgerDrafts, reversalDrafts, type LedgerDraft } from "./ledger";
import { productTypeOf, ruleInputSchema, selectCommissionRule, selectMarkupRule, specificity, type PricingRule } from "./rules";
import { createRule, deleteRule, listRules, PricingRuleError, quotationLedger, reverseQuotationLedger, updateRule } from "./service";

vi.mock("@/server/billing/limits", () => ({ assertWithinLimit: vi.fn(async () => undefined), assertFeature: vi.fn(async () => undefined), LimitError: class extends Error {} }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));

let seq = 0;
function rule(over: Partial<PricingRule> = {}): PricingRule {
  seq += 1;
  return { id: `r${seq}`, kind: "MARKUP", name: "r", percentage: 10, fixedAmount: null, currency: "INR", supplierKey: null, productType: null, destination: null, customerId: null, userId: null, priority: 100, active: true, createdAt: new Date(2026, 0, seq), ...over };
}
const facts = { supplierKey: "viator", productType: "activity" as const, destination: "Dubai", customerId: "c1", currency: "INR" };

describe("choosing a markup rule", () => {
  it("picks the most specific matching rule and never stacks two", () => {
    const everything = rule({ percentage: 5 });
    const viator = rule({ percentage: 8, supplierKey: "viator" });
    const viatorDubai = rule({ percentage: 12, supplierKey: "viator", destination: "dubai" });
    const hotelOnly = rule({ percentage: 20, productType: "hotel" });
    expect(selectMarkupRule([everything, viator, viatorDubai, hotelOnly], facts)?.id).toBe(viatorDubai.id);
    expect(selectMarkupRule([everything, viator, hotelOnly], facts)?.id).toBe(viator.id);
    expect(selectMarkupRule([everything, hotelOnly], facts)?.id).toBe(everything.id);
    expect(selectMarkupRule([hotelOnly], facts)).toBeNull();
  });

  it("breaks ties by lower priority number, then the older rule", () => {
    const a = rule({ supplierKey: "viator", priority: 50, percentage: 9 });
    const b = rule({ supplierKey: "viator", priority: 10, percentage: 7 });
    expect(selectMarkupRule([a, b], facts)?.id).toBe(b.id);
    const older = rule({ supplierKey: "viator", priority: 10, createdAt: new Date(2020, 0, 1) });
    expect(selectMarkupRule([b, older], facts)?.id).toBe(older.id);
  });

  it("ignores inactive rules, commission rules, and fixed amounts in another currency", () => {
    expect(selectMarkupRule([rule({ active: false })], facts)).toBeNull();
    expect(selectMarkupRule([rule({ kind: "COMMISSION", userId: "u1" })], facts)).toBeNull();
    expect(selectMarkupRule([rule({ percentage: null, fixedAmount: 50, currency: "USD" })], facts)).toBeNull();
    expect(selectMarkupRule([rule({ percentage: null, fixedAmount: 50, currency: "INR" })], facts)).not.toBeNull();
    // a percentage has no currency, so it applies to a line in any currency
    expect(selectMarkupRule([rule({ percentage: 10, currency: "INR" })], { ...facts, currency: "USD" })).not.toBeNull();
  });

  it("matches supplier and destination case-insensitively and customer exactly", () => {
    expect(selectMarkupRule([rule({ supplierKey: "VIATOR", destination: " DUBAI " })], facts)).not.toBeNull();
    expect(selectMarkupRule([rule({ customerId: "c2" })], facts)).toBeNull();
    expect(selectMarkupRule([rule({ customerId: "c1" })], facts)).not.toBeNull();
    expect(specificity(rule({ supplierKey: "viator", customerId: "c1" }))).toBe(2);
  });

  it("maps itinerary categories to product types", () => {
    expect(["hotel", "checkin", "flight", "transfer", "bus", "train", "sightseeing", "museum", "other"].map((c) => productTypeOf(c as never))).toEqual(["hotel", "hotel", "flight", "transfer", "transfer", "transfer", "activity", "activity", "activity"]);
  });

  it("finds a staff member's commission rule", () => {
    const mine = rule({ kind: "COMMISSION", userId: "u1", percentage: 20 });
    expect(selectCommissionRule([rule(), mine, rule({ kind: "COMMISSION", userId: "u2", percentage: 50 })], "u1")?.id).toBe(mine.id);
    expect(selectCommissionRule([mine], "u9")).toBeNull();
    expect(selectCommissionRule([rule({ kind: "COMMISSION", userId: "u1", percentage: 0 })], "u1")).toBeNull();
  });
});

describe("rule validation", () => {
  const ok = { name: "n", percentage: 10 };
  it("accepts a markup by percentage, by fixed amount, or both, and rejects an empty one", () => {
    expect(ruleInputSchema.safeParse(ok).success).toBe(true);
    expect(ruleInputSchema.safeParse({ name: "n", fixedAmount: 100 }).success).toBe(true);
    expect(ruleInputSchema.safeParse({ name: "n" }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ name: "n", percentage: -1 }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...ok, name: " " }).success).toBe(false);
  });
  it("commission needs a person and a percentage up to 100 and no product conditions", () => {
    expect(ruleInputSchema.safeParse({ kind: "COMMISSION", name: "c", percentage: 20, userId: "u1" }).success).toBe(true);
    expect(ruleInputSchema.safeParse({ kind: "COMMISSION", name: "c", percentage: 20 }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ kind: "COMMISSION", name: "c", percentage: 120, userId: "u1" }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ kind: "COMMISSION", name: "c", percentage: 20, userId: "u1", supplierKey: "viator" }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...ok, userId: "u1" }).success).toBe(false);
  });
});

describe("per-line markup in the price", () => {
  it("adds each line's own markup, rounded per line, and the lines add up to the total", () => {
    const p = calculatePackagePrice({
      lines: [
        { name: "A", unitCost: 100.33, quantity: 1, currency: "INR", markup: { percentage: 10 } },
        { name: "B", unitCost: 50, quantity: 2, currency: "INR", markup: { percentage: 20, fixedAmount: 5 } },
        { name: "C", unitCost: 30, quantity: 1, currency: "INR" },
      ],
    });
    expect(p.lines.map((l) => l.markup)).toEqual([10.03, 25, 0]);
    expect(p.markup).toBe(35.03);
    expect(p.subtotal).toBe(230.33);
    expect(p.total).toBe(265.36);
  });
  it("still supports the older package-level markup, on top of line markups", () => {
    const p = calculatePackagePrice({ lines: [{ name: "A", unitCost: 100, quantity: 1, currency: "INR", markup: { percentage: 10 } }], markup: { fixedAmount: 5 } });
    expect(p.markup).toBe(15);
    expect(p.lines[0].markup).toBe(10);
  });
});

describe("ledger entries", () => {
  const price = calculatePackagePrice({
    lines: [
      { name: "Safari", unitCost: 1000, quantity: 1, currency: "INR", markup: { percentage: 10 } },
      { name: "Transfer", unitCost: 40.5, quantity: 1, currency: "INR", markup: { fixedAmount: 9.5 } },
    ],
    discount: 54,
    gst: { ratePercent: 5, supply: "INTRA_STATE" },
  });
  const attrs = [
    { supplierKey: "viator", ruleId: "r-viator" },
    { supplierKey: null, ruleId: "r-fixed" },
  ];

  it("records cost, markup, discount, tax and the selling total so they add up exactly", () => {
    const drafts = quotationLedgerDrafts(price, attrs);
    const sum = (k: string) => drafts.filter((d) => d.kind === k).reduce((s, d) => s + Math.round(d.amount * 100), 0);
    expect(sum("SUPPLIER_COST")).toBe(104050);
    expect(sum("MARKUP")).toBe(10950);
    expect(sum("DISCOUNT")).toBe(-5400);
    expect(sum("SUPPLIER_COST") + sum("MARKUP") + sum("DISCOUNT") + sum("TAX")).toBe(sum("SELLING_TOTAL"));
    expect(drafts.find((d) => d.kind === "MARKUP")?.ruleId).toBe("r-viator");
    expect(drafts.find((d) => d.kind === "SUPPLIER_COST")?.supplierKey).toBe("viator");
  });

  it("records a package-level markup that no line explains, so the totals still balance", () => {
    const p = calculatePackagePrice({ lines: [{ name: "A", unitCost: 100, quantity: 1, currency: "INR", markup: { percentage: 10 } }], markup: { fixedAmount: 5 } });
    const d = quotationLedgerDrafts(p, [{ supplierKey: null, ruleId: null }]);
    expect(d.filter((x) => x.kind === "MARKUP").reduce((s, x) => s + x.amount, 0)).toBe(15);
    expect(d.some((x) => x.label === "Package markup" && x.amount === 5)).toBe(true);
  });

  it("commission is a share of the margin after discount, never negative and never more than the margin", () => {
    expect(commissionMinor(10000, 20)).toBe(2000);
    expect(commissionMinor(-500, 20)).toBe(0);
    expect(commissionMinor(10000, 0)).toBe(0);
    expect(commissionMinor(10000, 100)).toBe(10000);
    const d = quotationLedgerDrafts(price, attrs, { userId: "u1", ruleId: "c1", percentage: 20 });
    const c = d.find((x) => x.kind === "COMMISSION");
    // margin = 109.50 markup - 54 discount = 55.50; 20% = 11.10
    expect(c?.amount).toBe(11.1);
    expect(c?.userId).toBe("u1");
    expect(quotationLedgerDrafts({ ...price, discount: 500 }, attrs, { userId: "u1", ruleId: "c1", percentage: 20 }).some((x) => x.kind === "COMMISSION")).toBe(false);
  });

  it("summarises margin: tax is passed on, not profit", () => {
    const d = quotationLedgerDrafts(price, attrs, { userId: "u1", ruleId: "c1", percentage: 20 });
    const m = marginSummary(d);
    expect(m).toMatchObject({ supplierCost: 1040.5, markup: 109.5, discount: 54, grossMargin: 55.5, commission: 11.1, netMargin: 44.4 });
    expect(m?.sellingTotal).toBe(price.total);
    expect(marginSummary([])).toBeNull();
  });

  it("reversal rows cancel the originals exactly once", () => {
    const stored = quotationLedgerDrafts(price, attrs).map((d, i) => ({ id: `e${i}`, kind: d.kind, amount: d.amount, currency: d.currency, reversesId: null as string | null, label: d.label, supplierKey: d.supplierKey, ruleId: d.ruleId, userId: d.userId }));
    const rev = reversalDrafts(stored);
    expect(rev).toHaveLength(stored.length);
    expect(rev.every((r) => r.reversesId.startsWith("e"))).toBe(true);
    const after = [...stored, ...rev.map((r, i) => ({ ...r, id: `x${i}`, reversesId: r.reversesId as string | null }))];
    expect(reversalDrafts(after)).toHaveLength(0); // nothing is reversed twice
    expect(marginSummary(after)).toMatchObject({ supplierCost: 0, markup: 0, sellingTotal: 0, netMargin: 0 });
  });
});

// ---------------------------------------------------------------------------------------------
// Service with a fake tenant database
// ---------------------------------------------------------------------------------------------

function fakeCtx(opts: { role?: TenantContext["role"] } = {}) {
  const rules: Record<string, unknown>[] = [];
  const ledger: Record<string, unknown>[] = [];
  const ctxFields = { userId: "u1", tenantId: "t1" };
  const db = {
    markupSetting: {
      findMany: async () => rules.map((r) => ({ ...r })),
      findFirst: async ({ where }: { where: { id: string } }) => rules.find((r) => r.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `m${rules.length + 1}`, createdAt: new Date(), ...data };
        rules.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rules.find((x) => x.id === where.id);
        if (r) Object.assign(r, data);
        return { count: r ? 1 : 0 };
      },
      deleteMany: async ({ where }: { where: { id: string } }) => {
        const i = rules.findIndex((x) => x.id === where.id);
        if (i >= 0) rules.splice(i, 1);
        return { count: i >= 0 ? 1 : 0 };
      },
    },
    membership: { findFirst: async ({ where }: { where: { userId: string } }) => (where.userId === "u1" || where.userId === "u2" ? { id: "m" } : null), findMany: async () => [] },
    customer: { findFirst: async ({ where }: { where: { id: string } }) => (where.id === "c1" ? { id: "c1" } : null) },
    quotation: { findFirst: async ({ where }: { where: { id: string } }) => (where.id === "q1" ? { id: "q1" } : null) },
    ledgerEntry: {
      findMany: async () => ledger.map((l) => ({ ...l })),
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        data.forEach((d, i) => ledger.push({ id: `e${ledger.length + i}`, createdAt: new Date(), reversesId: null, ...d }));
        return { count: data.length };
      },
    },
  };
  const ctx = { ...ctxFields, role: opts.role ?? "OWNER", db } as unknown as TenantContext;
  return { ctx, rules, ledger };
}

describe("rule management", () => {
  it("creates, lists, edits and deletes rules inside the agency", async () => {
    const { ctx } = fakeCtx();
    const made = await createRule(ctx, { name: "Viator", percentage: 12, supplierKey: "VIATOR" });
    expect(made).toMatchObject({ name: "Viator", percentage: 12, supplierKey: "viator", kind: "MARKUP" });
    expect((await listRules(ctx)).map((r) => r.name)).toEqual(["Viator"]);
    expect((await updateRule(ctx, made.id, { name: "Viator 15", percentage: 15 })).percentage).toBe(15);
    await deleteRule(ctx, made.id);
    expect(await listRules(ctx)).toHaveLength(0);
    await expect(deleteRule(ctx, made.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateRule(ctx, "nope", { name: "x", percentage: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses commission for someone outside the agency and customers that are not its own", async () => {
    const { ctx } = fakeCtx();
    await expect(createRule(ctx, { kind: "COMMISSION", name: "c", percentage: 10, userId: "stranger" })).rejects.toBeInstanceOf(PricingRuleError);
    await expect(createRule(ctx, { name: "x", percentage: 5, customerId: "other-agency-customer" })).rejects.toBeInstanceOf(PricingRuleError);
    await expect(createRule(ctx, { kind: "COMMISSION", name: "c", percentage: 10, userId: "u2" })).resolves.toMatchObject({ kind: "COMMISSION", userId: "u2" });
    await expect(createRule(ctx, { name: "x", percentage: 5, customerId: "c1" })).resolves.toMatchObject({ customerId: "c1" });
  });

  it("reports invalid input with a readable message", async () => {
    const { ctx } = fakeCtx();
    await expect(createRule(ctx, { name: "x" })).rejects.toMatchObject({ code: "INVALID", message: expect.stringMatching(/percentage/i) });
    await expect(createRule(ctx, null)).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("ledger service", () => {
  it("returns a quotation's entries with totals, and null for a quotation that is not the agency's", async () => {
    const { ctx, ledger } = fakeCtx();
    const price = calculatePackagePrice({ lines: [{ name: "A", unitCost: 100, quantity: 1, currency: "INR", markup: { percentage: 10 } }] });
    quotationLedgerDrafts(price, [{ supplierKey: "viator", ruleId: "r1" }]).forEach((d, i) => ledger.push({ id: `e${i}`, createdAt: new Date(), reversesId: null, quotationId: "q1", ...d } as unknown as Record<string, unknown>));
    const got = await quotationLedger(ctx, "q1");
    expect(got?.summary).toMatchObject({ supplierCost: 100, markup: 10, grossMargin: 10, sellingTotal: 110 });
    expect(await quotationLedger(ctx, "someone-elses")).toBeNull();
  });

  it("reverses once and only once", async () => {
    const { ctx, ledger } = fakeCtx();
    const price = calculatePackagePrice({ lines: [{ name: "A", unitCost: 100, quantity: 1, currency: "INR", markup: { percentage: 10 } }] });
    const drafts: LedgerDraft[] = quotationLedgerDrafts(price, [{ supplierKey: null, ruleId: null }]);
    drafts.forEach((d, i) => ledger.push({ id: `e${i}`, createdAt: new Date(), reversesId: null, quotationId: "q1", ...d } as unknown as Record<string, unknown>));
    expect(await reverseQuotationLedger(ctx, "q1")).toBe(drafts.length);
    expect(await reverseQuotationLedger(ctx, "q1")).toBe(0);
    expect((await quotationLedger(ctx, "q1"))?.summary).toMatchObject({ markup: 0, sellingTotal: 0, netMargin: 0 });
  });
});

describe("creating a quotation writes the ledger with it", () => {
  it("applies the most specific rule per line, records cost/markup/commission, and the figures balance", async () => {
    const { createQuotation } = await import("@/server/quotation/service");
    const rules = [
      { id: "m1", kind: "MARKUP", name: "all", percentage: 5, fixedAmount: null, currency: "INR", supplierKey: null, productType: null, destination: null, customerId: null, userId: null, priority: 100, active: true, createdAt: new Date(2026, 0, 1) },
      { id: "m2", kind: "MARKUP", name: "viator", percentage: 20, fixedAmount: null, currency: "INR", supplierKey: "viator", productType: null, destination: null, customerId: null, userId: null, priority: 100, active: true, createdAt: new Date(2026, 0, 2) },
      { id: "m3", kind: "COMMISSION", name: "mine", percentage: 10, fixedAmount: null, currency: "INR", supplierKey: null, productType: null, destination: null, customerId: null, userId: "u1", priority: 100, active: true, createdAt: new Date(2026, 0, 3) },
    ];
    const created: { quotation?: Record<string, unknown>; ledger: Record<string, unknown>[] } = { ledger: [] };
    const tx = {
      itinerary: { create: async () => ({ id: "it1" }) },
      quotation: { create: async ({ data }: { data: Record<string, unknown> }) => (created.quotation = { id: "q9", ...data }) },
      ledgerEntry: { createMany: async ({ data }: { data: Record<string, unknown>[] }) => (created.ledger.push(...data), { count: data.length }) },
    };
    const db = {
      markupSetting: { findMany: async () => rules },
      customer: { findFirst: async () => ({ id: "c1", user: { name: "Asha", email: "a@x.test" } }) },
      companySettings: { findFirst: async () => null },
      $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    };
    const ctx = { userId: "u1", tenantId: "t1", role: "OWNER", db } as unknown as TenantContext;
    const trip = createItinerary({
      title: "T",
      destination: "Dubai",
      days: [{ title: "d", items: [
        { title: "Safari", category: "adventure", status: "LIVE", supplier: "viator", price: 1000, currency: "INR" },
        { title: "Museum", category: "museum", status: "ESTIMATE", price: 200, currency: "INR" },
      ] }],
    });
    const q = await createQuotation(ctx, trip, { discount: 0, validDays: 3 });
    // Safari: viator rule 20% = 200. Museum: only the general rule, 5% = 10.
    expect(q.price.lines.map((l) => l.markup)).toEqual([200, 10]);
    const sum = (k: string) => created.ledger.filter((e) => e.kind === k).reduce((s, e) => s + Math.round((e.amount as number) * 100), 0);
    expect(sum("SUPPLIER_COST")).toBe(120000);
    expect(sum("MARKUP")).toBe(21000);
    expect(sum("SUPPLIER_COST") + sum("MARKUP") + sum("DISCOUNT") + sum("TAX")).toBe(sum("SELLING_TOTAL"));
    expect(created.ledger.find((e) => e.kind === "MARKUP" && e.label === "Safari")).toMatchObject({ ruleId: "m2", supplierKey: "viator", tenantId: "t1", quotationId: "q9" });
    expect(sum("COMMISSION")).toBe(2100); // 10% of the 210.00 margin
    expect(q.margin).toMatchObject({ grossMargin: 210, commission: 21, netMargin: 189 });
    expect(created.quotation).toMatchObject({ markup: 210, total: 1410 });
  });
});
