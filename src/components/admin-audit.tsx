"use client";

import { useState } from "react";
import type { AuditRow } from "@/server/admin/audit";
import { AdminGate, AdminNav, useAdminData } from "./admin-ui";

export default function AdminAudit() {
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState("");
  const { data, error, denied, mfa } = useAdminData<{ entries: AuditRow[] }>(`/api/admin/audit${applied ? `?action=${encodeURIComponent(applied)}` : ""}`);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <AdminNav current="audit" />
      <AdminGate denied={denied} mfa={mfa} error={error}>
        <form onSubmit={(e) => { e.preventDefault(); setApplied(action.trim()); }} className="flex gap-2">
          <input className="flex-1 rounded border px-3 py-1.5 text-sm" placeholder="Filter by action prefix, e.g. admin. or booking." value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action filter" />
          <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Filter</button>
        </form>
        {data === null && <p className="text-sm text-gray-500">Loading…</p>}
        {data?.entries.length === 0 && <p className="text-sm text-gray-600">Nothing matches.</p>}
        <ul className="space-y-1">
          {data?.entries.map((e) => (
            <li key={e.id} className="rounded border p-2 text-xs">
              <span className="font-medium">{e.action}</span>
              <span className="text-gray-600"> · {new Date(e.at).toLocaleString()} · {e.tenantName ?? "platform"} · {e.actorEmail ?? "system"}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">The latest 100 entries across all agencies.</p>
      </AdminGate>
    </main>
  );
}
