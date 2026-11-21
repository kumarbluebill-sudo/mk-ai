"use client";

import type { EnvIssue } from "@/server/env-check";
import { AdminGate, AdminNav, useAdminData } from "./admin-ui";

interface System {
  issues: EnvIssue[];
  database: { ok: boolean; latencyMs: number | null };
  runtime: { node: string; environment: string; commit: string | null; region: string | null };
}

export default function AdminSystem() {
  const { data, error, denied, mfa } = useAdminData<System>("/api/admin/system");
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <AdminNav current="system" />
      <AdminGate denied={denied} mfa={mfa} error={error}>
        {data === null && <p className="text-sm text-gray-500">Loading…</p>}
        {data && (
          <>
            <section aria-label="Runtime" className="rounded border p-4 text-sm">
              <h2 className="mb-2 font-medium">Runtime</h2>
              <p>Database: {data.database.ok ? `reachable (${data.database.latencyMs} ms)` : <strong className="text-red-700">not reachable</strong>}</p>
              <p className="text-gray-600">Node {data.runtime.node} · {data.runtime.environment}{data.runtime.commit ? ` · commit ${data.runtime.commit}` : ""}{data.runtime.region ? ` · ${data.runtime.region}` : ""}</p>
            </section>
            <section aria-label="Configuration" className="rounded border p-4">
              <h2 className="mb-2 font-medium">Configuration checks</h2>
              {data.issues.length === 0 && <p className="text-sm text-green-700">No problems found.</p>}
              <ul className="space-y-1 text-sm">
                {data.issues.map((i) => (
                  <li key={`${i.name}-${i.message}`} className={i.level === "error" ? "text-red-700" : "text-amber-800"}>
                    <strong>{i.level === "error" ? "Error" : "Note"}</strong> · <code>{i.name}</code>: {i.message}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-500">Only variable names are shown, never their values.</p>
            </section>
          </>
        )}
      </AdminGate>
    </main>
  );
}
