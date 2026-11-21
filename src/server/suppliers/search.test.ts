import { beforeEach, describe, expect, it, vi } from "vitest";
import { klookAdapter, yatraAdapter } from "./pending-adapters";
import { adaptersForCategory, supplierStatus } from "./registry";
import { clearSearchCache, searchInventory } from "./search";
import type { InventoryItem, SupplierAdapter } from "./types";
import { normaliseViatorActivity } from "./viator-adapter";

function item(supplier: string, id: string, over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    supplier,
    supplierItemId: id,
    category: "activity",
    title: `${supplier} ${id}`,
    description: "",
    price: { amountMinor: 1000, currency: "USD", basis: "FROM_PER_PERSON" },
    dataStatus: "LIVE",
    checkedAt: "2026-11-21T00:00:00.000Z",
    ...over,
  };
}

function fake(
  id: string,
  search: SupplierAdapter["search"],
  over: Partial<SupplierAdapter> = {}
): SupplierAdapter {
  return {
    id,
    displayName: id.toUpperCase(),
    categories: ["activity"],
    isConfigured: () => true,
    notConfiguredReason: () => "missing key",
    search,
    ...over,
  };
}

const req = { category: "activity" as const, keyword: "dubai", currency: "USD" };

beforeEach(() => clearSearchCache());

describe("searchInventory", () => {
  it("queries suppliers in parallel, not one after another", async () => {
    const slow = (id: string) =>
      fake(id, async () => {
        await new Promise((r) => setTimeout(r, 120));
        return { environment: "production", items: [item(id, "1")] };
      });
    const t0 = Date.now();
    const res = await searchInventory(req, { adapters: [slow("a"), slow("b"), slow("c")] });
    expect(Date.now() - t0).toBeLessThan(320);
    expect(res.items).toHaveLength(3);
    expect(res.suppliers.every((s) => s.status === "OK")).toBe(true);
  });

  it("a timed-out supplier does not delay or discard the others", async () => {
    const hang = fake("hang", () => new Promise(() => undefined));
    const ok = fake("ok", async () => ({ environment: "production", items: [item("ok", "1")] }));
    const res = await searchInventory(req, { adapters: [hang, ok], timeoutMs: 50 });
    expect(res.items.map((i) => i.supplier)).toEqual(["ok"]);
    expect(res.suppliers.find((s) => s.supplier === "hang")?.status).toBe("TIMEOUT");
  });

  it("isolates a throwing supplier and hides upstream error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = fake("bad", async () => {
      throw new Error("secret-token-123 upstream body");
    });
    const ok = fake("ok", async () => ({ environment: "production", items: [item("ok", "1")] }));
    const res = await searchInventory(req, { adapters: [bad, ok] });
    const badOutcome = res.suppliers.find((s) => s.supplier === "bad");
    expect(badOutcome?.status).toBe("ERROR");
    expect(JSON.stringify(badOutcome)).not.toContain("secret-token");
    expect(res.items).toHaveLength(1);
  });

  it("reports unconfigured and unsupported suppliers without calling them", async () => {
    const search = vi.fn();
    const off = fake("off", search, { isConfigured: () => false });
    const hotelsOnly = fake("hotels", search, { categories: ["hotel"] });
    const res = await searchInventory(req, { adapters: [off, hotelsOnly] });
    expect(search).not.toHaveBeenCalled();
    expect(res.suppliers.map((s) => s.status)).toEqual(["NOT_CONFIGURED", "UNSUPPORTED"]);
    expect(res.items).toEqual([]);
    expect(res.liveInventory).toBe(false);
  });

  it("returns no items, not invented ones, when every supplier is down", async () => {
    const res = await searchInventory(req, { adapters: [yatraAdapter, klookAdapter] });
    expect(res.items).toEqual([]);
    // Yatra sells hotels/flights, so for activities it is UNSUPPORTED; Klook is declared but not integrated.
    expect(res.suppliers.map((s) => s.status)).toEqual(["UNSUPPORTED", "NOT_CONFIGURED"]);
  });

  it("caches successful results briefly and can bypass the cache", async () => {
    const search = vi.fn(async () => ({ environment: "production", items: [item("c", "1")] }));
    const a = fake("c", search);
    await searchInventory(req, { adapters: [a] });
    const second = await searchInventory(req, { adapters: [a] });
    expect(search).toHaveBeenCalledTimes(1);
    expect(second.suppliers[0].cached).toBe(true);
    await searchInventory(req, { adapters: [a], useCache: false });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const search = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue({ environment: "production", items: [] });
    const a = fake("f", search);
    await searchInventory(req, { adapters: [a] });
    const res = await searchInventory(req, { adapters: [a] });
    expect(search).toHaveBeenCalledTimes(2);
    expect(res.suppliers[0].status).toBe("OK");
  });

  it("ranks by price with unpriced items last, and by rating", async () => {
    const a = fake("a", async () => ({
      environment: "production",
      items: [
        item("a", "none", { price: null, rating: 5 }),
        item("a", "dear", { price: { amountMinor: 9000, currency: "USD", basis: "TOTAL" }, rating: 3 }),
        item("a", "cheap", { price: { amountMinor: 500, currency: "USD", basis: "TOTAL" }, rating: 4 }),
      ],
    }));
    const byPrice = await searchInventory(req, { adapters: [a], sort: "price" });
    expect(byPrice.items.map((i) => i.supplierItemId)).toEqual(["cheap", "dear", "none"]);
    const byRating = await searchInventory(req, { adapters: [a], sort: "rating", useCache: false });
    expect(byRating.items.map((i) => i.supplierItemId)).toEqual(["none", "cheap", "dear"]);
  });

  it("applies a budget only to items priced in the request currency", async () => {
    const a = fake("a", async () => ({
      environment: "production",
      items: [
        item("a", "ok", { price: { amountMinor: 1000, currency: "USD", basis: "TOTAL" } }),
        item("a", "over", { price: { amountMinor: 5000, currency: "USD", basis: "TOTAL" } }),
        item("a", "eur", { price: { amountMinor: 100, currency: "EUR", basis: "TOTAL" } }),
        item("a", "unknown", { price: null }),
      ],
    }));
    const res = await searchInventory(req, { adapters: [a], maxPriceMinor: 2000 });
    expect(res.items.map((i) => i.supplierItemId)).toEqual(["ok"]);
  });

  it("interleaves suppliers for relevance and applies the limit", async () => {
    const a = fake("a", async () => ({ environment: "production", items: [item("a", "1"), item("a", "2")] }));
    const b = fake("b", async () => ({ environment: "production", items: [item("b", "1"), item("b", "2")] }));
    const res = await searchInventory({ ...req, limit: 3 }, { adapters: [a, b] });
    expect(res.items.map((i) => `${i.supplier}${i.supplierItemId}`)).toEqual(["a1", "b1", "a2"]);
  });

  it("liveInventory is false when everything returned is sandbox data", async () => {
    const a = fake("a", async () => ({
      environment: "sandbox",
      items: [item("a", "1", { dataStatus: "SANDBOX" })],
    }));
    const res = await searchInventory(req, { adapters: [a] });
    expect(res.liveInventory).toBe(false);
  });
});

