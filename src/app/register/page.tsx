"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
    router.push("/chat");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Create your agency account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Your name
          <input name="name" required autoComplete="name" className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Agency name
          <input name="agencyName" required minLength={2} className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input name="email" type="email" required autoComplete="email" className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password (min 10 characters)
          <input
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="rounded border px-3 py-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button disabled={loading} className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-60">
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="text-sm">
        Already registered?{" "}
        <Link href="/login" className="text-blue-600 underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
