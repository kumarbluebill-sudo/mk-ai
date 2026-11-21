"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/auth-shell";

function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      totp: String(form.get("totp") ?? ""),
      redirect: false,
    });
    setLoading(false);
    if (!res || res.error) {
      setError("Invalid email, password or authentication code.");
      return;
    }
    const next = params.get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/chat";
  }

  const field = "w-full rounded-lg border px-3.5 py-2.5 text-sm";
  const label = "flex flex-col gap-1.5 text-sm font-medium text-gray-700";
  return (
    <AuthShell title="Sign in to MK AI Travel" subtitle="Welcome back. Sign in to your agency workspace.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className={label}>
          Email
          <input name="email" type="email" required autoComplete="email" placeholder="you@agency.com" className={field} />
        </label>
        <label className={label}>
          Password
          <input name="password" type="password" required autoComplete="current-password" className={field} />
        </label>
        <label className={label}>
          <span>
            Authentication code <span className="font-normal text-gray-400">(only if you enabled two-factor)</span>
          </span>
          <input name="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className={field} />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button disabled={loading} className="rounded-lg bg-brand-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800 disabled:opacity-60">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-sm text-gray-500">
        New agency?{" "}
        <Link href="/register" className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
