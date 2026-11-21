"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import QuotePanel from "./quote-panel";
import type { DayRoute } from "@/server/travel/geo";
import type { Itinerary, ItineraryDay, ItineraryItem, ItineraryPatch } from "@/server/travel/itinerary";

// Leaflet touches `window`, so it must only load in the browser.
const TripMap = dynamic(() => import("./trip-map"), { ssr: false });

type Category = ItineraryItem["category"];
// Type-only imports keep node:crypto out of the browser bundle, so the list is repeated here;
// the Category type makes the compiler reject any value the server would not accept.
const CATEGORIES: Category[] = [
  "sightseeing", "adventure", "museum", "theme_park", "beach", "cruise", "shopping", "restaurant",
  "breakfast", "hotel", "checkin", "transfer", "flight", "arrival", "departure", "bus", "train",
  "walking", "free_time", "other",
];

const STATUS_STYLE: Record<ItineraryItem["status"], string> = {
  LIVE: "bg-green-100 text-green-800",
  ESTIMATE: "bg-amber-100 text-amber-800",
  UNVERIFIED: "bg-gray-100 text-gray-700",
};
const STATUS_HELP: Record<ItineraryItem["status"], string> = {
  LIVE: "Checked with a supplier",
  ESTIMATE: "Rough estimate, not a supplier price",
  UNVERIFIED: "Not checked with any supplier",
};

export interface MapsConfig {
  provider: "mapbox" | "osm";
  token: string | null;
  routing: boolean;
  geocoding: boolean;
}

