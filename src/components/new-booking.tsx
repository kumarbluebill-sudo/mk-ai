"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SandboxBanner } from "./booking-ui";

interface TourHit {
  id: string;
  title: string;
  pricePerPerson: number | null;
  currency: string | null;
}
interface Slot {
  startTime: string | null;
  endTime: string | null;
  timeSlotId: number | null;
  startMinutes: number | null;
  available: boolean;
  left: number | null;
  total: number | null;
  currency: string;
}
interface Offer {
  offerId: number;
  name: string;
  bookingType: number | null;
  isDirectReporting: boolean | null;
  infantsAllowed: boolean | null;
  withinPaxLimits: boolean;
  slots: Slot[];
}
interface Availability {
  tour: { id: number; name: string };
  environment: string;
  offers: Offer[];
}
interface Hotel {
  id: number;
  name: string;
  area: string | null;
}
interface Choice {
  offer: Offer;
  slot: Slot;
}

const BOOKING_TYPE: Record<number, string> = { 0: "On request (supplier must approve)", 1: "Instant", 2: "Ticket only" };
const input = "rounded border px-2 py-1.5 text-sm";

function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A tour chosen from a trip item. The price and availability are always re-checked with the supplier. */
export interface Prefill {
  tourId: string;
  title: string;
  date: string | null;
}

