"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export interface MapPoint {
  id: string;
  title: string;
  lat: number;
  lng: number;
}

/**
 * Basic map of one day's located items. Tiles are OpenStreetMap's public tile server, which is fine
 * for light use but must be replaced by a commercial tile/maps provider before heavy production
 * traffic (see DEVELOPMENT_PLAN.md). The line between points is a straight-line sketch, not a route.
 */
export default function TripMap({ points }: { points: MapPoint[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current || points.length === 0) return;
    let disposed = false;
    let cleanup = () => {};

    void import("leaflet").then((L) => {
      if (disposed || !el.current) return;
      const map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const latLngs = points.map((p) => [p.lat, p.lng] as [number, number]);
      points.forEach((p, i) => {
        L.circleMarker([p.lat, p.lng], { radius: 9, color: "#1d4ed8", fillColor: "#2563eb", fillOpacity: 0.9 })
          .bindTooltip(`${i + 1}. ${p.title}`, { permanent: false })
          .addTo(map);
      });
      if (latLngs.length > 1) L.polyline(latLngs, { color: "#2563eb", weight: 3, dashArray: "6 6" }).addTo(map);
      map.fitBounds(L.latLngBounds(latLngs), { padding: [30, 30], maxZoom: 15 });
      cleanup = () => map.remove();
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [points]);

  if (points.length === 0) {
    return (
      <p className="rounded border border-dashed p-4 text-sm text-gray-500">
        No coordinates on this day yet. Add latitude and longitude to an item to see it on the map.
      </p>
    );
  }
  return <div ref={el} className="h-72 w-full rounded border" role="img" aria-label="Map of this day's stops" />;
}
