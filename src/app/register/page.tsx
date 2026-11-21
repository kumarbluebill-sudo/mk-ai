"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth-shell";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      agencyName: String(form.get("agencyName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Registration failed");
      setLoading(false);
      return;
    }

    const login = await signIn("credentials", { email: payload.email, password: payload.password, redirect: false });
    setLoading(false);
    if (!login || login.error) {
      router.push("/login");
      return;
    }
    router.push("/");
    router.refresh();
  }

  const field = "w-full rounded-lg border px-3.5 py-2.5 text-sm";
  const label = "flex flex-col gap-1.5 text-sm font-medium text-gray-700";
  return (
    <AuthShell title="Create your agency account" subtitle="Start your free trial. No card needed.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className={label}>
          Your name
          <input name="name" required autoComplete="name" className={field} />
        </label>
        <label className={label}>
          Agency name
          <input name="agencyName" required minLength={2} className={field} />
        </label>
        <label className={label}>
          Email
          <input name="email" type="email" required autoComplete="email" className={field} />
        </label>
        <label className={label}>
          Password (min 10 characters)
          <input name="password" type="password" required minLength={10} autoComplete="new-password" className={field} />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button disabled={loading} className="rounded-lg bg-brand-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800 disabled:opacity-60">
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm text-gray-500">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
