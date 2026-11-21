import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTravelDeskClient, TravelDeskClient, TravelDeskError } from "@/integrations/traveldesk/client";
import { clearTravelDeskCatalogueCache, currentFromPriceUsd, mentionsUae, normaliseTour, traveldeskAdapter } from "./traveldesk-adapter";
import { checkTravelDeskAvailability, minutesToClock, slotFromRow } from "./traveldesk-availability";

const tours = [
  {
    id: 30,
    name: "Desert Safari in Dubai with BBQ Dinner",
    language: "English",
    categories: [{ name: "Adventure" }],
    totalRating: 4.7,
    totalRatingsCount: 900,
    heroImage: { srcSet: [{ type: "image/webp", sizes: [{ src: "https://img/fhd.webp", width: 1920 }, { src: "https://img/sd.webp", width: 640 }] }] },
  },
  { id: 5, name: "Dinner Cruise in Dubai Marina", language: "English", categories: [{ name: "Lunch & Dinner Related" }], totalRating: 4.6, totalRatingsCount: 2946 },
  { id: 23, name: "Russian language safari", language: "Russian", categories: [] },
];
const offers = [
  {
    id: 186,
    name: "Safari sharing",
    tourId: 30,
    prices: [
      { dateStart: "2015-01-01T00:00:00", dateEnd: "2099-01-01T00:00:00", pricePerAdultUsd: 44 },
      { dateStart: "2015-01-01T00:00:00", dateEnd: "2099-01-01T00:00:00", pricePerAdultUsd: 60 },
    ],
  },
  { id: 187, name: "Safari private", tourId: 30, prices: [{ dateStart: "2015-01-01T00:00:00", dateEnd: "2016-01-01T00:00:00", pricePerAdultUsd: 5 }] },
  { id: 9, name: "Cruise", tourId: 5, prices: [] },
];

function mockFetch(routes: Record<string, unknown>, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      const u = new URL(url.toString());
      calls.push(u.pathname + u.search);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      const key = Object.keys(routes).find((k) => u.pathname.endsWith(k));
      return new Response(JSON.stringify(key ? routes[key] : {}), { status: key ? status : 404 });
    })
  );
  return calls;
}

beforeEach(() => {
  process.env.TRAVELDESK_API_KEY = "test-key";
  delete process.env.TRAVELDESK_API_ENV;
  resetTravelDeskClient();
  clearTravelDeskCatalogueCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRAVELDESK_API_KEY;
});

const signal = () => new AbortController().signal;
const req = (keyword: string, currency = "USD") => ({ category: "activity" as const, keyword, currency });

describe("TravelDeskClient", () => {
  it("requires a key and treats anything but production as sandbox", () => {
    expect(() => new TravelDeskClient({})).toThrow(TravelDeskError);
    expect(new TravelDeskClient({ TRAVELDESK_API_KEY: "k" }).environment).toBe("sandbox");
    expect(new TravelDeskClient({ TRAVELDESK_API_KEY: "k", TRAVELDESK_API_ENV: "production" }).environment).toBe("production");
  });

  it("maps auth failures to a generic message and never leaks the key", async () => {
    mockFetch({ "/tours": { message: "nope test-key" } }, 401);
    const err = await new TravelDeskClient({ TRAVELDESK_API_KEY: "test-key" }).tours().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TravelDeskError);
    expect((err as TravelDeskError).message).toBe("Traveldesk rejected the API key");
    expect(JSON.stringify(err)).not.toContain("test-key");
  });

  it("rejects an unexpected response shape instead of passing garbage on", async () => {
    mockFetch({ "/tours": { not: "an array" } });
    await expect(new TravelDeskClient({ TRAVELDESK_API_KEY: "test-key" }).tours()).rejects.toThrow(/unexpected response/);
  });
});

describe("pricing helpers", () => {
  const now = new Date("2026-11-21T10:00:00Z");
  it("picks the cheapest price among periods covering today and ignores expired ones", () => {
    expect(currentFromPriceUsd(offers, 30, now)).toBe(44);
    expect(currentFromPriceUsd(offers, 5, now)).toBeNull();
  });
  it("labels test data SANDBOX and prices in minor units", () => {
    const item = normaliseTour(tours[0] as never, offers as never, "sandbox", "t", now);
    expect(item.dataStatus).toBe("SANDBOX");
    expect(item.price).toEqual({ amountMinor: 4400, currency: "USD", basis: "FROM_PER_PERSON" });
    expect(item.imageUrl).toBe("https://img/sd.webp");
    expect(normaliseTour(tours[0] as never, offers as never, "production", "t", now).dataStatus).toBe("LIVE");
  });
  it("copes with null category names, as the real API returns them", () => {
    const odd = { ...tours[0], categories: [{ name: null }, { name: "Adventure" }] };
    const item = normaliseTour(odd as never, offers as never, "sandbox", "t", now);
    expect(item.description).toBe("Adventure");
  });
  it("detects UAE places", () => {
    expect(mentionsUae("Desert safari Dubai")).toBe(true);
    expect(mentionsUae("Goa beach")).toBe(false);
  });
});

