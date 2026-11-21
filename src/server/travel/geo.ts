/**
 * Geo basics for the itinerary designer.
 *
 * Everything here is a straight-line ESTIMATE, not a routed journey: no maps provider is connected.
 * Callers must label results as estimates. Real routing (road distance, traffic, transit) needs a
 * maps provider and key, see DEVELOPMENT_PLAN.md.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type TravelMode = "walk" | "drive";

/** Roads are longer than the straight line; 1.3 is a common urban rule of thumb. */
const ROAD_FACTOR = 1.3;
const WALK_KMH = 4.8;
const DRIVE_KMH = 30;
/** Up to this straight-line distance the estimate assumes walking. */
const WALK_LIMIT_KM = 1.2;

export interface TravelEstimate {
  mode: TravelMode;
  straightLineKm: number;
  /** Estimated road/walking distance, rounded to 0.1 km. */
  distanceKm: number;
  minutes: number;
  /** True for straight-line guesses; false for legs routed by a maps provider. */
  estimate: boolean;
}

export function estimateTravel(a: LatLng, b: LatLng): TravelEstimate {
  const straight = haversineKm(a, b);
  const mode: TravelMode = straight <= WALK_LIMIT_KM ? "walk" : "drive";
  const distance = straight * ROAD_FACTOR;
  const speed = mode === "walk" ? WALK_KMH : DRIVE_KMH;
  return {
    mode,
    straightLineKm: Math.round(straight * 10) / 10,
    distanceKm: Math.round(distance * 10) / 10,
    minutes: Math.max(1, Math.round((distance / speed) * 60)),
    estimate: true,
  };
}

export interface Located<T> {
  value: T;
  at: LatLng;
}

/** Greedy nearest-neighbour order starting from the first element. Not optimal, but stable and cheap. */
export function nearestNeighbourOrder<T>(points: readonly Located<T>[]): Located<T>[] {
  if (points.length <= 2) return [...points];
  const remaining = points.slice(1);
  const ordered: Located<T>[] = [points[0]];
  while (remaining.length) {
    const last = ordered[ordered.length - 1].at;
    let best = 0;
    let bestKm = Infinity;
    remaining.forEach((p, i) => {
      const km = haversineKm(last, p.at);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    });
    ordered.push(remaining.splice(best, 1)[0]);
  }
  return ordered;
}

export interface RouteLeg {
  fromId: string;
  toId: string;
  travel: TravelEstimate;
  /** Where the numbers came from. */
  source: "ESTIMATE" | "MAPBOX";
}

export interface DayRoute {
  legs: RouteLeg[];
  totalKm: number;
  totalMinutes: number;
  /** Items skipped because they have no coordinates. */
  unlocated: number;
}

export function hasCoords<T extends { lat?: number; lng?: number }>(item: T): item is T & LatLng {
  return typeof item.lat === "number" && typeof item.lng === "number";
}

/** Consecutive-leg estimates for the items of one day that have coordinates. */
export function dayRoute(items: readonly { id: string; lat?: number; lng?: number }[]): DayRoute {
  const located = items.filter(hasCoords);
  const legs: RouteLeg[] = [];
  for (let i = 1; i < located.length; i++) {
    legs.push({
      fromId: located[i - 1].id,
      toId: located[i].id,
      travel: estimateTravel(located[i - 1], located[i]),
      source: "ESTIMATE",
    });
  }
  return {
    legs,
    totalKm: Math.round(legs.reduce((s, l) => s + l.travel.distanceKm, 0) * 10) / 10,
    totalMinutes: legs.reduce((s, l) => s + l.travel.minutes, 0),
    unlocated: items.length - located.length,
  };
}
