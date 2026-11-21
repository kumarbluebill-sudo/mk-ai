import { afterEach, describe, expect, it, vi } from "vitest";
import { createItinerary } from "@/server/travel/itinerary";
import { drivingLegs, geocode, isMapboxConfigured, MapboxError, publicMapToken } from "./mapbox";
import { routeDays } from "./routing";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: URL) => Response) {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      const u = new URL(url.toString());
      urls.push(u);
      return handler(u);
    })
  );
  return urls;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const env = { MAPBOX_API_KEY: "pk.test-token" };

describe("token handling", () => {
  it("only ever hands a public (pk.) token to the browser", () => {
    expect(publicMapToken({ MAPBOX_API_KEY: "pk.abc" })).toBe("pk.abc");
    expect(publicMapToken({ MAPBOX_API_KEY: "sk.secret" })).toBeNull();
    expect(publicMapToken({})).toBeNull();
    expect(isMapboxConfigured({ MAPBOX_API_KEY: "sk.secret" })).toBe(true);
  });
});

describe("geocode", () => {
  const body = {
    features: [
      { properties: { name: "Dubai Frame", full_address: "Dubai Frame, Dubai, UAE", feature_type: "poi" }, geometry: { coordinates: [55.3009, 25.2349] } },
      { properties: { name_preferred: "Preferred", place_formatted: "Somewhere" }, geometry: { coordinates: [1, 2] } },
    ],
  };

  it("returns candidates with lat/lng in the right order", async () => {
    stubFetch(() => json(body));
    const r = await geocode("Dubai Frame", { country: "ae" }, env);
    expect(r[0]).toEqual({ name: "Dubai Frame", address: "Dubai Frame, Dubai, UAE", type: "poi", lat: 25.2349, lng: 55.3009 });
    expect(r[1]).toMatchObject({ name: "Preferred", address: "Somewhere", lat: 2, lng: 1 });
  });

  it("uses the Search Box API (which has tourist places) with country, proximity, language and a capped limit", async () => {
    const urls = stubFetch(() => json(body));
    await geocode("frame", { country: "ae", near: { lat: 25.2, lng: 55.27 }, limit: 50 }, env);
    expect(urls[0].pathname).toBe("/search/searchbox/v1/forward");
    expect(urls[0].searchParams.get("country")).toBe("ae");
    expect(urls[0].searchParams.get("proximity")).toBe("55.27,25.2");
    expect(urls[0].searchParams.get("limit")).toBe("10");
    expect(urls[0].searchParams.get("language")).toBe("en");
    // Search Box rejects unknown parameters, so nothing speculative may be sent.
    expect(urls[0].searchParams.has("permanent")).toBe(false);
  });

  it("does not call Mapbox for tiny queries or without a token", async () => {
    const urls = stubFetch(() => json(body));
    expect(await geocode("a", {}, env)).toEqual([]);
    await expect(geocode("dubai", {}, {})).rejects.toThrow(/not configured/);
    expect(urls).toHaveLength(0);
  });

  it("never leaks the token in errors", async () => {
    stubFetch(() => json({ message: "bad" }, 401));
    const err = await geocode("dubai", {}, env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MapboxError);
    expect((err as MapboxError).message).toBe("Mapbox rejected the access token");
    expect(JSON.stringify(err)).not.toContain("pk.test-token");
    stubFetch(() => json({}, 429));
    expect(((await geocode("dubai", {}, env).catch((e: unknown) => e)) as MapboxError).status).toBe(429);
  });

  it("rejects an unexpected response shape", async () => {
    stubFetch(() => json({ nope: true }));
    await expect(geocode("dubai", {}, env)).rejects.toThrow(/unexpected response/);
  });
});

