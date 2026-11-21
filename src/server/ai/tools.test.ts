import { describe, expect, it, vi } from "vitest";
import { emptyState, executeTool, getToolSpecs, TOOLS, type ToolContext } from "./tools";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    tenantId: "t1",
    userId: "u1",
    role: "CONSULTANT",
    conversationId: "c1",
    db: {
      markupSetting: { findFirst: vi.fn().mockResolvedValue({ percentage: "10", fixedAmount: null }) },
    } as unknown as ToolContext["db"],
    state: emptyState(),
    ...overrides,
  };
}

const spec = {
  title: "Dubai",
  destination: "Dubai",
  startDate: "2026-12-15",
  days: [
    { title: "Arrival", items: [{ title: "Transfer", category: "transfer", status: "ESTIMATE" }] },
    { title: "Safari", items: [{ title: "Desert safari", category: "adventure", status: "UNVERIFIED" }] },
  ],
};

describe("tool registry", () => {
  it("exposes the 20 spec tools with JSON schemas", () => {
    const names = getToolSpecs().map((t) => t.name);
    for (const required of [
      "extract_travel_requirements", "search_destinations", "search_hotels", "search_flights", "search_activities",
      "search_transfers", "compare_inventory", "check_availability", "get_product_details", "calculate_package_price",
      "create_itinerary", "optimize_itinerary", "modify_itinerary", "create_quotation", "verify_inventory",
      "create_booking", "check_booking_status", "process_payment", "generate_voucher", "send_travel_documents",
    ]) {
      expect(names).toContain(required);
    }
    expect(new Set(names).size).toBe(TOOLS.length);
    for (const t of getToolSpecs()) expect(t.inputSchema).not.toHaveProperty("$schema");
  });

  it("booking, payment and supplier tools without an integration return NOT_CONFIGURED, never data", async () => {
    for (const name of ["create_booking", "process_payment", "generate_voucher", "search_hotels", "search_flights"]) {
      const r = await executeTool(name, {}, makeCtx());
      expect(r.ok).toBe(true);
      expect(r.ok && r.result).toMatchObject({ error: "NOT_CONFIGURED" });
    }
  });

  it("rejects unknown tools and invalid input", async () => {
    expect(await executeTool("nope", {}, makeCtx())).toMatchObject({ ok: false });
    const bad = await executeTool("check_availability", { productCode: "X", date: "tomorrow", adults: 2 }, makeCtx());
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.error).toContain("date");
  });

  it("enforces role permissions on write tools", async () => {
    const r = await executeTool("create_itinerary", spec, makeCtx({ role: "READONLY" }));
    expect(r).toMatchObject({ ok: false });
  });
});

describe("itinerary tools", () => {
  it("create then modify only changes the targeted day", async () => {
    const ctx = makeCtx();
    await executeTool("create_itinerary", spec, ctx);
    const before = ctx.state.itinerary!;
    const safari = before.days[1].items[0];

    const r = await executeTool("modify_itinerary", { patches: [{ op: "remove_item", itemId: safari.id }] }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.state.itinerary!.days[1].items).toHaveLength(0);
    expect(ctx.state.itinerary!.days[0]).toBe(before.days[0]);
  });

  it("a failing patch batch leaves the itinerary unchanged", async () => {
    const ctx = makeCtx();
    await executeTool("create_itinerary", spec, ctx);
    const snapshot = JSON.stringify(ctx.state.itinerary);
    const r = await executeTool(
      "modify_itinerary",
      { patches: [{ op: "add_day", title: "Extra" }, { op: "remove_item", itemId: "missing" }] },
      ctx
    );
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(ctx.state.itinerary)).toBe(snapshot);
  });

  it("modify without an itinerary asks to create one", async () => {
    const r = await executeTool("modify_itinerary", { patches: [{ op: "add_day", title: "x" }] }, makeCtx());
    expect(r).toMatchObject({ ok: true, result: { error: "NO_ITINERARY" } });
  });
});

describe("calculate_package_price", () => {
  const input = { lines: [{ name: "Hotel", unitCost: 1000, quantity: 2, currency: "inr" }], taxPercent: 18 };

  it("shows cost breakdown only to roles that may see it", async () => {
    const manager = await executeTool("calculate_package_price", input, makeCtx({ role: "MANAGER" }));
    expect(manager.ok && manager.result).toMatchObject({ subtotal: 2000, markup: 200, taxes: 396, total: 2596 });

    const consultant = await executeTool("calculate_package_price", input, makeCtx({ role: "CONSULTANT" }));
    expect(consultant.ok && consultant.result).toEqual({ currency: "INR", discount: 0, taxes: 396, total: 2596 });
  });

  it("reports mixed currencies as a pricing error", async () => {
    const r = await executeTool(
      "calculate_package_price",
      { lines: [{ name: "a", unitCost: 1, currency: "INR" }, { name: "b", unitCost: 1, currency: "USD" }] },
      makeCtx()
    );
    expect(r.ok && r.result).toMatchObject({ error: "PRICING_ERROR" });
  });
});

describe("supplier tools", () => {
  it("returns SUPPLIER_NOT_CONFIGURED when Viator credentials are missing", async () => {
    const saved = { ...process.env };
    delete process.env.VIATOR_SANDBOX_KEY;
    delete process.env.VIATOR_PRODUCTION_KEY;
    try {
      const r = await executeTool("search_activities", { keyword: "Dubai safari" }, makeCtx());
      expect(r.ok && r.result).toMatchObject({ ok: false, error: expect.stringMatching(/SUPPLIER_/) });
    } finally {
      process.env = saved;
    }
  });
});
