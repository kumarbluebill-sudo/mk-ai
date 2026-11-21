import { z } from "zod";
import { haversineKm, type LatLng } from "@/server/travel/geo";

/**
 * Mapbox: place search (Search Box API, which covers tourist places; Geocoding v6 does not) and
 * driving legs (Directions v5).
 *
 * Terms notes that shape this module:
 *  - Mapbox results must be shown on a Mapbox map, so the designer switches to Mapbox tiles whenever
 *    this module is configured (see publicMapToken).
 *  - Coordinates a user picks from search are saved in the itinerary. Whether Mapbox's terms allow
 *    keeping search results long-term depends on your Mapbox plan; check before relying on it (users
 *    can always type coordinates by hand). Searches here are never cached on the server.
 *  - Directions results are never cached or stored here; they are computed per view.
 */

export class MapboxError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "MapboxError";
  }
}

type Env = Record<string, string | undefined>;

export function mapboxToken(env: Env = process.env): string | null {
  return env.MAPBOX_API_KEY?.trim() || null;
}

export function isMapboxConfigured(env: Env = process.env): boolean {
  return mapboxToken(env) !== null;
}

/**
 * The token a browser may receive, for map tiles. Only public (pk.) tokens qualify: a secret (sk.)
 * token must never leave the server.
 */
export function publicMapToken(env: Env = process.env): string | null {
  const t = mapboxToken(env);
  return t?.startsWith("pk.") ? t : null;
}

const featureSchema = z.object({
  properties: z
    .object({
      name: z.string().nullish(),
      name_preferred: z.string().nullish(),
      full_address: z.string().nullish(),
      place_formatted: z.string().nullish(),
      feature_type: z.string().nullish(),
    })
    .passthrough(),
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) }),
});
const searchSchema = z.object({ features: z.array(featureSchema) });

export interface PlaceCandidate {
  name: string;
  address: string;
  type: string | null;
  lat: number;
  lng: number;
}

async function mapboxFetch(url: URL, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (error) {
    // Never include the URL: it carries the access token.
    throw new MapboxError(error instanceof Error && error.name === "TimeoutError" ? "Mapbox timed out" : "Mapbox request failed");
  }
  if (!res.ok) {
    const msg = res.status === 401 || res.status === 403 ? "Mapbox rejected the access token" : res.status === 429 ? "Mapbox rate limit reached" : `Mapbox returned HTTP ${res.status}`;
    throw new MapboxError(msg, res.status);
  }
  return res.json().catch(() => {
    throw new MapboxError("Mapbox returned an unreadable response");
  });
}

export interface GeocodeOptions {
  /** ISO 3166 alpha-2, comma separated, e.g. "ae". */
  country?: string;
  /** Bias results towards this point. */
  near?: LatLng;
  limit?: number;
}

export async function geocode(query: string, options: GeocodeOptions = {}, env: Env = process.env): Promise<PlaceCandidate[]> {
  const token = mapboxToken(env);
  if (!token) throw new MapboxError("Mapbox is not configured");
  const q = query.trim();
  if (q.length < 2) return [];

  const url = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
  url.searchParams.set("q", q.slice(0, 200));
  url.searchParams.set("limit", String(Math.min(Math.max(options.limit ?? 5, 1), 10)));
  url.searchParams.set("language", "en");
  if (options.country) url.searchParams.set("country", options.country);
  if (options.near) url.searchParams.set("proximity", `${options.near.lng},${options.near.lat}`);
  url.searchParams.set("access_token", token);

  const parsed = searchSchema.safeParse(await mapboxFetch(url, 8000));
  if (!parsed.success) throw new MapboxError("Mapbox returned an unexpected response");
  return parsed.data.features.map((f) => ({
    name: f.properties.name_preferred ?? f.properties.name ?? "Unnamed place",
    address: f.properties.full_address ?? f.properties.place_formatted ?? "",
    type: f.properties.feature_type ?? null,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}

const directionsSchema = z.object({
  routes: z
    .array(z.object({ legs: z.array(z.object({ distance: z.number(), duration: z.number() })) }))
    .min(1),
});

export interface DrivingLeg {
  distanceKm: number;
  minutes: number;
}

/** Mapbox allows 25 coordinates per Directions request. */
export const MAX_DIRECTIONS_POINTS = 25;

/** One driving leg per consecutive pair of points. */
export async function drivingLegs(points: readonly LatLng[], env: Env = process.env): Promise<DrivingLeg[]> {
  const token = mapboxToken(env);
  if (!token) throw new MapboxError("Mapbox is not configured");
  if (points.length < 2) return [];
  if (points.length > MAX_DIRECTIONS_POINTS) throw new MapboxError("Too many stops for one routing request");

  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}`);
  url.searchParams.set("overview", "false");
  url.searchParams.set("access_token", token);

  const parsed = directionsSchema.safeParse(await mapboxFetch(url, 10_000));
  if (!parsed.success) throw new MapboxError("No route found between these stops");
  const legs = parsed.data.routes[0].legs;
  if (legs.length !== points.length - 1) throw new MapboxError("Mapbox returned an unexpected number of legs");
  return legs.map((l) => ({ distanceKm: Math.round(l.distance / 100) / 10, minutes: Math.max(1, Math.round(l.duration / 60)) }));
}

/** Straight-line distance for a routed leg, so the UI can show how much the road adds. */
export function straightLineKm(a: LatLng, b: LatLng): number {
  return Math.round(haversineKm(a, b) * 10) / 10;
}