describe("drivingLegs", () => {
  it("returns one leg per consecutive pair, in km and minutes", async () => {
    const urls = stubFetch(() => json({ routes: [{ legs: [{ distance: 1300, duration: 290 }, { distance: 22000, duration: 1260 }] }] }));
    const legs = await drivingLegs([{ lat: 25.1972, lng: 55.2744 }, { lat: 25.1985, lng: 55.2796 }, { lat: 25.0805, lng: 55.1403 }], env);
    expect(legs).toEqual([{ distanceKm: 1.3, minutes: 5 }, { distanceKm: 22, minutes: 21 }]);
    expect(urls[0].pathname).toContain("55.274400,25.197200;55.279600,25.198500;55.140300,25.080500");
    expect(urls[0].searchParams.get("overview")).toBe("false");
  });

  it("skips the call for fewer than two points and refuses more than 25", async () => {
    const urls = stubFetch(() => json({}));
    expect(await drivingLegs([{ lat: 1, lng: 1 }], env)).toEqual([]);
    expect(urls).toHaveLength(0);
    const many = Array.from({ length: 26 }, (_, i) => ({ lat: i / 10, lng: i / 10 }));
    await expect(drivingLegs(many, env)).rejects.toThrow(/Too many stops/);
  });

  it("fails clearly when there is no route or the leg count is wrong", async () => {
    stubFetch(() => json({ routes: [] }));
    await expect(drivingLegs([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], env)).rejects.toThrow(/No route/);
    stubFetch(() => json({ routes: [{ legs: [{ distance: 1, duration: 1 }] }] }));
    await expect(drivingLegs([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }], env)).rejects.toThrow(/unexpected number/);
  });
});

describe("routeDays", () => {
  const trip = createItinerary({
    title: "t",
    destination: "Dubai",
    days: [
      { title: "d1", items: [
        { title: "A", category: "sightseeing", status: "UNVERIFIED", lat: 25.1972, lng: 55.2744 },
        { title: "no coords", category: "other", status: "UNVERIFIED" },
        { title: "B", category: "sightseeing", status: "UNVERIFIED", lat: 25.0805, lng: 55.1403 },
      ] },
      { title: "d2", items: [{ title: "only one", category: "other", status: "UNVERIFIED", lat: 1, lng: 1 }] },
      { title: "d3", items: [
        { title: "C", category: "other", status: "UNVERIFIED", lat: 1, lng: 1 },
        { title: "D", category: "other", status: "UNVERIFIED", lat: 2, lng: 2 },
      ] },
    ],
  });

  it("routes only days with two or more located stops, labelled MAPBOX and not as estimates", async () => {
    const calls: number[] = [];
    const r = await routeDays(trip, async (pts) => {
      calls.push(pts.length);
      return pts.slice(1).map(() => ({ distanceKm: 20, minutes: 25 }));
    });
    expect(calls.sort()).toEqual([2, 2]);
    expect(Object.keys(r.routes)).toEqual(["1", "3"]);
    const leg = r.routes[1].legs[0];
    expect(leg).toMatchObject({ source: "MAPBOX", travel: { mode: "drive", distanceKm: 20, minutes: 25, estimate: false } });
    expect(leg.fromId).toBe(trip.days[0].items[0].id);
    expect(leg.toId).toBe(trip.days[0].items[2].id); // the unlocated item is skipped
    expect(r.routes[1].unlocated).toBe(1);
    expect(r.routes[1].totalKm).toBe(20);
  });

  it("one failing day does not hide the others", async () => {
    let n = 0;
    const r = await routeDays(trip, async (pts) => {
      if (n++ === 0) throw new MapboxError("boom");
      return pts.slice(1).map(() => ({ distanceKm: 1, minutes: 1 }));
    });
    expect(r.failedDays).toHaveLength(1);
    expect(Object.keys(r.routes)).toHaveLength(1);
  });

  it("reports a day with more than 25 stops as failed instead of calling the API", async () => {
    const big = createItinerary({
      title: "big",
      destination: "x",
      days: [{ title: "d", items: Array.from({ length: 26 }, (_, i) => ({ title: `s${i}`, category: "other" as const, status: "UNVERIFIED" as const, lat: i / 100, lng: i / 100 })) }],
    });
    const fn = vi.fn(async () => []);
    const r = await routeDays(big, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(r.failedDays).toEqual([1]);
  });
});
