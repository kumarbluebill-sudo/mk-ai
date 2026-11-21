/**
 * Configuration checks. Most of the production problems this project has hit were not code bugs but
 * quietly wrong settings: a missing AUTH_TRUST_HOST (every login returned 500), a model name with
 * spaces, a key pasted with extra quotes, a hex encryption key where base64 was expected. This turns
 * them into a list that /api/health summarises and the admin "System" page spells out.
 *
 * Values are never returned, only variable names and a short reason.
 */

export interface EnvIssue {
  name: string;
  level: "error" | "warning";
  message: string;
}

type Env = Record<string, string | undefined>;

const has = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

function encryptionKeyLooksValid(v: string): boolean {
  if (/^[0-9a-fA-F]{64}$/.test(v)) return true;
  try {
    return Buffer.from(v, "base64").length === 32;
  } catch {
    return false;
  }
}

export function checkEnvironment(env: Env = process.env): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const add = (name: string, level: EnvIssue["level"], message: string) => issues.push({ name, level, message });
  const production = env.NODE_ENV === "production";

  // ---- core
  if (!has(env.DATABASE_URL)) {
    add("DATABASE_URL", "error", "Not set.");
  } else {
    let host = "";
    try {
      host = new URL(env.DATABASE_URL).host;
    } catch {
      add("DATABASE_URL", "error", "Is not a valid URL (check for stray quotes or spaces).");
    }
    if (host.endsWith("neon.tech") && !host.includes("-pooler")) {
      add("DATABASE_URL", "warning", "Points at the direct Neon host. The app should use the pooled (-pooler) URL; keep the direct one in DATABASE_URL_UNPOOLED for migrations.");
    }
  }

  if (!has(env.AUTH_SECRET)) add("AUTH_SECRET", "error", "Not set: sign-in cannot work.");
  else if (env.AUTH_SECRET.length < 32) add("AUTH_SECRET", "error", "Shorter than 32 characters. Generate one with `openssl rand -base64 32`.");

  const onVercel = has(env.VERCEL);
  if (production && !onVercel && env.AUTH_TRUST_HOST !== "true" && !has(env.AUTH_URL)) {
    add("AUTH_TRUST_HOST", "error", "Outside Vercel, set AUTH_TRUST_HOST=true (behind a proxy that sets Host correctly) or AUTH_URL. Without it every sign-in returns HTTP 500.");
  }

  if (!has(env.ENCRYPTION_KEY)) add("ENCRYPTION_KEY", "error", "Not set: two-factor authentication and stored secrets cannot work.");
  else if (!encryptionKeyLooksValid(env.ENCRYPTION_KEY)) add("ENCRYPTION_KEY", "error", "Must be 32 bytes as 64 hex characters or base64.");

  // ---- AI
  if (!has(env.ANTHROPIC_API_KEY) && !has(env.OPENAI_API_KEY)) {
    add("ANTHROPIC_API_KEY", "warning", "No AI provider key is set, so chat falls back to basic scripted replies.");
  }
  for (const name of ["ANTHROPIC_MODEL", "OPENAI_MODEL"]) {
    const v = env[name];
    if (has(v) && /\s/.test(v.trim())) add(name, "error", "Looks like a display name, not a model id (it contains spaces).");
  }
  for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "VIATOR_SANDBOX_KEY", "VIATOR_PRODUCTION_KEY", "TRAVELDESK_API_KEY", "MAPBOX_API_KEY"]) {
    const v = env[name];
    if (has(v) && /["'\s]/.test(v.trim())) add(name, "error", "Contains a quote or whitespace, which usually means it was pasted with extra quotes. The provider will reject it.");
  }

  // ---- suppliers and maps
  const viatorProd = env.VIATOR_API_ENV === "production";
  if (viatorProd && !has(env.VIATOR_PRODUCTION_KEY)) add("VIATOR_PRODUCTION_KEY", "error", "VIATOR_API_ENV is production but no production key is set.");
  if (!viatorProd && !has(env.VIATOR_SANDBOX_KEY)) add("VIATOR_SANDBOX_KEY", "warning", "Viator is not configured; activity search from Viator is off.");
  if (!has(env.TRAVELDESK_API_KEY)) add("TRAVELDESK_API_KEY", "warning", "Traveldesk is not configured; UAE tours and test bookings are off.");
  if (env.TRAVELDESK_API_ENV === "production" && env.TRAVELDESK_ALLOW_LIVE_BOOKING === "true") {
    add("TRAVELDESK_ALLOW_LIVE_BOOKING", "warning", "REAL bookings are enabled. Confirming charges your supplier balance and this app does not collect customer payment yet.");
  }
  if (!has(env.MAPBOX_API_KEY)) add("MAPBOX_API_KEY", "warning", "Mapbox is not configured; maps use OpenStreetMap tiles and straight-line estimates.");
  else if (!env.MAPBOX_API_KEY.trim().startsWith("pk.")) {
    add("MAPBOX_API_KEY", "warning", "Not a public (pk.) token: it is kept off the browser, so the map falls back to OpenStreetMap and Mapbox search and routing are off.");
  }

  // ---- safety switches that must not be left on
  if (production && env.SUPERADMIN_ALLOW_NO_MFA === "true") {
    add("SUPERADMIN_ALLOW_NO_MFA", "error", "Platform admins can sign in without two-factor authentication. Remove this in production.");
  }

  return issues;
}

export function summarise(issues: EnvIssue[]): { errors: number; warnings: number } {
  return { errors: issues.filter((i) => i.level === "error").length, warnings: issues.filter((i) => i.level === "warning").length };
}
