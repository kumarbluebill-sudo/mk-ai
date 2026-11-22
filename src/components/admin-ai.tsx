"use client";

import { useState } from "react";
import type { ProviderRow, UsageRow } from "@/server/ai/config";
import { AdminGate, AdminNav, useAdminData } from "./admin-ui";

interface Data {
  providers: ProviderRow[];
  usage: UsageRow[];
}

const input = "rounded border px-2 py-1 text-sm w-full";

function ProviderCard({ p, onChanged }: { p: ProviderRow; onChanged: () => void }) {
  const [model, setModel] = useState(p.model);
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(p.enabled);
  const [useAsFallback, setUseAsFallback] = useState(p.useAsFallback);
  const [models, setModels] = useState<string[] | null>(null);
  const [priority, setPriority] = useState(String(p.priority));
  const [inPrice, setInPrice] = useState(p.inputPricePerM?.toString() ?? "");
  const [outPrice, setOutPrice] = useState(p.outputPricePerM?.toString() ?? "");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | "models" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const configured = p.hasKey || !p.needsKey ? p.health.checkedAt !== null || p.enabled : false;

  async function loadModels() {
    setBusy("models");
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/ai/${p.provider}/models`);
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; models?: string[]; message?: string; error?: string };
      if (!res.ok) throw new Error(d.message ?? d.error ?? "Could not load models");
      if (d.ok && d.models) {
        setModels(d.models);
        setMessage({ ok: true, text: `${d.models.length} model${d.models.length === 1 ? "" : "s"} loaded from the server.` });
      } else {
        setMessage({ ok: false, text: d.message ?? "Could not load models" });
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not load models" });
    } finally {
      setBusy(null);
    }
  }

  async function call(kind: "save" | "test" | "remove") {
    setBusy(kind);
    setMessage(null);
    try {
      const res =
        kind === "save"
          ? await fetch("/api/admin/ai", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                provider: p.provider,
                model,
                baseUrl: baseUrl || undefined,
                apiKey: apiKey || undefined,
                enabled,
                useAsFallback,
                priority: Number(priority) || 100,
                inputPricePerM: inPrice === "" ? null : Number(inPrice),
                outputPricePerM: outPrice === "" ? null : Number(outPrice),
              }),
            })
          : kind === "test"
            ? await fetch(`/api/admin/ai/${p.provider}/test`, { method: "POST" })
            : await fetch(`/api/admin/ai/${p.provider}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; health?: { ok: boolean | null; message: string | null; latencyMs: number | null } };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Failed");
      if (kind === "test" && data.health) setMessage({ ok: data.health.ok === true, text: `${data.health.ok ? "Working" : "Failed"}: ${data.health.message ?? ""}${data.health.latencyMs != null ? ` (${data.health.latencyMs} ms)` : ""}` });
      else setMessage({ ok: true, text: kind === "save" ? "Saved." : "Removed." });
      if (kind === "save") setApiKey("");
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {p.label}
          {p.isPrimary && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-normal text-blue-800">Primary</span>}
          {!p.isPrimary && p.enabled && p.useAsFallback && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-700">Fallback</span>}
        </h3>
        <span className="text-xs text-gray-600">
          {p.health.ok === true && <span className="text-green-700">Working{p.health.latencyMs != null ? ` · ${p.health.latencyMs} ms` : ""}</span>}
          {p.health.ok === false && <span className="text-red-700">Failed: {p.health.message}</span>}
          {p.health.ok === null && (configured ? "Not tested yet" : "Not set up")}
          {p.lastSuccessAt && <span className="ml-2 text-gray-500">Last success {new Date(p.lastSuccessAt).toLocaleString()}</span>}
        </span>
      </div>
      {p.note && <p className="mt-1 text-xs text-gray-600">{p.note}</p>}
      {p.tools === "model" && <p className="mt-1 text-xs text-amber-800">Tool calling depends on the model you choose. The travel assistant needs a model that supports it.</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          Model
          <input className={input} list={`models-${p.provider}`} value={model} onChange={(e) => setModel(e.target.value)} />
          {models && (
            <datalist id={`models-${p.provider}`}>
              {p.provider === "freellmapi" && <option value="auto" />}
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
        </label>
        <label className="text-xs">
          API key {p.hasKey ? `(saved, ends in ${p.keyLast4})` : p.needsKey ? "(required)" : "(not needed)"}
          <input className={input} type="password" autoComplete="off" placeholder={p.hasKey ? "Leave blank to keep the saved key" : ""} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </label>
        {p.defaultBaseUrl !== null && (
          <label className="text-xs sm:col-span-2">
            Base URL <span className="text-gray-500">(blank = {p.defaultBaseUrl})</span>
            <input className={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
        )}
        <label className="text-xs">
          Order (lower runs first)
          <input className={input} inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </label>
        <label className="flex items-end gap-2 text-xs">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
        <label className="flex items-end gap-2 text-xs sm:col-span-2">
          <input type="checkbox" checked={useAsFallback} onChange={(e) => setUseAsFallback(e.target.checked)} /> Use as a fallback when the primary fails (off = this provider only runs if it is the primary)
        </label>
        <label className="text-xs">
          Input price per 1M tokens (optional)
          <input className={input} inputMode="decimal" value={inPrice} onChange={(e) => setInPrice(e.target.value)} />
        </label>
        <label className="text-xs">
          Output price per 1M tokens (optional)
          <input className={input} inputMode="decimal" value={outPrice} onChange={(e) => setOutPrice(e.target.value)} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy !== null} onClick={() => void call("save")} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-60">
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {p.defaultBaseUrl !== null && (
          <button type="button" disabled={busy !== null || (!p.hasKey && p.needsKey)} onClick={() => void loadModels()} className="rounded border px-3 py-1 disabled:opacity-50" title="Asks the server which models it offers (save first)">
            {busy === "models" ? "Loading…" : "Load models"}
          </button>
        )}
        <button type="button" disabled={busy !== null || (!p.hasKey && p.needsKey)} onClick={() => void call("test")} className="rounded border px-3 py-1 disabled:opacity-50">
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        {(p.hasKey || p.health.checkedAt !== null || p.enabled) && (
          <button type="button" disabled={busy !== null} onClick={() => window.confirm(`Remove the saved ${p.label} settings and key?`) && void call("remove")} className="rounded border px-3 py-1 text-red-700 disabled:opacity-50">
            Remove
          </button>
        )}
        {message && <span role="status" className={message.ok ? "text-green-700" : "text-red-700"}>{message.text}</span>}
      </div>
    </li>
  );
}

export default function AdminAi() {
  const { data, error, denied, mfa, reload } = useAdminData<Data>("/api/admin/ai");
  const ordered = data?.providers ? [...data.providers].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.priority - b.priority) : [];
  const primary = ordered.find((p) => p.enabled && (p.hasKey || !p.needsKey));

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <AdminNav current="ai" />
      <AdminGate denied={denied} mfa={mfa} error={error}>
        <p className="text-sm text-gray-600">
          The chat assistant uses the enabled providers in this order, moving to the next one if a provider fails. The first enabled provider is the primary; the others are used only if they are allowed as a fallback. Providers set by environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, FREELLMAPI_API_KEY) are used only while no provider is saved here, so nothing runs behind your back. Keys are stored encrypted and are never shown again.
        </p>
        {data && <p className="text-sm">{primary ? <>Primary now: <strong>{primary.label}</strong> ({primary.model})</> : "No provider is set up here. The assistant uses environment-variable keys if there are any."}</p>}
        {data === null && <p className="text-sm text-gray-500">Loading…</p>}

        {data && data.usage.length > 0 && (
          <section aria-label="Usage" className="overflow-x-auto rounded border p-3">
            <h2 className="mb-2 font-medium">Last 30 days</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr><th>Provider</th><th>Calls</th><th>Failed</th><th>Tokens in / out</th><th>Avg speed</th><th>Failures by cause</th><th>Est. cost</th></tr>
              </thead>
              <tbody>
                {data.usage.map((u) => (
                  <tr key={u.provider} className="border-t">
                    <td className="py-1">{u.provider}</td>
                    <td>{u.calls}</td>
                    <td className={u.failures ? "text-red-700" : ""}>{u.failures}</td>
                    <td>{u.inputTokens.toLocaleString()} / {u.outputTokens.toLocaleString()}</td>
                    <td>{u.avgLatencyMs != null ? `${u.avgLatencyMs} ms` : "–"}</td>
                    <td className="text-xs">{Object.entries(u.errorCategories).map(([k, n]) => `${k.toLowerCase().replace("_", " ")} ${n}`).join(", ") || "–"}</td>
                    <td>{u.estimatedCost != null ? u.estimatedCost.toFixed(4) : "no price set"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-gray-500">Cost is an estimate from the prices you enter below, in whatever currency you enter them. It is not a bill.</p>
          </section>
        )}

        <ul className="space-y-3">{ordered.map((p) => <ProviderCard key={`${p.provider}-${p.health.checkedAt}-${p.model}-${p.keyLast4}-${p.useAsFallback}-${p.isPrimary}`} p={p} onChanged={reload} />)}</ul>
      </AdminGate>
    </main>
  );
}
