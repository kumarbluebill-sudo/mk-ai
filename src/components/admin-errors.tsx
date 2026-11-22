"use client";

import { useState } from "react";
import type { ErrorRow } from "@/server/observability/errors";
import { AdminGate, AdminNav, useAdminData } from "./admin-ui";

export default function AdminErrors() {
  const [all, setAll] = useState(false);
  const { data, error, denied, mfa, reload } = useAdminData<{ errors: ErrorRow[] }>(`/api/admin/errors${all ? "?all=1" : ""}`);
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(id: string) {
    setBusy(id);
    try {
      await fetch("/api/admin/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    } finally {
      setBusy(null);
      reload();
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <AdminNav current="errors" />
      <AdminGate denied={denied} mfa={mfa} error={error}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show resolved too
        </label>
        {data === null && <p className="text-sm text-gray-500">Loading…</p>}
        {data && data.errors.length === 0 && <p className="text-sm text-green-700">No {all ? "" : "open "}errors recorded.</p>}
        <ul className="space-y-3">
          {data?.errors.map((e) => (
            <li key={e.id} className="rounded border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{e.name}</strong>
                <span className="text-xs text-gray-500">
                  {e.count}× · {e.source}
                  {e.route ? ` · ${e.route}` : ""} · last {new Date(e.lastSeen).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 break-words">{e.message || "(no message)"}</p>
              {e.stack && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-gray-600">Stack (redacted)</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-gray-700">{e.stack}</pre>
                </details>
              )}
              {!e.resolved && (
                <button type="button" disabled={busy === e.id} onClick={() => resolve(e.id)} className="mt-2 rounded border px-2 py-1 text-xs">
                  Mark resolved
                </button>
              )}
              {e.resolved && <span className="mt-2 inline-block text-xs text-gray-500">Resolved</span>}
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">Emails, links, tokens and long ids are removed before an error is stored. Errors that repeat are counted, not duplicated.</p>
      </AdminGate>
    </main>
  );
}
