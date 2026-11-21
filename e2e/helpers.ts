import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, request as pwRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import { e2eDatabase } from "./database";

export const PASSWORD = "Sup3r-secret-pw";
export const BASE_A = `http://localhost:${Number(process.env.E2E_PORT ?? 3210)}`;
export const BASE_B = `http://localhost:${Number(process.env.E2E_PORT ?? 3210) + 1}`;

export const unique = (prefix: string) => `${prefix}${Date.now()}${randomBytes(3).toString("hex")}`;

/** A different forwarded IP for every registration, so the 5-per-hour-per-IP limit does not bleed between tests. */
export const freshIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

export async function api(baseURL = BASE_A): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL, extraHTTPHeaders: {} });
}

export async function json<T = Record<string, unknown>>(res: APIResponse): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

export async function register(ctx: APIRequestContext, opts: { email: string; agency: string; name?: string; password?: string; ip?: string }): Promise<APIResponse> {
  return ctx.post("/api/auth/register", {
    headers: { "x-forwarded-for": opts.ip ?? freshIp() },
    data: { name: opts.name ?? "E2E User", email: opts.email, password: opts.password ?? PASSWORD, agencyName: opts.agency },
  });
}

/** Signs in through the real Auth.js credentials flow. Returns true when a session exists afterwards. */
export async function login(ctx: APIRequestContext, email: string, opts: { password?: string; totp?: string } = {}): Promise<boolean> {
  const csrf = (await json<{ csrfToken: string }>(await ctx.get("/api/auth/csrf"))).csrfToken;
  await ctx.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf, email, password: opts.password ?? PASSWORD, totp: opts.totp ?? "", json: "true" },
    maxRedirects: 0,
  });
  // Auth.js answers a literal `null` when nobody is signed in.
  const session = await json<{ user?: unknown } | null>(await ctx.get("/api/auth/session"));
  return Boolean(session?.user);
}

export async function newAgency(prefix: string, baseURL = BASE_A): Promise<{ ctx: APIRequestContext; email: string; agency: string }> {
  const ctx = await api(baseURL);
  const email = `${unique(prefix)}@example.test`;
  const agency = `${prefix} Agency ${unique("")}`;
  expect((await register(ctx, { email, agency })).status()).toBe(201);
  expect(await login(ctx, email)).toBe(true);
  return { ctx, email, agency };
}

// ---------------------------------------------------------------- two-factor codes (RFC 6238, SHA-1, 30 s)
function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// ---------------------------------------------------------------- platform admin (database flag only, as in production)
function adminFlag(action: "grant" | "revoke", email: string): void {
  const db = e2eDatabase();
  execFileSync("node", ["scripts/admin-flag.mjs", action, email], {
    stdio: "pipe",
    // The script prefers DATABASE_URL_UNPOOLED: point it at the test database, never production.
    env: { ...process.env, DATABASE_URL_UNPOOLED: db.direct, DATABASE_URL: db.pooled },
  });
}
export const grantAdmin = (email: string) => adminFlag("grant", email);
export const revokeAdmin = (email: string) => adminFlag("revoke", email);

/** Registers a user, makes them a platform admin and enables real two-factor, then signs in with a code. */
export async function newPlatformAdmin(): Promise<{ ctx: APIRequestContext; email: string }> {
  const ctx = await api();
  const email = `${unique("admin")}@example.test`;
  expect((await register(ctx, { email, agency: `Admin Org ${unique("")}` })).status()).toBe(201);
  expect(await login(ctx, email)).toBe(true);
  grantAdmin(email);
  const setup = await json<{ secret: string }>(await ctx.post("/api/auth/mfa/setup", { data: {} }));
  expect(setup.secret).toBeTruthy();
  expect((await ctx.post("/api/auth/mfa/enable", { data: { code: totpCode(setup.secret) } })).status()).toBe(200);
  const fresh = await api();
  expect(await login(fresh, email, { totp: totpCode(setup.secret) })).toBe(true);
  await ctx.dispose();
  return { ctx: fresh, email };
}
