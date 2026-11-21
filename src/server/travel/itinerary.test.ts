import { describe, expect, it } from "vitest";
import { applyPatch, createItinerary, ItineraryError } from "./itinerary";

function sample() {
  return createItinerary({
    title: "Dubai 3 days",
    destination: "Dubai",
    startDate: "2026-12-15",
    days: [
      { title: "Arrival", items: [{ title: "Airport transfer", category: "transfer", status: "ESTIMATE" }] },
      { title: "City tour", items: [{ title: "Burj Khalifa", category: "sightseeing", status: "UNVERIFIED" }] },
      { title: "Desert safari", items: [{ title: "Safari", category: "adventure", status: "UNVERIFIED" }] },
    ],
  });
}

describe("itinerary", () => {
  it("assigns day numbers and consecutive dates", () => {
    const it = sample();
    expect(it.days.map((d) => d.dayNumber)).toEqual([1, 2, 3]);
    expect(it.days.map((d) => d.date)).toEqual(["2026-12-15", "2026-12-16", "2026-12-17"]);
  });

  it("removing an item leaves other days untouched (same references)", () => {
    const it = sample();
    const safari = it.days[2].items[0];
    const next = applyPatch(it, { op: "remove_item", itemId: safari.id });
    expect(next.days[2].items).toHaveLength(0);
    expect(next.days[0]).toBe(it.days[0]);
    expect(next.days[1]).toBe(it.days[1]);
  });

  it("replaces an item but keeps its id", () => {
    const it = sample();
    const target = it.days[1].items[0];
    const next = applyPatch(it, {
      op: "replace_item",
      itemId: target.id,
      item: { title: "Dubai Frame", category: "sightseeing", status: "UNVERIFIED" },
    });
    expect(next.days[1].items[0]).toMatchObject({ id: target.id, title: "Dubai Frame" });
  });

  it("removing a day renumbers and re-dates the rest", () => {
    const next = applyPatch(sample(), { op: "remove_day", day: 2 });
    expect(next.days.map((d) => [d.dayNumber, d.date])).toEqual([
      [1, "2026-12-15"],
      [2, "2026-12-16"],
    ]);
    expect(next.days[1].title).toBe("Desert safari");
  });

  it("adds a day at the end", () => {
    const next = applyPatch(sample(), { op: "add_day", title: "Departure" });
    expect(next.days).toHaveLength(4);
    expect(next.days[3]).toMatchObject({ dayNumber: 4, date: "2026-12-18" });
  });

  it("rejects unknown days and items, and removing the last day", () => {
    const it = sample();
    expect(() => applyPatch(it, { op: "set_day_title", day: 9, title: "x" })).toThrow(ItineraryError);
    expect(() => applyPatch(it, { op: "remove_item", itemId: "nope" })).toThrow(ItineraryError);
    const one = createItinerary({ title: "t", destination: "d", days: [{ title: "only", items: [] }] });
    expect(() => applyPatch(one, { op: "remove_day", day: 1 })).toThrow(ItineraryError);
  });

  it("does not mutate the input", () => {
    const it = sample();
    const snapshot = JSON.stringify(it);
    applyPatch(it, { op: "add_item", day: 1, item: { title: "Dinner", category: "restaurant", status: "UNVERIFIED" } });
    expect(JSON.stringify(it)).toBe(snapshot);
  });
});
