"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BookingView } from "@/server/booking/traveldesk-booking";
import { describeSlot, SandboxBanner, StatusBadge } from "./booking-ui";

export default function BookingsList() {
  const [rows, setRows] = useState<BookingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bookings")
      .then(async (r) => {
        const d = (await r.json()) as { bookings?: BookingView[]; error?: string };
        if (!r.ok) throw new Error(d.error ?? "Could not load bookings");
        setRows(d.bookings ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load bookings"));
  }, []);

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Bookings</h1>
        <div className="flex gap-2">
          <Link href="/chat" className="rounded border px-3 py-1 text-sm">Chat</Link>
          <Link href="/bookings/new" className="rounded bg-blue-600 px-3 py-1 text-sm text-white">New booking</Link>
        </div>
      </header>

      {rows?.some((r) => r.sandbox) && <SandboxBanner />}
      <p className="text-xs text-gray-500">
        The supplier is paid from your agency account with Traveldesk. Collecting payment from your customer is not built yet.
      </p>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {rows === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-gray-500">No bookings yet. Start with “New booking”.</p>}

      <ul className="space-y-2">
        {rows?.map((b) => (
          <li key={b.id}>
            <Link href={`/bookings/${b.id}`} className="block rounded border p-3 hover:bg-gray-50">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{b.tour.name}</span>
                <StatusBadge status={b.status} />
              </span>
              <span className="block text-xs text-gray-600">
                {b.date}{describeSlot(b) ? ` · ${describeSlot(b)}` : ""} · {b.pax.adults} adult{b.pax.adults === 1 ? "" : "s"}
                {b.pax.children ? `, ${b.pax.children} child${b.pax.children === 1 ? "" : "ren"}` : ""} · {b.guest.name}
                {b.sandbox ? " · TEST" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
