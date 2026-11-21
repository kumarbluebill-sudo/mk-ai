"use client";

import { useState } from "react";

export default function ChangePasswordForm() {
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.newPassword !== f.confirm) {
      setMsg({ ok: false, text: "The new passwords do not match." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: f.currentPassword, newPassword: f.newPassword }),
      });
      const d = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not change the password");
      setF({ currentPassword: "", newPassword: "", confirm: "" });
      setMsg({ ok: true, text: "Password changed." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not change the password" });
    } finally {
      setBusy(false);
    }
  }

  const input = "rounded border px-3 py-2 text-sm";
  return (
    <section aria-label="Change password" className="space-y-2 rounded border p-4">
      <h2 className="font-medium">Change password</h2>
      <form onSubmit={submit} className="flex max-w-sm flex-col gap-2">
        <input className={input} type="password" required autoComplete="current-password" placeholder="Current password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} aria-label="Current password" />
        <input className={input} type="password" required minLength={10} autoComplete="new-password" placeholder="New password (10+ characters)" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} aria-label="New password" />
        <input className={input} type="password" required minLength={10} autoComplete="new-password" placeholder="Repeat the new password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} aria-label="Repeat new password" />
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
        <button disabled={busy} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60">{busy ? "Saving…" : "Change password"}</button>
      </form>
      <p className="text-xs text-gray-500">Other devices stay signed in until their session ends (12 hours).</p>
    </section>
  );
}
