"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { MemberView } from "@/server/team/members";

const ROLES = ["ADMIN", "MANAGER", "CONSULTANT", "SALES", "ACCOUNTS", "READONLY"] as const;
const ROLE_HELP: Record<string, string> = {
  ADMIN: "Everything except agency settings",
  MANAGER: "Trips, quotations, bookings (can confirm), see costs",
  CONSULTANT: "Trips, quotations, can place a booking hold",
  SALES: "Trips and quotations",
  ACCOUNTS: "Read-only plus payments and costs",
  READONLY: "View only",
};
const input = "rounded border px-2 py-1.5 text-sm";

interface Secret {
  email: string;
  password: string;
}

export default function TeamClient() {
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "CONSULTANT" as (typeof ROLES)[number] });

  const load = useCallback(async () => {
    const r = await fetch("/api/team");
    const d = (await r.json()) as { members?: MemberView[]; error?: string };
    if (!r.ok) throw new Error(r.status === 403 ? "Only owners and admins can manage the team." : (d.error ?? "Could not load the team"));
    setMembers(d.members ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/team")
      .then(async (r) => {
        const d = (await r.json()) as { members?: MemberView[]; error?: string };
        if (!r.ok) throw new Error(r.status === 403 ? "Only owners and admins can manage the team." : (d.error ?? "Could not load the team"));
        if (!cancelled) setMembers(d.members ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the team");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function call(url: string, init: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, init);
      const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) setError(String(data.message ?? data.error ?? "That did not work"));
      return { ok: r.ok, data };
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { ok, data } = await call("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    if (ok) {
      setSecret({ email: form.email, password: String(data.temporaryPassword) });
      setForm({ name: "", email: "", role: "CONSULTANT" });
      await load().catch(() => undefined);
    }
  }

  async function setRole(m: MemberView, role: string) {
    const { ok } = await call(`/api/team/${m.membershipId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
    if (ok) await load().catch(() => undefined);
  }

  async function remove(m: MemberView) {
    if (!window.confirm(`Remove ${m.email}? They lose access immediately. Their trips and quotations stay in the agency.`)) return;
    const { ok } = await call(`/api/team/${m.membershipId}`, { method: "DELETE" });
    if (ok) await load().catch(() => undefined);
  }

  async function reset(m: MemberView) {
    if (!window.confirm(`Give ${m.email} a new temporary password? Their current password stops working.`)) return;
    const { ok, data } = await call(`/api/team/${m.membershipId}/reset-password`, { method: "POST" });
    if (ok) setSecret({ email: m.email, password: String(data.temporaryPassword) });
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Team</h1>
        <Link href="/dashboard" className="rounded border px-3 py-1 text-sm">Dashboard</Link>
      </header>
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {secret && (
        <div role="status" className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Temporary password for {secret.email}</p>
          <p><code className="select-all rounded bg-white px-2 py-1 text-base">{secret.password}</code></p>
          <p className="text-xs text-amber-900">
            Shown once. Give it to them securely (not by chat or email); they must change it at first sign-in. There is no email delivery yet.
          </p>
          <button onClick={() => setSecret(null)} className="rounded border bg-white px-2 py-0.5 text-xs">I have copied it</button>
        </div>
      )}

      <form onSubmit={add} className="grid gap-2 rounded border p-3 sm:grid-cols-4">
        <h2 className="font-medium sm:col-span-4">Add a team member</h2>
        <input required maxLength={120} className={input} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Name" />
        <input required type="email" className={input} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Email" />
        <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as (typeof ROLES)[number] })} aria-label="Role">
          {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
        </select>
        <button disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-60">Add</button>
        <p className="text-xs text-gray-500 sm:col-span-4">{ROLE_HELP[form.role]}. Adding a person uses one seat on your plan.</p>
      </form>

      <section aria-label="Members" className="space-y-2">
        {members === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
        <ul className="space-y-2">
          {members?.map((m) => (
            <li key={m.membershipId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.name ?? m.email}{m.isYou ? " (you)" : ""}</p>
                <p className="truncate text-xs text-gray-600">
                  {m.email} · 2FA {m.totpEnabled ? "on" : "off"}{m.mustChangePassword ? " · temporary password" : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {m.role === "OWNER" || m.isYou ? (
                  <span className="rounded bg-gray-100 px-2 py-1">{m.role.toLowerCase()}</span>
                ) : (
                  <>
                    <select disabled={busy} className={input} value={m.role} onChange={(e) => void setRole(m, e.target.value)} aria-label={`Role of ${m.email}`}>
                      {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
                    </select>
                    <button disabled={busy} onClick={() => void reset(m)} className="rounded border px-2 py-1">New password</button>
                    <button disabled={busy} onClick={() => void remove(m)} className="rounded border px-2 py-1 text-red-700">Remove</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">An admin cannot change another admin; only the owner can. The owner cannot be changed or removed here.</p>
      </section>
    </main>
  );
}
