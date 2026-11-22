"use client";

import { useState } from "react";
import type { SupplierAdminRow, SupplierTestResult } from "@/server/suppliers/settings";
import { AdminGate, AdminNav, useAdminData } from "./admin-ui";

function pct(part: number, total: number): string {
  return total ? `${Math.round((part / total) * 100)}%` : "–";
}

function Row({ s, onChanged }: { s: SupplierAdminRow; onChanged: () => void }) {
  const [busy, setBusy] = useState<"toggle" | "test" | null>(null);
  const [test, setTest] = useState<SupplierTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy("toggle");
    setError(null);
    try {
      const res = await fetch(`/api/admin/suppliers/${s.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) });
      if (!res.ok) throw new Error("Could not change the switch");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      const res = await fetch(`/api/admin/suppliers/${s.id}/test`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { result?: SupplierTestResult; message?: string; error?: string };
      if (!res.ok || !d.result) throw new Error(d.message ?? d.error ?? "Test failed");
      setTest(d.result);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }

  const st = s.stats;
  return (
    <li className="rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">
            {s.displayName} <span className="text-xs font-normal text-gray-500">{s.categories.join(", ")}</span>
          </h3>
          <p className="text-xs">
            {s.configured ? (
              <span className="text-green-700">Connected{s.environment ? ` · ${s.environment} API` : ""}</span>
            ) : (
              <span className="text-amber-800">Not connected: {s.reason}</span>
            )}
            {!s.enabled && <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-gray-700">Switched off</span>}
            {s.environment === "sandbox" && s.configured && <span className="ml-2 text-amber-800">Test data only, not sellable inventory</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy !== null} onClick={() => void toggle()} className="rounded border px-3 py-1 disabled:opacity-50">
            {s.enabled ? "Switch off" : "Switch on"}
          </button>
          <button type="button" disabled={busy !== null || !s.configured} onClick={() => void runTest()} className="rounded border px-3 py-1 disabled:opacity-50" title={s.configured ? "Makes one real search" : "Not connected"}>
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-700">
        Last 30 days: {st.calls} request{st.calls === 1 ? "" : "s"}
        {st.calls > 0 && (
          <>
            {" "}
            · {pct(st.ok, st.calls)} answered · {st.timeouts} timed out · {st.errors} errors · average {st.avgLatencyMs} ms
          </>
        )}
        {st.lastCallAt && <> · last request {new Date(st.lastCallAt).toLocaleString()}</>}
      </p>
      {st.lastProblem && (
        <p className="text-xs text-red-700">
          Latest problem ({st.lastProblem.status.toLowerCase()}, {new Date(st.lastProblem.at).toLocaleString()}): {st.lastProblem.message ?? "no details"}
        </p>
      )}
      {test && (
        <p role="status" className={`mt-1 text-xs ${test.status === "OK" ? "text-green-700" : "text-red-700"}`}>
          Test: {test.status} · {test.itemCount} result{test.itemCount === 1 ? "" : "s"} · {test.latencyMs} ms{test.environment ? ` · ${test.environment}` : ""}
          {test.message ? ` · ${test.message}` : ""}
        </p>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </li>
  );
}

export default function AdminSuppliers() {
  const { data, error, denied, mfa, reload } = useAdminData<{ suppliers: SupplierAdminRow[] }>("/api/admin/suppliers");
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <AdminNav current="suppliers" />
      <AdminGate denied={denied} mfa={mfa} error={error}>
        <p className="text-sm text-gray-600">
          Switching a supplier off stops all searches to it within about 30 seconds. Supplier keys are set as environment variables on the server (see the deployment guide); this page never shows them. A supplier that is not connected is never searched and never returns made-up results.
        </p>
        {data === null && <p className="text-sm text-gray-500">Loading…</p>}
        <ul className="space-y-3">{data?.suppliers.map((s) => <Row key={s.id} s={s} onChanged={reload} />)}</ul>
      </AdminGate>
    </main>
  );
}
