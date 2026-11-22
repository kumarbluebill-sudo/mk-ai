"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function AdminNav({ current }: { current: "tenants" | "plans" | "audit" | "errors" | "system" }) {
  const link = (href: string, label: string, key: string) => (
    <Link href={href} aria-current={current === key ? "page" : undefined} className={`rounded border px-3 py-1 text-sm ${current === key ? "bg-blue-600 text-white" : ""}`}>
      {label}
    </Link>
  );
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-semibold">Platform admin</h1>
      <nav aria-label="Admin sections" className="flex gap-2">
        {link("/admin", "Tenants", "tenants")}
        {link("/admin/plans", "Plans", "plans")}
        {link("/admin/audit", "Audit log", "audit")}
        {link("/admin/errors", "Errors", "errors")}
        {link("/admin/system", "System", "system")}
        <Link href="/dashboard" className="rounded border px-3 py-1 text-sm">Exit</Link>
      </nav>
    </header>
  );
}

/** Loads an admin API and renders the right message when access is refused. */
export function useAdminData<T>(url: string | null): { data: T | null; error: string | null; denied: boolean; mfa: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string | null; denied: boolean; mfa: boolean }>({ data: null, error: null, denied: false, mfa: false });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as T & { error?: string; message?: string };
        if (cancelled) return;
        if (r.ok) setState({ data: d, error: null, denied: false, mfa: false });
        else if (d.error === "MFA_REQUIRED") setState({ data: null, error: d.message ?? null, denied: false, mfa: true });
        else if (r.status === 401 || r.status === 403) setState({ data: null, error: null, denied: true, mfa: false });
        else setState({ data: null, error: d.message ?? d.error ?? "Could not load", denied: false, mfa: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, error: "Could not load", denied: false, mfa: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function AdminGate({ denied, mfa, error, children }: { denied: boolean; mfa: boolean; error: string | null; children: React.ReactNode }) {
  if (mfa) {
    return (
      <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Two-factor authentication is required for platform administrators. <Link href="/settings/security" className="underline">Turn it on</Link>, then sign in again.
      </p>
    );
  }
  // The same wording as a missing page: do not confirm to others that this console exists.
  if (denied) return <p className="text-sm text-gray-600">Not available.</p>;
  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  return <>{children}</>;
}

export const STATUS_STYLE: Record<string, string> = {
  TRIAL: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-green-100 text-green-800",
  PAST_DUE: "bg-amber-100 text-amber-800",
  CANCELLED: "bg-gray-200 text-gray-700",
  SUSPENDED: "bg-red-100 text-red-800",
  TRIAL_ENDED: "bg-red-100 text-red-800",
};