export default function NewBooking({ prefill = null }: { prefill?: Prefill | null }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("dubai");
  const [tours, setTours] = useState<TourHit[] | null>(null);
  const [tour, setTour] = useState<TourHit | null>(prefill ? { id: prefill.tourId, title: prefill.title, pricePerPerson: null, currency: null } : null);
  const [date, setDate] = useState(() => (prefill?.date && prefill.date >= tomorrow() ? prefill.date : tomorrow()));
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [infants, setInfants] = useState("0");
  const [avail, setAvail] = useState<Availability | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [hotelFilter, setHotelFilter] = useState("");
  const [hotelId, setHotelId] = useState<number | null>(null);
  const [guest, setGuest] = useState({ name: "", email: "", phone: "", remarks: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One key per booking attempt: a double click or a retry returns the same booking, not a second hold.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const pax = { adults: Number(adults) || 0, children: Number(children) || 0, infants: Number(infants) || 0 };
  const needsHotel = choice?.offer.isDirectReporting === false;
  const shownHotels = useMemo(
    () => hotels.filter((h) => `${h.name} ${h.area ?? ""}`.toLowerCase().includes(hotelFilter.toLowerCase())).slice(0, 40),
    [hotels, hotelFilter]
  );

  async function searchTours(e: React.FormEvent) {
    e.preventDefault();
    setBusy("search");
    setError(null);
    setTour(null);
    setAvail(null);
    setChoice(null);
    try {
      const r = await fetch(`/api/suppliers/search?category=activity&keyword=${encodeURIComponent(keyword)}&limit=50`);
      const d = (await r.json()) as {
        items?: { supplier: string; supplierItemId: string; title: string; price: { amountMinor: number; currency: string } | null }[];
        error?: string;
      };
      if (!r.ok) throw new Error(d.error ?? "Search failed");
      const hits = (d.items ?? [])
        .filter((i) => i.supplier === "traveldesk")
        .map((i) => ({ id: i.supplierItemId, title: i.title, pricePerPerson: i.price ? i.price.amountMinor / 100 : null, currency: i.price?.currency ?? null }));
      setTours(hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(null);
    }
  }

  async function checkAvailability(e: React.FormEvent) {
    e.preventDefault();
    if (!tour) return;
    setBusy("avail");
    setError(null);
    setChoice(null);
    setAvail(null);
    try {
      const q = new URLSearchParams({ tourId: tour.id, date, adults: String(pax.adults), children: String(pax.children) });
      const r = await fetch(`/api/suppliers/traveldesk/availability?${q}`);
      const d = (await r.json()) as Availability & { error?: string; message?: string };
      if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not check availability");
      setAvail(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check availability");
    } finally {
      setBusy(null);
    }
  }

  async function pick(offer: Offer, slot: Slot) {
    setChoice({ offer, slot });
    setHotelId(null);
    setHotels([]);
    if (offer.isDirectReporting === false) {
      const r = await fetch(`/api/suppliers/traveldesk/hotels?offerId=${offer.offerId}`);
      const d = (await r.json().catch(() => ({}))) as { hotels?: Hotel[] };
      setHotels(d.hotels ?? []);
    }
  }

  async function reserve(e: React.FormEvent) {
    e.preventDefault();
    if (!tour || !choice) return;
    setBusy("reserve");
    setError(null);
    try {
      const r = await fetch("/api/bookings/traveldesk", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          tourId: Number(tour.id),
          offerId: choice.offer.offerId,
          date,
          ...(choice.slot.timeSlotId !== null && { timeSlotId: choice.slot.timeSlotId }),
          ...(choice.slot.startMinutes !== null && { startMinutes: choice.slot.startMinutes }),
          ...pax,
          guestName: guest.name.trim(),
          ...(guest.email.trim() && { email: guest.email.trim() }),
          ...(guest.phone.trim() && { phone: guest.phone.trim() }),
          ...(guest.remarks.trim() && { remarks: guest.remarks.trim() }),
          ...(needsHotel && hotelId !== null && { hotelId }),
        }),
      });
      const d = (await r.json()) as { booking?: { id: string }; error?: string; message?: string };
      if (!r.ok || !d.booking) {
        // The server answered, so this attempt is settled: the next try must be a new booking, not a replay.
        setIdempotencyKey(crypto.randomUUID());
        throw new Error(d.message ?? d.error ?? "Could not reserve");
      }
      router.push(`/bookings/${d.booking.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reserve");
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header>
        <Link href="/bookings" className="text-sm text-blue-600 underline">← All bookings</Link>
        <h1 className="text-2xl font-semibold">New booking</h1>
      </header>
      <SandboxBanner />
      <p className="text-xs text-gray-500">
        Step 3 only places a short hold with the supplier. Nothing is charged until someone with permission confirms it.
      </p>
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section aria-label="Find a tour" className="space-y-2 rounded border p-3">
        <h2 className="font-medium">1. Find a tour</h2>
        <form onSubmit={searchTours} className="flex gap-2">
          <input className={`${input} flex-1`} value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="Search" placeholder="e.g. dubai desert safari" />
          <button disabled={busy !== null} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-60">{busy === "search" ? "Searching…" : "Search"}</button>
        </form>
        <p className="text-xs text-gray-500">Traveldesk covers the UAE only. Include a place such as Dubai or Abu Dhabi.</p>
        {tours?.length === 0 && <p className="text-sm text-gray-600">No Traveldesk tours matched.</p>}
        <ul className="space-y-1">
          {tours?.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => { setTour(t); setAvail(null); setChoice(null); }}
                aria-pressed={tour?.id === t.id}
                className={`w-full rounded border p-2 text-left text-sm ${tour?.id === t.id ? "border-blue-600 bg-blue-50" : "hover:bg-gray-50"}`}
              >
                {t.title}
                {t.pricePerPerson !== null && <span className="ml-2 text-xs text-gray-500">from {t.currency} {t.pricePerPerson} per adult (supplier price)</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {tour && (
        <section aria-label="Date and guests" className="space-y-2 rounded border p-3">
          <h2 className="font-medium">2. Date and guests</h2>
          <p className="text-sm">
            <strong>{tour.title}</strong>
            {prefill?.tourId === tour.id && <span className="ml-2 text-xs text-gray-600">chosen from your trip. Check availability to see today&apos;s price and slots.</span>}
          </p>
          <form onSubmit={checkAvailability} className="grid gap-2 sm:grid-cols-5">
            <input type="date" required min={tomorrow()} className={`${input} sm:col-span-2`} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
            <label className="text-xs">Adults<input className={`${input} w-full`} inputMode="numeric" value={adults} onChange={(e) => setAdults(e.target.value)} /></label>
            <label className="text-xs">Children<input className={`${input} w-full`} inputMode="numeric" value={children} onChange={(e) => setChildren(e.target.value)} /></label>
            <label className="text-xs">Infants<input className={`${input} w-full`} inputMode="numeric" value={infants} onChange={(e) => setInfants(e.target.value)} /></label>
            <button disabled={busy !== null || pax.adults < 1} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-60 sm:col-span-5">
              {busy === "avail" ? "Checking…" : "Check availability"}
            </button>
          </form>

          {avail && (
            <div className="space-y-2">
              {avail.offers.length === 0 && <p className="text-sm text-gray-600">No offers found.</p>}
              {avail.offers.map((o) => (
                <div key={o.offerId} className="rounded border p-2">
                  <p className="text-sm font-medium">{o.name}</p>
                  <p className="text-xs text-gray-500">
                    {o.bookingType !== null ? BOOKING_TYPE[o.bookingType] ?? "" : ""}
                    {o.isDirectReporting === false ? " · needs a pick-up hotel" : ""}
                    {!o.withinPaxLimits ? " · guest numbers outside this offer's limits" : ""}
                  </p>
                  {o.slots.length === 0 && <p className="text-xs text-gray-500">Nothing on this date.</p>}
                  <ul className="mt-1 space-y-1">
                    {o.slots.map((s, i) => (
                      <li key={`${s.timeSlotId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          {s.startTime ? `${s.startTime}${s.endTime ? `-${s.endTime}` : ""}` : "All day"} ·{" "}
                          {s.available ? <span className="text-green-700">available{s.left !== null ? ` (${s.left} left)` : ""}</span> : <span className="text-red-700">not available</span>}
                          {s.total !== null && <span className="ml-2 text-gray-600">{s.currency} {s.total.toFixed(2)} supplier cost</span>}
                        </span>
                        <button
                          disabled={!s.available || !o.withinPaxLimits}
                          onClick={() => void pick(o, s)}
                          aria-pressed={choice?.slot === s}
                          className={`rounded border px-2 py-0.5 text-xs disabled:opacity-40 ${choice?.slot === s ? "bg-blue-600 text-white" : ""}`}
                        >
                          {choice?.slot === s ? "Selected" : "Select"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {choice && (
        <section aria-label="Guest details" className="space-y-2 rounded border p-3">
          <h2 className="font-medium">3. Guest details and hold</h2>
          <form onSubmit={reserve} className="grid gap-2 sm:grid-cols-2">
            <input required maxLength={120} className={`${input} sm:col-span-2`} placeholder="Lead guest full name" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} aria-label="Guest name" />
            <input type="email" className={input} placeholder="Email (optional)" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} aria-label="Email" />
            <input className={input} placeholder="Phone (optional)" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} aria-label="Phone" />
            {needsHotel && (
              <div className="space-y-1 sm:col-span-2">
                <input className={`${input} w-full`} placeholder="Search pick-up hotel…" value={hotelFilter} onChange={(e) => setHotelFilter(e.target.value)} aria-label="Search hotel" />
                <select required size={6} className={`${input} w-full`} value={hotelId ?? ""} onChange={(e) => setHotelId(Number(e.target.value))} aria-label="Pick-up hotel">
                  {shownHotels.map((h) => <option key={h.id} value={h.id}>{h.name}{h.area ? ` (${h.area})` : ""}</option>)}
                </select>
              </div>
            )}
            <textarea className={`${input} sm:col-span-2`} rows={2} maxLength={500} placeholder="Remarks (optional)" value={guest.remarks} onChange={(e) => setGuest({ ...guest, remarks: e.target.value })} aria-label="Remarks" />
            <button disabled={busy !== null || (needsHotel && hotelId === null)} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60 sm:col-span-2">
              {busy === "reserve" ? "Placing hold…" : "Place a free hold"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