describe("traveldeskAdapter.search", () => {
  it("returns nothing, with an explanation, for non-UAE searches", async () => {
    const calls = mockFetch({});
    const r = await traveldeskAdapter.search(req("Goa safari"), signal());
    expect(r.items).toEqual([]);
    expect(r.note).toMatch(/UAE only/);
    expect(calls).toEqual([]); // no supplier call at all
  });

  it("matches keywords, skips non-English tours and ranks by token score then rating", async () => {
    mockFetch({ "/tours": tours, "/offers": offers });
    const r = await traveldeskAdapter.search(req("dubai dinner safari"), signal());
    expect(r.items.map((i) => i.supplierItemId)).toEqual(["30", "5"]); // 30 matches dinner+safari, 5 dinner only
    expect(r.items.every((i) => i.supplier === "traveldesk" && i.dataStatus === "SANDBOX")).toBe(true);
  });

  it("a bare city search lists every English tour, best rated first", async () => {
    mockFetch({ "/tours": tours, "/offers": offers });
    const r = await traveldeskAdapter.search(req("things to do in dubai"), signal());
    expect(r.items.map((i) => i.supplierItemId)).toEqual(["30", "5"]);
  });

  it("notes that prices are USD when another currency was asked for", async () => {
    mockFetch({ "/tours": tours, "/offers": offers });
    const r = await traveldeskAdapter.search(req("dubai safari", "EUR"), signal());
    expect(r.note).toMatch(/USD/);
    expect(r.items[0].price?.currency).toBe("USD");
  });

  it("caches the catalogue between searches", async () => {
    const calls = mockFetch({ "/tours": tours, "/offers": offers });
    await traveldeskAdapter.search(req("dubai safari"), signal());
    await traveldeskAdapter.search(req("dubai cruise"), signal());
    expect(calls.filter((c) => c.startsWith("/public/b2b/v1/tours")).length).toBe(1);
  });
});

describe("availability", () => {
  const details = {
    id: 30,
    name: "Desert Safari",
    offers: [{ id: 186, name: "Sharing", minNumberOfAdult: 1, maxNumberOfAdult: 10, maxNumberOfChild: 5 }],
    cancellationPolicy: [{ hours: 24, percents: 50 }],
  };
  const row = (over: Record<string, unknown> = {}, price: Record<string, unknown> = {}) => ({
    availability: { date: "2026-12-15T00:00:00", startTime: 900, endTime: 1320, left: 100, ...over },
    price: { currency: "USD", pricePerAdult: 44, pricePerChild: 28, pricePerTrip: 0, isBookable: true, vat: 5, ...price },
  });

  it("converts minutes to clock times", () => {
    expect(minutesToClock(900)).toBe("15:00");
    expect(minutesToClock(1320)).toBe("22:00");
    expect(minutesToClock(null)).toBeNull();
  });

  it("computes the total from unit prices and reports seats left", () => {
    const slot = slotFromRow(row() as never, { adults: 2, children: 1 }, true);
    expect(slot).toMatchObject({ startTime: "15:00", endTime: "22:00", available: true, left: 100, total: 116, totalBasis: "COMPUTED_FROM_UNIT_PRICES", currency: "USD" });
  });

  it("is unavailable when too few seats are left, not bookable, or outside pax limits", () => {
    expect(slotFromRow(row({ left: 2 }) as never, { adults: 2, children: 1 }, true).available).toBe(false);
    expect(slotFromRow(row({}, { isBookable: false }) as never, { adults: 1, children: 0 }, true).available).toBe(false);
    expect(slotFromRow(row() as never, { adults: 1, children: 0 }, false).available).toBe(false);
  });

  it("uses the per-trip price when the supplier sells by trip", () => {
    const slot = slotFromRow(row({}, { pricePerAdult: 0, pricePerChild: 0, pricePerTrip: 500 }) as never, { adults: 3, children: 0 }, true);
    expect(slot).toMatchObject({ total: 500, totalBasis: "PER_TRIP" });
  });

  it("has no total (and is not available) when the price is unknown", () => {
    const slot = slotFromRow({ availability: { date: "2026-12-15T00:00:00", left: 5 }, price: null } as never, { adults: 1, children: 0 }, true);
    expect(slot).toMatchObject({ total: null, available: false });
  });

  it("parses a real-shaped tour details response with null names and null pax limits", async () => {
    mockFetch({
      "/tours/30": { ...details, categories: [{ name: null, id: 8 }], offers: [{ id: 186, name: "Sharing", numberOfHours: 7, minNumberOfAdult: null, maxNumberOfAdult: null, maxNumberOfChild: null }] },
      "/availability/byoffer": [row()],
    });
    const client = new TravelDeskClient({ TRAVELDESK_API_KEY: "test-key" });
    const r = await checkTravelDeskAvailability(client, { tourId: 30, date: "2026-12-15", adults: 2, children: 0 });
    expect(r.offers[0].withinPaxLimits).toBe(true);
    expect(r.offers[0].slots[0].available).toBe(true);
  });

  it("checks pax limits per offer and only returns slots for the requested date", async () => {
    mockFetch({
      "/tours/30": details,
      "/availability/byoffer": [row(), row({ date: "2026-12-16T00:00:00" })],
    });
    const client = new TravelDeskClient({ TRAVELDESK_API_KEY: "test-key" });
    const ok = await checkTravelDeskAvailability(client, { tourId: 30, date: "2026-12-15", adults: 2, children: 1 });
    expect(ok.environment).toBe("sandbox");
    expect(ok.offers[0].slots).toHaveLength(1);
    expect(ok.offers[0].withinPaxLimits).toBe(true);
    expect(ok.cancellationPolicyRaw).toEqual([{ hours: 24, percents: 50 }]);
    const tooMany = await checkTravelDeskAvailability(client, { tourId: 30, date: "2026-12-15", adults: 11, children: 0 });
    expect(tooMany.offers[0].withinPaxLimits).toBe(false);
    expect(tooMany.offers[0].slots[0].available).toBe(false);
  });
});
