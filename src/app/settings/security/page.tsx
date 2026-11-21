"use client";

import Link from "next/link";
import { useState } from "react";
import ChangePasswordForm from "@/components/change-password-form";

type Step = "idle" | "confirm" | "enabled";

export default function SecuritySettingsPage() {
  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState("");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(action: "setup" | "enable" | "disable", body?: object) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/auth/mfa/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        secret?: string;
        otpauthUrl?: string;
      };
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? "Request failed" });
        return null;
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const data = await call("setup");
    if (data?.secret) {
      setSecret(data.secret);
      setUrl(data.otpauthUrl ?? "");
      setStep("confirm");
    }
  }

  async function confirm(action: "enable" | "disable") {
    const data = await call(action, { code });
    if (data) {
      setCode("");
      setStep(action === "enable" ? "enabled" : "idle");
      setMessage({ ok: true, text: action === "enable" ? "Two-factor authentication is on." : "Two-factor authentication is off." });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Security</h1>
        <Link href="/dashboard" className="rounded border px-3 py-1 text-sm">Dashboard</Link>
      </header>
      <ChangePasswordForm />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Two-factor authentication (authenticator app)</h2>

        {step === "idle" && (
          <button onClick={start} disabled={busy} className="self-start rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-60">
            Set up
          </button>
        )}

        {step === "confirm" && (
          <>
            <p className="text-sm">
              Add this key to your authenticator app (Google Authenticator, Authy, 1Password), choosing &quot;enter a setup key&quot;
              with time-based codes. Then enter the 6-digit code it shows.
            </p>
            <code className="break-all rounded bg-gray-100 p-2 text-sm">{secret}</code>
            <a href={url} className="text-sm text-blue-600 underline">
              Open in authenticator app
            </a>
          </>
        )}

        {(step === "confirm" || step === "enabled") && (
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              aria-label="6-digit code"
              className="w-32 rounded border px-3 py-2"
            />
            <button
              onClick={() => confirm(step === "confirm" ? "enable" : "disable")}
              disabled={busy || code.length !== 6}
              className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-60"
            >
              {step === "confirm" ? "Turn on" : "Turn off"}
            </button>
          </div>
        )}

        {message && (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-green-700" : "text-sm text-red-600"}>
            {message.text}
          </p>
        )}
      </section>
    </main>
  );
}
