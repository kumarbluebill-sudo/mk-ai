import { describe, expect, it } from "vitest";
import { dayRoute, estimateTravel, haversineKm, nearestNeighbourOrder } from "./geo";
import { applyPatch, createItinerary, ItineraryError, type Itinerary } from "./itinerary";

const burj = { lat: 25.1972, lng: 55.2744 };
const mall = { lat: 25.1985, lng: 55.2796 }; // ~0.6 km
const marina = { lat: 25.0805, lng: 55.1403 }; // ~19 km
const palm = { lat: 25.1124, lng: 55.1390 };

describe("geo estimates", () => {
  it("haversine matches known distances", () => {
    // London -> Paris is about 344 km.
    expect(haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 })).toBeCloseTo(343.6, 0);
    expect(haversineKm(burj, burj)).toBe(0);
  });

  it("walks short hops, drives long ones, and always flags an estimate", () => {
    const short = estimateTravel(burj, mall);
    expect(short.mode).toBe("walk");
    const long = estimateTravel(burj, marina);
    expect(long.mode).toBe("drive");
    expect(long.distanceKm).toBeGreaterThan(long.straightLineKm);
    expect(long.minutes).toBeGreaterThan(short.minutes);
    expect(short.estimate && long.estimate).toBe(true);
  });

  it("dayRoute skips items without coordinates and reports how many", () => {
    const r = dayRoute([
      { id: "a", ...burj },
      { id: "b" },
      { id: "c", ...marina },
    ]);
    expect(r.unlocated).toBe(1);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]).toMatchObject({ fromId: "a", toId: "c" });
    expect(r.totalKm).toBe(r.legs[0].travel.distanceKm);
  });

  it("nearest neighbour keeps the start and shortens a zig-zag", () => {
    const pts = [burj, marina, mall, palm].map((at, i) => ({ value: i, at }));
    const out = nearestNeighbourOrder(pts).map((p) => p.value);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(2); // the mall is next to the Burj
    const length = (order: number[]) =>
      order.slice(1).reduce((s, v, i) => s + haversineKm(pts[order[i]].at, pts[v].at), 0);
    expect(length(out)).toBeLessThan(length([0, 1, 2, 3]));
  });
});

function trip(): Itinerary {
  return createItinerary({
    title: "t",
    destination: "Dubai",
    days: [
      { title: "d1", items: [
        { title: "A", category: "sightseeing", status: "UNVERIFIED", ...burj },
        { title: "B", category: "sightseeing", status: "UNVERIFIED", ...marina },
        { title: "no coords", category: "other", status: "UNVERIFIED" },
        { title: "C", category: "sightseeing", status: "UNVERIFIED", ...mall },
        { title: "D", category: "sightseeing", status: "UNVERIFIED", ...palm },
      ] },
      { title: "d2", items: [{ title: "E", category: "other", status: "UNVERIFIED" }] },
    ],
  });
}
const titles = (it: Itinerary, day: number) => it.days[day - 1].items.map((i) => i.title);

describe("itinerary move_item / optimize_day", () => {
  it("moves within a day and across days without touching other items", () => {
    const it = trip();
    const idB = it.days[0].items[1].id;
    const within = applyPatch(it, { op: "move_item", itemId: idB, toDay: 1, position: 0 });
    expect(titles(within, 1)).toEqual(["B", "A", "no coords", "C", "D"]);
    const across = applyPatch(it, { op: "move_item", itemId: idB, toDay: 2 });
    expect(titles(across, 1)).toEqual(["A", "no coords", "C", "D"]);
    expect(titles(across, 2)).toEqual(["E", "B"]);
    expect(titles(it, 1)).toHaveLength(5); // original untouched
  });

  it("rejects unknown items and days", () => {
    const it = trip();
    expect(() => applyPatch(it, { op: "move_item", itemId: "nope", toDay: 1 })).toThrow(ItineraryError);
    expect(() => applyPatch(it, { op: "move_item", itemId: it.days[0].items[0].id, toDay: 9 })).toThrow(ItineraryError);
    expect(() => applyPatch(it, { op: "optimize_day", day: 9 })).toThrow(ItineraryError);
  });

  it("optimize_day re-orders located items only; unlocated keep their slot; first stays first", () => {
    const out = applyPatch(trip(), { op: "optimize_day", day: 1 });
    expect(titles(out, 1)[2]).toBe("no coords");
    expect(titles(out, 1)[0]).toBe("A");
    expect(titles(out, 1)[1]).toBe("C"); // mall is nearest to the Burj
    expect([...titles(out, 1)].sort()).toEqual(["A", "B", "C", "D", "no coords"]);
    const before = dayRoute(trip().days[0].items).totalKm;
    expect(dayRoute(out.days[0].items).totalKm).toBeLessThan(before);
  });

  it("reorder_day applies exactly the given order to located items and keeps unlocated slots", () => {
    const it = trip();
    const [a, , nc, c, d] = it.days[0].items;
    const b = it.days[0].items[1];
    const out = applyPatch(it, { op: "reorder_day", day: 1, itemIds: [a.id, d.id, c.id, b.id] });
    expect(titles(out, 1)).toEqual(["A", "D", "no coords", "C", "B"]);
    expect(nc.title).toBe("no coords");
  });

  it("reorder_day refuses lists that add, drop, repeat or invent stops", () => {
    const it = trip();
    const ids = it.days[0].items.filter((x) => x.lat !== undefined).map((x) => x.id);
    const bad = [ids.slice(1), [...ids, "ghost"], [ids[0], ids[0], ids[1], ids[2]], [...ids.slice(0, 3), it.days[0].items[2].id]];
    for (const itemIds of bad) expect(() => applyPatch(it, { op: "reorder_day", day: 1, itemIds })).toThrow(ItineraryError);
    expect(() => applyPatch(it, { op: "reorder_day", day: 9, itemIds: ids })).toThrow(ItineraryError);
  });

  it("optimize_day does nothing with fewer than three located items", () => {
    const it = trip();
    expect(applyPatch(it, { op: "optimize_day", day: 2 })).toBe(it);
  });
});