describe("registry", () => {
  it("lists adapters by category and exposes no credentials in status", () => {
    expect(adaptersForCategory("activity").map((a) => a.id)).toEqual(expect.arrayContaining(["viator", "klook"]));
    expect(adaptersForCategory("hotel").map((a) => a.id)).toEqual(["yatra"]);
    const rows = supplierStatus([yatraAdapter]);
    expect(rows[0]).toMatchObject({ id: "yatra", configured: false });
    expect(rows[0].reason).toMatch(/documentation/);
  });

  it("pending adapters refuse to search", async () => {
    await expect(yatraAdapter.search(req, new AbortController().signal)).rejects.toThrow(/not implemented/);
  });
});

describe("viator normalisation", () => {
  const activity = { id: "P1", title: "Safari", description: "d", price: 20.3, currency: "USD", duration: "6h", rating: 4.5, reviews: 10 };
  it("converts to minor units and labels production LIVE", () => {
    const n = normaliseViatorActivity(activity, "production", "t");
    expect(n.price).toEqual({ amountMinor: 2030, currency: "USD", basis: "FROM_PER_PERSON" });
    expect(n.dataStatus).toBe("LIVE");
  });
  it("labels sandbox data SANDBOX and treats a missing price as unknown, not zero", () => {
    expect(normaliseViatorActivity(activity, "sandbox", "t").dataStatus).toBe("SANDBOX");
    expect(normaliseViatorActivity({ ...activity, price: 0 }, "production", "t").price).toBeNull();
  });
});
