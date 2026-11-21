"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlanRow } from "@/server/admin/plans";
import type { TenantDetail } from "@/server/admin/tenants";
import { AdminGate, AdminNav, STATUS_STYLE, useAdminData } from "./admin-ui";

const LIMIT_FIELDS = [
  ["aiTokensPerMonth", "AI tokens / month"],
  ["conversationsPerMonth", "Chats and trips / month"],
  ["quotationsPerMonth", "Quotations / month"],
  ["bookingsPerMonth", "Bookings / month"],
  ["seats", "Team members"],
] as const;
type LimitKey = (typeof LIMIT_FIELDS)[number][0];
type Tri = "" | "on" | "off";

const input = "rounded border px-2 py-1.5 text-sm";

function Editor({ detail, plans, onSaved }: { detail: TenantDetail; plans: PlanRow[]; onSaved: () => void }) {
  const sub = detail.subscription;
  const overrides = (sub?.limitOverrides ?? {}) as Partial<Record<LimitKey, number | null>> & { features?: { ai?: boolean; bookings?: boolean } };
  const [planKey, setPlanKey] = useState(sub?.planKey ?? "");
  const [status, setStatus] = useState(sub?.status ?? "ACTIVE");
  const [trialEnds, setTrialEnds] = useState(sub?.trialEndsAt?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(sub?.notes ?? "");
  const [limits, setLimits] = useState<Record<LimitKey, string>>(() =>
    Object.fromEntries(LIMIT_FIELDS.map(([k]) => [k, overrides[k] === undefined ? "" : overrides[k] === null ? "unlimited" : String(overrides[k])])) as Record<LimitKey, string>
  );
  const tri = (v: boolean | undefined): Tri => (v === undefined ? "" : v ? "on" : "off");
  const [features, setFeatures] = useState<{ ai: Tri; bookings: Tri }>({ ai: tri(overrides.features?.ai), bookings: tri(overrides.features?.bookings) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const out: Record<string, unknown> = {};
    for (const [k] of LIMIT_FIELDS) {
      const v = limits[k].trim().toLowerCase();
      if (v === "") continue;
      if (v === "unlimited") out[k] = null;
      else if (/^\d+$/.test(v)) out[k] = Number(v);
      else {
        setMsg({ ok: false, text: `"${limits[k]}" is not a number. Use a whole number, "unlimited", or leave blank.` });
        return;
      }
    }
    const feat: Record<string, boolean> = {};
    if (features.ai) feat.ai = features.ai === "on";
    if (features.bookings) feat.bookings = features.bookings === "on";
    if (Object.keys(feat).length) out.features = feat;

    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/tenants/${detail.tenant.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planKey,
          status,
          trialEndsAt: trialEnds ? new Date(`${trialEnds}T23:59:59Z`).toISOString() : null,
          notes: notes.trim() || null,
          limitOverrides: Object.keys(out).length ? out : null,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not save");
      setMsg({ ok: true, text: "Saved. The change is in the audit log." });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded border p-4">
      <h2 className="font-medium">Subscription</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">Plan
          <select className={input} value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
            {plans.filter((p) => p.active || p.key === sub?.planKey).map((p) => <option key={p.key} value={p.key}>{p.name}{p.active ? "" : " (inactive)"}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Status
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
            {["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED", "SUSPENDED"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Trial ends
          <input type="date" className={input} value={trialEnds} onChange={(e) => setTrialEnds(e.target.value)} />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Limit overrides for this agency</legend>
        <p className="text-xs text-gray-500">Blank = use the plan. A number replaces the plan limit. &quot;unlimited&quot; removes the limit.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {LIMIT_FIELDS.map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-xs">{label}
              <input className={input} placeholder="plan default" value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} />
            </label>
          ))}
          {(["ai", "bookings"] as const).map((f) => (
            <label key={f} className="flex flex-col gap-1 text-xs">{f === "ai" ? "AI planner" : "Supplier bookings"}
              <select className={input} value={features[f]} onChange={(e) => setFeatures({ ...features, [f]: e.target.value as Tri })}>
                <option value="">Plan default</option><option value="on">Force on</option><option value="off">Force off</option>
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1 text-xs">Internal notes (only platform admins see these)
        <textarea className={input} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {status === "SUSPENDED" && <p className="text-xs text-red-700">Suspending stops this agency from starting any new chats, quotations or bookings. They can still sign in and view their data.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
      <button disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-60">{busy ? "Saving…" : "Save changes"}</button>
    </form>
  );
}

export default function AdminTenantDetail({ id }: { id: string }) {
  const detail = useAdminData<TenantDetail & { success: boolean }>(`/api/admin/tenants/${id}`);
  const plans = useAdminData<{ plans: PlanRow[] }>("/api/admin/plans");
  const d = detail.data;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <AdminNav current="tenants" />
      <AdminGate denied={detail.denied} mfa={detail.mfa} error={detail.error}>
        <Link href="/admin" className="text-sm text-blue-600 underline">← All agencies</Link>
        {!d && <p className="text-sm text-gray-500">Loading…</p>}
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{d.tenant.name}</h2>
              <span className="text-xs text-gray-500">{d.tenant.slug} · created {new Date(d.tenant.createdAt).toLocaleDateString()}</span>
              {d.state && <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[d.state.status] ?? "bg-gray-100"}`}>{d.state.status.replace("_", " ")}</span>}
            </div>
            {d.state?.message && <p className="text-sm text-gray-700">{d.state.message}</p>}

            {d.limits && (
              <section aria-label="Usage" className="rounded border p-4">
                <h2 className="mb-2 font-medium">Usage against effective limits</h2>
                <ul className="grid gap-x-10 gap-y-1 text-sm sm:grid-cols-2">
                  {([["aiTokens", "aiTokensPerMonth", "AI tokens"], ["conversations", "conversationsPerMonth", "Chats and trips"], ["quotations", "quotationsPerMonth", "Quotations"], ["bookings", "bookingsPerMonth", "Bookings"], ["seats", "seats", "Team members"]] as const).map(([m, l, label]) => (
                    <li key={m} className="flex justify-between"><span>{label}</span><span className="text-gray-600">{d.usage[m].toLocaleString()} / {d.limits?.[l] === null ? "unlimited" : d.limits?.[l]?.toLocaleString()}</span></li>
                  ))}
                </ul>
              </section>
            )}

            {plans.data && <Editor key={JSON.stringify(d.subscription)} detail={d} plans={plans.data.plans} onSaved={detail.reload} />}

            <section aria-label="Members" className="rounded border p-4">
              <h2 className="mb-2 font-medium">Members</h2>
              <ul className="space-y-1 text-sm">
                {d.members.map((m) => <li key={m.email}>{m.name ?? m.email} <span className="text-xs text-gray-500">{m.email} · {m.role.toLowerCase()} · 2FA {m.totpEnabled ? "on" : "off"}</span></li>)}
              </ul>
            </section>

            <section aria-label="Recent activity" className="rounded border p-4">
              <h2 className="mb-2 font-medium">Recent activity</h2>
              <ul className="space-y-0.5 text-xs text-gray-600">
                {d.recentAudit.length === 0 && <li>Nothing recorded yet.</li>}
                {d.recentAudit.map((a, i) => <li key={`${a.at}-${i}`}>{new Date(a.at).toLocaleString()} · {a.action}</li>)}
              </ul>
            </section>
          </>
        )}
      </AdminGate>
    </main>
  );
}