interface Candidate {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface View {
  title: string;
  itinerary: Itinerary | null;
  routes: Record<number, DayRoute>;
}

interface FormState {
  title: string;
  category: Category;
  startTime: string;
  endTime: string;
  location: string;
  lat: string;
  lng: string;
  price: string;
  currency: string;
  status: "ESTIMATE" | "UNVERIFIED";
}

const blankForm: FormState = {
  title: "", category: "sightseeing", startTime: "", endTime: "", location: "",
  lat: "", lng: "", price: "", currency: "USD", status: "UNVERIFIED",
};

function toForm(i: ItineraryItem): FormState {
  return {
    title: i.title, category: i.category, startTime: i.startTime ?? "", endTime: i.endTime ?? "",
    location: i.location ?? "", lat: i.lat?.toString() ?? "", lng: i.lng?.toString() ?? "",
    price: i.price?.toString() ?? "", currency: i.currency ?? "USD",
    status: i.status === "ESTIMATE" ? "ESTIMATE" : "UNVERIFIED",
  };
}

/** Builds the item payload; fields left blank are omitted so the server never sees empty strings. */
function fromForm(f: FormState, base?: ItineraryItem): Omit<ItineraryItem, "id"> {
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const price = num(f.price);
  return {
    // Keep supplier details of items the AI/supplier created; manual forms cannot mark an item LIVE.
    ...(base ? { supplier: base.supplier, productCode: base.productCode, description: base.description } : {}),
    title: f.title.trim(),
    category: f.category,
    ...(f.startTime && { startTime: f.startTime }),
    ...(f.endTime && { endTime: f.endTime }),
    ...(f.location.trim() && { location: f.location.trim() }),
    ...(num(f.lat) !== undefined && { lat: num(f.lat) }),
    ...(num(f.lng) !== undefined && { lng: num(f.lng) }),
    ...(price !== undefined && { price, currency: f.currency.toUpperCase() }),
    status: base?.status === "LIVE" && price === base.price ? "LIVE" : f.status,
  };
}

function ItemForm(props: {
  initial: FormState;
  submitLabel: string;
  onSubmit: (f: FormState) => void;
  onCancel?: () => void;
  maps: MapsConfig | null;
  /** A known point on the trip, used to bias place search towards the destination. */
  near?: { lat: number; lng: number };
}) {
  const [f, setF] = useState(props.initial);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function findOnMap() {
    setSearching(true);
    setSearchError(null);
    setCandidates(null);
    try {
      const q = new URLSearchParams({ q: f.location.trim() || f.title.trim() });
      if (props.near) {
        q.set("nearLat", String(props.near.lat));
        q.set("nearLng", String(props.near.lng));
      }
      const res = await fetch(`/api/maps/geocode?${q}`);
      const data = (await res.json()) as { candidates?: Candidate[]; message?: string; error?: string };
      if (!res.ok) throw new Error(data.message ?? "Search is not available right now");
      setCandidates(data.candidates ?? []);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const input = "rounded border px-2 py-1 text-sm";
  return (
    <form
      className="grid gap-2 rounded border bg-gray-50 p-3 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(f);
      }}
    >
      <input className={`${input} sm:col-span-3`} placeholder="Title" required maxLength={200} value={f.title} onChange={(e) => set("title", e.target.value)} aria-label="Title" />
      <select className={`${input} sm:col-span-3`} value={f.category} onChange={(e) => set("category", e.target.value as Category)} aria-label="Category">
        {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
      </select>
      <input className={input} type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} aria-label="Start time" />
      <input className={input} type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} aria-label="End time" />
      <input className={`${input} ${props.maps?.geocoding ? "sm:col-span-3" : "sm:col-span-4"}`} placeholder="Location (name)" maxLength={200} value={f.location} onChange={(e) => set("location", e.target.value)} aria-label="Location" />
      {props.maps?.geocoding && (
        <button type="button" disabled={searching || (f.location.trim() + f.title.trim()).length < 2} onClick={() => void findOnMap()} className="rounded border px-2 py-1 text-sm disabled:opacity-50">
          {searching ? "Searching…" : "Find on map"}
        </button>
      )}
      {searchError && <p role="alert" className="text-xs text-red-700 sm:col-span-6">{searchError}</p>}
      {candidates && (
        <ul className="space-y-1 sm:col-span-6" aria-label="Place results">
          {candidates.length === 0 && <li className="text-xs text-gray-600">No places found. Try a more specific name.</li>}
          {candidates.map((c, i) => (
            <li key={`${c.lat}-${c.lng}-${i}`} className="flex items-center justify-between gap-2 rounded border bg-white p-1.5 text-xs">
              <span><strong>{c.name}</strong> <span className="text-gray-600">{c.address}</span></span>
              <button type="button" className="rounded border px-2 py-0.5" onClick={() => { setF((p) => ({ ...p, location: c.name, lat: String(c.lat), lng: String(c.lng) })); setCandidates(null); }}>
                Use
              </button>
            </li>
          ))}
          {candidates.length > 0 && (
            <li className="text-xs text-gray-500">Results come from Mapbox search. Check Mapbox&apos;s terms for your plan before keeping coordinates long-term.</li>
          )}
        </ul>
      )}
      <input className={input} inputMode="decimal" placeholder="Latitude" value={f.lat} onChange={(e) => set("lat", e.target.value)} aria-label="Latitude" />
      <input className={input} inputMode="decimal" placeholder="Longitude" value={f.lng} onChange={(e) => set("lng", e.target.value)} aria-label="Longitude" />
      <input className={input} inputMode="decimal" placeholder="Price (optional)" value={f.price} onChange={(e) => set("price", e.target.value)} aria-label="Price" />
      <input className={input} maxLength={3} placeholder="USD" value={f.currency} onChange={(e) => set("currency", e.target.value)} aria-label="Currency" />
      <select className={`${input} sm:col-span-2`} value={f.status} onChange={(e) => set("status", e.target.value as FormState["status"])} aria-label="Data status">
        <option value="UNVERIFIED">Unverified</option>
        <option value="ESTIMATE">Estimate</option>
      </select>
      <div className="flex gap-2 sm:col-span-6">
        <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white">{props.submitLabel}</button>
        {props.onCancel && (
          <button type="button" onClick={props.onCancel} className="rounded border px-3 py-1 text-sm">Cancel</button>
        )}
      </div>
    </form>
  );
}

