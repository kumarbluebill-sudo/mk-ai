import type { DayRoute, RouteLeg } from "@/server/travel/geo";
import { hasCoords } from "@/server/travel/geo";
import type { Itinerary } from "@/server/travel/itinerary";
import { drivingLegs, MAX_DIRECTIONS_POINTS, straightLineKm, type DrivingLeg } from "./mapbox";

export interface RoutedDays {
  /** Days that were routed by the maps provider. Days not listed keep their straight-line estimates. */
  routes: Record<number, DayRoute>;
  /** Day numbers that had enough stops but could not be routed (provider error, too many stops, no route). */
  failedDays: number[];
}

/**
 * Real driving legs between the located stops of each day, in the order they are planned.
 * Days are routed in parallel; one failing day never hides the others.
 */
export async function routeDays(
  itinerary: Itinerary,
  legsFn: (points: { lat: number; lng: number }[]) => Promise<DrivingLeg[]> = (p) => drivingLegs(p)
): Promise<RoutedDays> {
  const routes: Record<number, DayRoute> = {};
  const failedDays: number[] = [];

  await Promise.all(
    itinerary.days.map(async (day) => {
      const located = day.items.filter(hasCoords);
      if (located.length < 2) return;
      if (located.length > MAX_DIRECTIONS_POINTS) {
        failedDays.push(day.dayNumber);
        return;
      }
      try {
        const legs = await legsFn(located.map((i) => ({ lat: i.lat, lng: i.lng })));
        const routed: RouteLeg[] = legs.map((leg, i) => ({
          fromId: located[i].id,
          toId: located[i + 1].id,
          source: "MAPBOX",
          travel: {
            mode: "drive",
            straightLineKm: straightLineKm(located[i], located[i + 1]),
            distanceKm: leg.distanceKm,
            minutes: leg.minutes,
            estimate: false,
          },
        }));
        routes[day.dayNumber] = {
          legs: routed,
          totalKm: Math.round(routed.reduce((s, l) => s + l.travel.distanceKm, 0) * 10) / 10,
          totalMinutes: routed.reduce((s, l) => s + l.travel.minutes, 0),
          unlocated: day.items.length - located.length,
        };
      } catch {
        failedDays.push(day.dayNumber);
      }
    })
  );

  return { routes, failedDays: failedDays.sort((a, b) => a - b) };
}
