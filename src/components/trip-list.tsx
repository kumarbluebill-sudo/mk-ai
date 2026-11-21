"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Row {
  conversationId: string;
  title: string;
  destination: string;
  days: number;
  updatedAt: string;
}

export default function TripList() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/itineraries")
      .then(async (r) => {
        const d = (await r.json()) as { itineraries?: Row[]; error?: string };
        if (!r.ok) throw new Error(d.error ?? "Could not load trips");
        setRows(d.itineraries ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load trips"));
  }, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const f = new FormData(e.currentTarget);
    const days = Math.min(30, Math.max(1, Number(f.get("days")) || 1));
    const startDate = String(f.get("startDate") ?? "");
    const destination = String(f.get("destination") ?? "").trim();
    try {
      const res = await fetch("/api/itineraries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: String(f.get("title") ?? "").trim(),
          destination,
          ...(startDate && { startDate }),
          days: Array.from({ length: days }, (_, i) => ({ title: i === 0 ? "Arrival" : `Day ${i + 1}`, items: [] })),
        }),
      });
      const d = (await res.json()) as { conversationId?: string; error?: string };
      if (!res.ok || !d.conversationId) throw new Error(d.error ?? "Could not create the trip");
      router.push(`/designer/${d.conversationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the trip");
      setSaving(false);
    }
  }

  const input = "rounded border px-3 py-2 text-sm";
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Itinerary designer</h1>
        <Link href="/chat" className="rounded border px-3 py-1 text-sm">Chat</Link>
      </header>

      <form onSubmit={create} className="grid gap-2 rounded border p-4 sm:grid-cols-4">
        <h2 className="font-medium sm:col-span-4">Start a new trip</h2>
        <input name="title" required maxLength={200} placeholder="Trip title" className={`${input} sm:col-span-2`} aria-label="Trip title" />
        <input name="destination" required maxLength={120} placeholder="Destination" className={`${input} sm:col-span-2`} aria-label="Destination" />
        <input name="startDate" type="date" className={input} aria-label="Start date" />
        <input name="days" type="number" min={1} max={30} defaultValue={3} className={input} aria-label="Number of days" />
        <button disabled={saving} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60 sm:col-span-2">
          {saving ? "Creating…" : "Create trip"}
        </button>
      </form>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <section aria-label="Your trips" className="space-y-2">
        <h2 className="font-medium">Your trips</h2>
        {rows === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
        {rows?.length === 0 && <p className="text-sm text-gray-500">No itineraries yet. Create one above, or ask the AI planner in chat.</p>}
        <ul className="space-y-2">
          {rows?.map((r) => (
            <li key={r.conversationId}>
              <Link href={`/designer/${r.conversationId}`} className="block rounded border p-3 hover:bg-gray-50">
                <span className="font-medium">{r.title}</span>
                <span className="block text-xs text-gray-600">
                  {r.destination} · {r.days} day{r.days === 1 ? "" : "s"} · updated {new Date(r.updatedAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
