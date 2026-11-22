"use client";

import { useEffect, useState } from "react";
import type { PricingRule } from "@/server/pricing/rules";

interface Staff {
  userId: string;
  name: string;
}
type Rule = Omit<PricingRule, "createdAt"> & { createdAt: string };

const input = "rounded border px-2 py-1 text-sm w-full";
const PRODUCT_LABEL: Record<string, string> = { activity: "Activities and sightseeing", hotel: "Hotels", flight: "Flights", transfer: "Transfers" };

const blank = { kind: "MARKUP" as "MARKUP" | "COMMISSION", name: "", percentage: "", fixedAmount: "", currency: "INR", supplierKey: "", productType: "", destination: "", userId: "", priority: "100", active: true };
type Form = typeof blank;

function describe(r: Rule, staff: Staff[]): string {
  if (r.kind === "COMMISSION") return `${r.percentage}% of the margin goes to ${staff.find((s) => s.userId === r.userId)?.name ?? "a former team member"}`;
  const what = [r.percentage ? `${r.percentage}%` : null, r.fixedAmount ? `${r.currency} ${r.fixedAmount} per item` : null].filter(Boolean).join(" + ");
  const where = [r.supplierKey && `supplier ${r.supplierKey}`, r.productType && PRODUCT_LABEL[r.productType], r.destination && `destination ${r.destination}`, r.customerId && "one customer"].filter(Boolean).join(", ");
  return `${what} added to supplier cost${where ? ` for ${where}` : " on everything"}`;
}

export default function PricingRules() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pricing/rules")
      .then(async (r) => {
        if (r.status === 403 || r.status === 401) {
          if (!cancelled) setDenied(true);
          return;
        }
        const d = (await r.json()) as { rules?: Rule[]; staff?: Staff[] };
        if (!cancelled) {
          setRules(d.rules ?? []);
          setStaff(d.staff ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the rules");
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    try {
      const res = await fetch(editing ? `/api/pricing/rules/${editing}` : "/api/pricing/rules", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          name: form.name,
          percentage: num(form.percentage),
          fixedAmount: form.kind === "MARKUP" ? num(form.fixedAmount) : null,
          currency: form.currency,
          supplierKey: form.kind === "MARKUP" ? form.supplierKey : "",
          productType: form.kind === "MARKUP" && form.productType ? form.productType : null,
          destination: form.kind === "MARKUP" ? form.destination : "",
          userId: form.kind === "COMMISSION" ? form.userId : "",
          priority: Number(form.priority) || 100,
          active: form.active,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(d.message ?? d.error ?? "Could not save the rule");
      setForm(blank);
      setEditing(null);
      setTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the rule");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this rule? Quotations already made keep the prices they were made with.")) return;
    const res = await fetch(`/api/pricing/rules/${id}`, { method: "DELETE" });
    if (!res.ok) setError("Could not delete the rule");
    setTick((t) => t + 1);
  }

  function edit(r: Rule) {
    setEditing(r.id);
    setForm({ kind: r.kind, name: r.name, percentage: r.percentage?.toString() ?? "", fixedAmount: r.fixedAmount?.toString() ?? "", currency: r.currency, supplierKey: r.supplierKey ?? "", productType: r.productType ?? "", destination: r.destination ?? "", userId: r.userId ?? "", priority: String(r.priority), active: r.active });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (denied) return <main className="mx-auto max-w-3xl p-6 text-sm text-gray-600">Pricing rules are managed by owners, administrators and managers.</main>;

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Pricing rules</h1>
        <p className="mt-1 text-sm text-gray-600">
          The supplier&apos;s own commission is already inside the net price they quote, so only your markup is added here. For each priced item the single most specific matching markup rule applies (supplier, product type and destination each make a rule more specific); if two are equally specific, the lower order number wins. Rules are never stacked. A fixed amount applies only to items in the same currency. Commission rules never change what the customer pays; they record what a team member earns from your margin.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-2 rounded border p-3 text-sm" aria-label={editing ? "Edit rule" : "New rule"}>
        <h2 className="font-medium">{editing ? "Edit rule" : "New rule"}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">
            Type
            <select className={input} value={form.kind} onChange={(e) => set("kind", e.target.value as Form["kind"])} disabled={editing !== null}>
              <option value="MARKUP">Markup (added to the price)</option>
              <option value="COMMISSION">Commission (staff or sub-agent)</option>
            </select>
          </label>
          <label className="text-xs">
            Name
            <input className={input} required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Viator activities" />
          </label>
          <label className="text-xs">
            {form.kind === "MARKUP" ? "Percentage markup" : "Percentage of margin"}
            <input className={input} inputMode="decimal" value={form.percentage} onChange={(e) => set("percentage", e.target.value)} />
          </label>
          {form.kind === "MARKUP" && (
            <label className="text-xs">
              Fixed amount per item
              <span className="flex gap-1">
                <input className={`${input} w-20`} maxLength={3} value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} aria-label="Currency" />
                <input className={input} inputMode="decimal" value={form.fixedAmount} onChange={(e) => set("fixedAmount", e.target.value)} />
              </span>
            </label>
          )}
          {form.kind === "COMMISSION" && (
            <label className="text-xs">
              Team member
              <select className={input} required value={form.userId} onChange={(e) => set("userId", e.target.value)}>
                <option value="">Choose…</option>
                {staff.map((s) => (
                  <option key={s.userId} value={s.userId}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
          {form.kind === "MARKUP" && (
            <>
              <label className="text-xs">
                Only for supplier (optional)
                <input className={input} value={form.supplierKey} onChange={(e) => set("supplierKey", e.target.value)} placeholder="viator, traveldesk…" />
              </label>
              <label className="text-xs">
                Only for product type (optional)
                <select className={input} value={form.productType} onChange={(e) => set("productType", e.target.value)}>
                  <option value="">Any</option>
                  {Object.entries(PRODUCT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Only for destination (optional)
                <input className={input} value={form.destination} onChange={(e) => set("destination", e.target.value)} placeholder="Dubai" />
              </label>
            </>
          )}
          <label className="text-xs">
            Order (lower wins a tie)
            <input className={input} inputMode="numeric" value={form.priority} onChange={(e) => set("priority", e.target.value)} />
          </label>
          <label className="flex items-end gap-2 text-xs">
            <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> Active
          </label>
        </div>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-60">{busy ? "Saving…" : editing ? "Save changes" : "Add rule"}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setForm(blank); }} className="rounded border px-3 py-1.5">Cancel</button>}
        </div>
      </form>

      {rules === null && <p className="text-sm text-gray-500">Loading…</p>}
      {rules && rules.length === 0 && <p className="text-sm text-gray-600">No rules yet. Quotations are priced at the supplier&apos;s net price with no markup until you add one.</p>}
      <ul className="space-y-2">
        {rules?.map((r) => (
          <li key={r.id} className={`rounded border p-3 text-sm ${r.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{r.name || (r.kind === "MARKUP" ? "Markup" : "Commission")}</strong>
              <span className="text-xs text-gray-500">{r.kind === "MARKUP" ? "Markup" : "Commission"} · order {r.priority}{r.active ? "" : " · off"}</span>
            </div>
            <p className="text-xs text-gray-700">{describe(r, staff)}</p>
            <div className="mt-1 flex gap-2 text-xs">
              <button type="button" onClick={() => edit(r)} className="rounded border px-2 py-0.5">Edit</button>
              <button type="button" onClick={() => void remove(r.id)} className="rounded border px-2 py-0.5 text-red-700">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
