"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BookingView } from "@/server/booking/traveldesk-booking";
import { describeSlot, SandboxBanner, StatusBadge } from "./booking-ui";

interface ApiResult {
  booking?: BookingView;
  error?: string;
  message?: string;
}

const money = (n: number) => `USD ${n.toFixed(2)}`;

export default function BookingDetail({ id }: { id: string }) {
  const [b, setB] = useState<BookingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Re-evaluated every 30s so an expired hold is flagged without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookings/${id}`)
      .then(async (r) => {
        const d = (await r.json()) as ApiResult;
        if (!r.ok || !d.booking) throw new Error(d.message ?? d.error ?? "Could not load this booking");
        if (!cancelled) setB(d.booking);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this booking");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function act(label: string, url: string, init?: RequestInit) {
    setBusy(label);
    setError(null);
    try {
      const r = await fetch(url, init);
      const d = (await r.json()) as ApiResult;
      if (!r.ok || !d.booking) {
        // A failed action can still have changed the record (e.g. an unknown outcome): reload it.
        const reload = await fetch(`/api/bookings/${id}`);
        const rd = (await reload.json().catch(() => ({}))) as ApiResult;
        if (rd.booking) setB(rd.booking);
        throw new Error(d.message ?? d.error ?? "That did not work");
      }
      setB(d.booking);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="p-6">Loading booking…</p>;
  if (!b) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p role="alert" className="text-red-600">{error ?? "Booking not found."}</p>
        <Link href="/bookings" className="text-blue-600 underline">Back to bookings</Link>
      </main>
    );
  }

  const deadline = b.reservationDeadline ? new Date(b.reservationDeadline) : null;
  // The deadline only matters while the booking is still just a hold.
  const holdExpired = b.status === "RESERVED" && deadline !== null && deadline.getTime() < now;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header>
        <Link href="/bookings" className="text-sm text-blue-600 underline">← All bookings</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{b.tour.name}</h1>
          <StatusBadge status={b.status} />
        </div>
        <p className="text-sm text-gray-600">{b.offer.name}</p>
      </header>

      {b.sandbox && <SandboxBanner />}
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="rounded bg-gray-50 p-3 text-sm">{b.note}</p>

      {b.status === "RESERVED" && deadline && (
        <p className={`text-sm ${holdExpired ? "text-red-700" : "text-blue-800"}`}>
          {holdExpired
            ? "The hold has probably expired. Use Refresh to check with the supplier."
            : `Held until about ${deadline.toLocaleTimeString()}. Nothing is charged until you confirm.`}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded border p-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-gray-500">Date</dt><dd>{b.date}{describeSlot(b) ? ` · ${describeSlot(b)}` : ""}</dd></div>
        <div><dt className="text-xs text-gray-500">Guests</dt><dd>{b.pax.adults} adult{b.pax.adults === 1 ? "" : "s"}{b.pax.children ? `, ${b.pax.children} child` : ""}{b.pax.infants ? `, ${b.pax.infants} infant` : ""}</dd></div>
        <div><dt className="text-xs text-gray-500">Lead guest</dt><dd>{b.guest.name}</dd></div>
        <div><dt className="text-xs text-gray-500">Our reference</dt><dd className="break-all">{b.reference}</dd></div>
        <div><dt className="text-xs text-gray-500">Traveldesk booking ID</dt><dd>{b.supplier.bookingId ?? "none yet"}</dd></div>
        <div><dt className="text-xs text-gray-500">Supplier status</dt><dd>{b.supplier.status ?? "none yet"}</dd></div>
        {b.cost && <div><dt className="text-xs text-gray-500">Supplier cost</dt><dd>{money(b.cost.total)}</dd></div>}
        <div><dt className="text-xs text-gray-500">Customer payment</dt><dd>Not collected by this app</dd></div>
        {b.customerSupportPhone && <div><dt className="text-xs text-gray-500">Supplier support</dt><dd>{b.customerSupportPhone}</dd></div>}
      </dl>

      {b.cancellationPolicyRaw.length > 0 && (
        <p className="text-xs text-gray-600">
          Supplier cancellation policy (as printed on its voucher): {b.cancellationPolicyRaw.map((c) => `${c.percents}% refund if cancelled ${c.hours}h before the pick-up`).join(" · ")}. Anything later than that is not refunded in full; the supplier decides.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button disabled={busy !== null} onClick={() => void act("refresh", `/api/bookings/${id}?refresh=1`)} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">
          {busy === "refresh" ? "Checking…" : "Refresh from supplier"}
        </button>

        {b.canConfirm && b.cost && (
          <button
            disabled={busy !== null || holdExpired}
            onClick={() => {
              const total = b.cost?.total ?? 0;
              if (!window.confirm(`Confirm with Traveldesk?\n\nThe supplier will charge ${money(total)} to your agency account${b.sandbox ? " (test environment)" : ""}. Any refund later follows the supplier's cancellation policy.`)) return;
              void act("confirm", `/api/bookings/${id}/confirm`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ expectedTotal: total }),
              });
            }}
            className="rounded bg-green-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy === "confirm" ? "Confirming…" : `Confirm and charge ${money(b.cost.total)}`}
          </button>
        )}

        {b.canDownloadVoucher && (
          <a href={`/api/bookings/${id}/voucher`} className="rounded border bg-white px-3 py-1.5 text-sm text-blue-700 underline">
            Download supplier voucher (PDF)
          </a>
        )}

        {b.canCancel && (
          <button
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm("Cancel this booking with the supplier? Any fee follows the supplier's cancellation policy.")) return;
              void act("cancel", `/api/bookings/${id}/cancel`, { method: "POST" });
            }}
            className="rounded border px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel booking"}
          </button>
        )}
      </div>

      <section aria-label="History">
        <h2 className="mb-1 text-sm font-medium">History</h2>
        <ol className="space-y-1 text-xs text-gray-600">
          {[...b.events].reverse().map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span className="text-gray-400">{new Date(e.at).toLocaleString()}</span> · {e.note}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