export default function TripDesigner({ conversationId }: { conversationId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapDay, setMapDay] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [maps, setMaps] = useState<MapsConfig | null>(null);
  // Real (Mapbox) driving legs, tagged with the itinerary shape they were computed for.
  const [routed, setRouted] = useState<{ key: string; routes: Record<number, DayRoute> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/maps/config")
      .then(async (r) => (r.ok ? ((await r.json()) as MapsConfig) : null))
      .then((c) => {
        if (!cancelled) setMaps(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/itineraries/${conversationId}`)
      .then(async (res) => {
        const data = (await res.json()) as View & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not load this trip");
        if (!cancelled) setView(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this trip");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function send(patches: ItineraryPatch[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/itineraries/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patches }),
      });
      const data = (await res.json()) as View & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save the change");
      setView(data);
      setEditing(null);
      setAdding(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the change");
    } finally {
      setBusy(false);
    }
  }

  const itinerary = view?.itinerary ?? null;
  // Changes whenever the order or coordinates of stops change, so stale routes are never shown.
  const routeKey = useMemo(
    () => JSON.stringify(itinerary?.days.map((d) => d.items.map((i) => [i.id, i.lat ?? null, i.lng ?? null]))),
    [itinerary]
  );
  const routing = maps?.routing === true;
  useEffect(() => {
    if (!routing || !itinerary) return;
    let cancelled = false;
    fetch(`/api/itineraries/${conversationId}/routes`)
      .then(async (r) => (r.ok ? ((await r.json()) as { routes: Record<number, DayRoute> }) : null))
      .then((data) => {
        if (!cancelled && data) setRouted({ key: routeKey, routes: data.routes });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // routeKey captures every change that matters; itinerary itself changes identity on each save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routing, routeKey, conversationId]);
  const liveRoutes = routed && routed.key === routeKey ? routed.routes : null;
  const day: ItineraryDay | undefined = itinerary?.days.find((d) => d.dayNumber === mapDay) ?? itinerary?.days[0];
  const points = useMemo(
    () => (day?.items ?? []).flatMap((i) => (i.lat !== undefined && i.lng !== undefined ? [{ id: i.id, title: i.title, lat: i.lat, lng: i.lng }] : [])),
    [day]
  );

  if (loading) return <p className="p-6">Loading trip…</p>;
  if (!itinerary) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p role="alert" className="text-red-600">{error ?? "This conversation has no itinerary yet."}</p>
        <Link href="/designer" className="text-blue-600 underline">Back to trips</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/designer" className="text-sm text-blue-600 underline">← All trips</Link>
          <h1 className="text-2xl font-semibold">{itinerary.title}</h1>
          <p className="text-sm text-gray-600">{itinerary.destination}{itinerary.startDate ? ` · starts ${itinerary.startDate}` : ""}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/bookings" className="rounded border px-3 py-1 text-sm">Bookings</Link>
          <Link href="/" className="rounded border px-3 py-1 text-sm">Back to search</Link>
        </div>
      </header>

      {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="text-xs text-gray-500">
        {routing
          ? "Legs marked Mapbox are real driving routes; anything else is a straight-line estimate. "
          : "Distances and times are straight-line estimates, not routed journeys. "}
        Items you add here are never marked as supplier-verified.
      </p>

      <section aria-label="Map" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Map</h2>
          {itinerary.days.map((d) => (
            <button key={d.dayNumber} onClick={() => setMapDay(d.dayNumber)} aria-pressed={day?.dayNumber === d.dayNumber}
              className={`rounded border px-2 py-0.5 text-sm ${day?.dayNumber === d.dayNumber ? "bg-blue-600 text-white" : ""}`}>
              Day {d.dayNumber}
            </button>
          ))}
        </div>
        <TripMap points={points} token={maps?.token ?? null} />
      </section>

      {itinerary.days.map((d) => {
        const route = liveRoutes?.[d.dayNumber] ?? view?.routes[d.dayNumber];
        const nearPoint = d.items.find((i) => i.lat !== undefined && i.lng !== undefined);
        const legByTo = new Map(route?.legs.map((l) => [l.toId, l]));
        const located = d.items.filter((i) => i.lat !== undefined && i.lng !== undefined).length;
        return (
          <section key={d.dayNumber} aria-label={`Day ${d.dayNumber}`} className="space-y-2 rounded border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">
                Day {d.dayNumber}{d.date ? ` · ${d.date}` : ""}:{" "}
                <button
                  className="underline decoration-dotted"
                  onClick={() => {
                    const t = window.prompt("Day title", d.title);
                    if (t && t.trim()) void send([{ op: "set_day_title", day: d.dayNumber, title: t.trim() }]);
                  }}
                  disabled={busy}
                >
                  {d.title}
                </button>
              </h2>
              <div className="flex gap-2 text-sm">
                <button disabled={busy || located < 3} title={located < 3 ? "Needs 3+ items with coordinates" : "Re-order by nearest stop"}
                  onClick={() => void send([{ op: "optimize_day", day: d.dayNumber }])} className="rounded border px-2 py-0.5 disabled:opacity-50">
                  Optimise order
                </button>
                <button disabled={busy || itinerary.days.length === 1}
                  onClick={() => { if (window.confirm(`Remove day ${d.dayNumber} and its items?`)) void send([{ op: "remove_day", day: d.dayNumber }]); }}
                  className="rounded border px-2 py-0.5 text-red-700 disabled:opacity-50">
                  Remove day
                </button>
              </div>
            </div>
            {route && route.legs.length > 0 && (
              <p className="text-xs text-gray-500">
                ~{route.totalKm} km, ~{route.totalMinutes} min of travel between located stops ({route.legs[0]?.source === "MAPBOX" ? "driving, Mapbox" : "estimate"})
                {route.unlocated > 0 ? ` · ${route.unlocated} item(s) without coordinates not counted` : ""}
              </p>
            )}

            <ol className="space-y-2">
              {d.items.length === 0 && <li className="text-sm text-gray-500">Nothing planned yet.</li>}
              {d.items.map((item, idx) => {
                const leg = legByTo.get(item.id);
                return (
                  <li key={item.id}>
                    {leg && (
                      <p className="mb-1 ml-3 text-xs text-gray-500">
                        ↓ ~{leg.travel.minutes} min {leg.travel.mode === "walk" ? "walk" : "by road"}, ~{leg.travel.distanceKm} km ({leg.source === "MAPBOX" ? "Mapbox" : "estimate"})
                      </p>
                    )}
                    {editing === item.id ? (
                      <ItemForm initial={toForm(item)} submitLabel="Save" maps={maps} near={nearPoint && nearPoint.lat !== undefined && nearPoint.lng !== undefined ? { lat: nearPoint.lat, lng: nearPoint.lng } : undefined} onCancel={() => setEditing(null)}
                        onSubmit={(f) => void send([{ op: "replace_item", itemId: item.id, item: fromForm(f, item) }])} />
                    ) : (
                      <div className="flex flex-wrap items-start justify-between gap-2 rounded border p-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {item.startTime && <span className="mr-2 text-sm text-gray-600">{item.startTime}{item.endTime ? `–${item.endTime}` : ""}</span>}
                            {item.title}
                            <span title={STATUS_HELP[item.status]} className={`ml-2 rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[item.status]}`}>{item.status}</span>
                          </p>
                          <p className="text-xs text-gray-600">
                            {item.category.replace("_", " ")}
                            {item.location ? ` · ${item.location}` : ""}
                            {item.price !== undefined ? ` · ${item.price} ${item.currency ?? ""}` : ""}
                            {item.supplier ? ` · ${item.supplier}` : ""}
                            {item.lat === undefined ? " · no coordinates" : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-sm">
                          <button aria-label="Move up" disabled={busy || idx === 0} onClick={() => void send([{ op: "move_item", itemId: item.id, toDay: d.dayNumber, position: idx - 1 }])} className="rounded border px-2 disabled:opacity-40">↑</button>
                          <button aria-label="Move down" disabled={busy || idx === d.items.length - 1} onClick={() => void send([{ op: "move_item", itemId: item.id, toDay: d.dayNumber, position: idx + 1 }])} className="rounded border px-2 disabled:opacity-40">↓</button>
                          <select aria-label="Move to day" disabled={busy} value="" onChange={(e) => e.target.value && void send([{ op: "move_item", itemId: item.id, toDay: Number(e.target.value) }])} className="rounded border px-1">
                            <option value="">Move to…</option>
                            {itinerary.days.filter((x) => x.dayNumber !== d.dayNumber).map((x) => <option key={x.dayNumber} value={x.dayNumber}>Day {x.dayNumber}</option>)}
                          </select>
                          <button onClick={() => setEditing(item.id)} className="rounded border px-2">Edit</button>
                          <button disabled={busy} onClick={() => void send([{ op: "remove_item", itemId: item.id }])} className="rounded border px-2 text-red-700">Remove</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>

            {adding === d.dayNumber ? (
              <ItemForm initial={blankForm} submitLabel="Add item" maps={maps} near={nearPoint && nearPoint.lat !== undefined && nearPoint.lng !== undefined ? { lat: nearPoint.lat, lng: nearPoint.lng } : undefined} onCancel={() => setAdding(null)}
                onSubmit={(f) => void send([{ op: "add_item", day: d.dayNumber, item: fromForm(f) }])} />
            ) : (
              <button onClick={() => setAdding(d.dayNumber)} className="rounded border px-3 py-1 text-sm">+ Add item</button>
            )}
          </section>
        );
      })}

      <button disabled={busy || itinerary.days.length >= 30}
        onClick={() => { const t = window.prompt("Title for the new day", "Free day"); if (t && t.trim()) void send([{ op: "add_day", title: t.trim() }]); }}
        className="rounded border px-3 py-1 text-sm disabled:opacity-50">
        + Add day
      </button>

      <QuotePanel conversationId={conversationId} />
    </main>
  );
}
