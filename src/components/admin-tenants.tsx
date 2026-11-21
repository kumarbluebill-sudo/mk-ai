"use client";

import Link from "next/link";
import { useState } from "react";
import type { TenantRow } from "@/server/admin/tenants";
import { AdminGate, AdminNav, STATUS_STYLE, useAdminData } from "./admin-ui";

export default function AdminTenants() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const { data, error, denied, mfa } = useAdminData<{ tenants: TenantRow[] }>(`/api/admin/tenants${applied ? `?q=${encodeURIComponent(applied)}` : ""}`);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <AdminNav current="tenants" />
      <AdminGate denied={denied} mfa={mfa} error={error}>
        <form onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }} className="flex gap-2">
          <input className="flex-1 rounded border px-3 py-1.5 text-sm" placeholder="Search agencies by name or slug" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Search</button>
        </form>
        {data === null && <p className="text-sm text-gray-500">Loading…</p>}
        {data?.tenants.length === 0 && <p className="text-sm text-gray-600">No agencies found.</p>}
        <ul className="space-y-2">
          {data?.tenants.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/tenants/${t.id}`} className="block rounded border p-3 hover:bg-gray-50">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t.name} <span className="text-xs font-normal text-gray-500">{t.slug}</span></span>
                  <span className="flex items-center gap-2 text-xs">
                    {t.subscription && <span>{t.subscription.planName}</span>}
                    <span className={`rounded px-2 py-0.5 font-medium ${STATUS_STYLE[t.state?.status ?? "ACTIVE"] ?? "bg-gray-100"}`}>{(t.state?.status ?? "NO SUBSCRIPTION").replace("_", " ")}</span>
                  </span>
                </span>
                <span className="block text-xs text-gray-600">
                  {t.members} member{t.members === 1 ? "" : "s"} · this month: {t.usage.aiTokens.toLocaleString()} AI tokens, {t.usage.conversations} chats/trips, {t.usage.quotations} quotations, {t.usage.bookings} bookings
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </AdminGate>
    </main>
  );
}
