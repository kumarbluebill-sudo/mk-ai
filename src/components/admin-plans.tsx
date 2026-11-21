"use client";

import { useState } from "react";
import type { PlanRow } from "@/server/admin/plans";
import { AdminGate, AdminNav, useAdminData } from "./admin-ui";

const LIMIT_FIELDS = [
  ["aiTokensPerMonth", "AI tokens / month"],
  ["conversationsPerMonth", "Chats and trips / month"],
  ["quotationsPerMonth", "Quotations / month"],
  ["bookingsPerMonth", "Bookings / month"],
  ["seats", "Team members"],
] as const;
type LimitKey = (typeof LIMIT_FIELDS)[number][0];
const input = "rounded border px-2 py-1.5 text-sm";

const EMPTY: Record<LimitKey, string> = { aiTokensPerMonth: "", conversationsPerMonth: "", quotationsPerMonth: "", bookingsPerMonth: "", seats: "" };

function PlanEditor({ plan, onSaved }: { plan: PlanRow | null; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [price, setPrice] = useState(plan?.priceMonthlyMinor != null ? String(plan.priceMonthlyMinor) : "");
  const [active, setActive] = useState(plan?.active ?? true);
  const [limits, setLimits] = useState<Record<LimitKey, string>>(() =>
    plan?.limits ? (Object.fromEntries(LIMIT_FIELDS.map(([k]) => [k, plan.limits?.[k] === null ? "" : String(plan.limits?.[k])])) as Record<LimitKey, string>) : EMPTY
  );
  const [ai, setAi] = useState(plan?.limits?.features.ai ?? true);
  const [bookings, setBookings] = useState(plan?.limits?.features.bookings ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed: Record<string, number | null> = {};
    for (const [k, label] of LIMIT_FIELDS) {
      const v = limits[k].trim();
      if (v === "") parsed[k] = null; // blank means unlimited
      else if (/^\d+$/.test(v)) parsed[k] = Number(v);
      else {
        setMsg({ ok: false, text: `${label}: use a whole number or leave blank for unlimited.` });
        return;
      }
    }
    if (price.trim() !== "" && !/^\d+$/.test(price.trim())) {
      setMsg({ ok: false, text: "Price must be a whole number in paise/cents, or blank." });
      return;
    }
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      priceMonthlyMinor: price.trim() === "" ? null : Number(price),
      limits: { ...parsed, features: { ai, bookings } },
      ...(plan ? { active } : { key: key.trim() }),
    };
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(plan ? `/api/admin/plans/${plan.id}` : "/api/admin/plans", { method: plan ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not save");
      setMsg({ ok: true, text: "Saved." });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded border p-4">
      <h2 className="font-medium">{plan ? `${plan.name} (${plan.key})` : "New plan"}{plan ? <span className="ml-2 text-xs font-normal text-gray-500">{plan.tenants} agenc{plan.tenants === 1 ? "y" : "ies"}</span> : null}</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {!plan && <label className="flex flex-col gap-1 text-xs">Key (permanent)<input required className={input} value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. agency-plus" /></label>}
        <label className="flex flex-col gap-1 text-xs">Name<input required className={input} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs">Monthly price, in paise/cents (display only)<input className={input} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="not shown if blank" /></label>
      </div>
      <label className="flex flex-col gap-1 text-xs">Description<input className={input} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        {LIMIT_FIELDS.map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1 text-xs">{label}
            <input className={input} inputMode="numeric" placeholder="unlimited" value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} /> AI planner</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={bookings} onChange={(e) => setBookings(e.target.checked)} /> Supplier bookings</label>
        {plan && <label className="flex items-center gap-1"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Available to assign</label>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
      <button disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-60">{busy ? "Saving…" : plan ? "Save plan" : "Create plan"}</button>
    </form>
  );
}

export default function AdminPlans() {
  const { data, error, denied, mfa, reload } = useAdminData<{ plans: PlanRow[] }>("/api/admin/plans");
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <AdminNav current="plans" />
      <AdminGate denied={denied} mfa={mfa} error={error}>
        <p className="text-xs text-gray-500">
          Limits are data, not code. Changes apply to every agency on the plan straight away. The starting numbers are placeholders, not a price list. A blank limit means unlimited.
        </p>
        {data === null && <p className="text-sm text-gray-500">Loading…</p>}
        {data?.plans.map((p) => (p.invalidLimits ? <p key={p.id} role="alert" className="text-sm text-red-700">{p.name}: stored limits are invalid and need fixing.</p> : <PlanEditor key={`${p.id}-${JSON.stringify(p.limits)}-${p.active}`} plan={p} onSaved={reload} />))}
        {data && <PlanEditor key="new" plan={null} onSaved={reload} />}
      </AdminGate>
    </main>
  );
}
