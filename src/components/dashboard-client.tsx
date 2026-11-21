"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Entitlements } from "@/server/billing/limits";
import type { Usage } from "@/server/billing/usage";

interface Summary {
  tenant: { name: string; slug: string } | null;
  role: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  entitlements: Entitlements;
  usage: Usage;
}

const ROWS: { metric: keyof Usage; label: string; limitKey: keyof Omit<Entitlements["limits"], "features"> }[] = [
  { metric: "aiTokens", label: "AI tokens this month", limitKey: "aiTokensPerMonth" },
  { metric: "conversations", label: "Trips and chats started this month", limitKey: "conversationsPerMonth" },
  { metric: "quotations", label: "Quotations this month", limitKey: "quotationsPerMonth" },
  { metric: "bookings", label: "Supplier bookings this month", limitKey: "bookingsPerMonth" },
  { metric: "seats", label: "Team members", limitKey: "seats" },
];

const STATUS_STYLE: Record<string, string> = {
  TRIAL: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-green-100 text-green-800",
  PAST_DUE: "bg-amber-100 text-amber-800",
  CANCELLED: "bg-gray-200 text-gray-700",
  SUSPENDED: "bg-red-100 text-red-800",
  TRIAL_ENDED: "bg-red-100 text-red-800",
};

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const color = pct >= 100 ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-blue-600";
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-gray-600">
          {used.toLocaleString()} / {limit === null ? "unlimited" : limit.toLocaleString()}
        </span>
      </div>
      {limit !== null && (
        <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-1 h-2 rounded bg-gray-200">
          <div className={`h-2 rounded ${color}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default function DashboardClient() {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/summary")
      .then(async (r) => {
        const d = (await r.json()) as Summary & { error?: string; message?: string };
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not load the dashboard");
        setS(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the dashboard"));
  }, []);

  if (error) return <main className="mx-auto max-w-3xl p-6"><p role="alert" className="text-red-600">{error}</p></main>;
  if (!s) return <main className="mx-auto max-w-3xl p-6"><p className="text-sm text-gray-500">Loading…</p></main>;

  const { entitlements: e, usage } = s;
  const canManageTeam = s.role === "OWNER" || s.role === "ADMIN";
  const trialEnd = e.subscription.trialEndsAt ? new Date(e.subscription.trialEndsAt).toLocaleDateString() : null;

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{s.tenant?.name ?? "Dashboard"}</h1>
          <p className="text-sm text-gray-600">Signed in as {s.role.toLowerCase()}</p>
        </div>
        <nav aria-label="Sections" className="flex flex-wrap gap-2 text-sm">
          <Link href="/chat" className="rounded border px-3 py-1">Chat</Link>
          <Link href="/designer" className="rounded border px-3 py-1">Trips</Link>
          <Link href="/bookings" className="rounded border px-3 py-1">Bookings</Link>
          {canManageTeam && <Link href="/team" className="rounded border px-3 py-1">Team</Link>}
          <Link href="/settings/security" className="rounded border px-3 py-1">Security</Link>
        </nav>
      </header>

      {s.mustChangePassword && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          You are using a temporary password. <Link href="/settings/security" className="underline">Choose your own password</Link>.
        </p>
      )}
      {e.state.message && (
        <p role={e.state.canUse ? "status" : "alert"} className={`rounded border p-3 text-sm ${e.state.canUse ? "border-blue-200 bg-blue-50 text-blue-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {e.state.message}
        </p>
      )}
      {!s.totpEnabled && canManageTeam && (
        <p className="text-xs text-gray-600">
          Tip: turn on two-factor authentication in <Link href="/settings/security" className="underline">Security</Link> to protect the agency account.
        </p>
      )}

      <section aria-label="Plan" className="rounded border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">{e.plan.name} plan</h2>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.state.status] ?? "bg-gray-100"}`}>{e.state.status.replace("_", " ")}</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {trialEnd && e.state.status === "TRIAL" ? `Trial ends ${trialEnd}. ` : ""}
          Plans and limits are set by the platform administrator. There is no online payment yet: ask them to change your plan.
        </p>
        <p className="mt-2 text-xs text-gray-600">
          Included: AI planner {e.limits.features.ai ? "yes" : "no"} · Supplier bookings {e.limits.features.bookings ? "yes" : "no"}
        </p>
      </section>

      <section aria-label="Usage" className="space-y-3 rounded border p-4">
        <h2 className="font-medium">Usage</h2>
        {ROWS.map((r) => (
          <Meter key={r.metric} label={r.label} used={usage[r.metric]} limit={e.limits[r.limitKey]} />
        ))}
        <p className="text-xs text-gray-500">Monthly figures count from the 1st of the month (UTC).</p>
      </section>
    </main>
  );
}
