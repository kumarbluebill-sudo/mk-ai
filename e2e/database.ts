/**
 * Which database the E2E run may touch. This is the single most important safety rule of the suite:
 * tests register users, create trips and suspend agencies, so they must never run against production.
 *
 *   CI:    DATABASE_URL points at the throwaway Postgres service.
 *   Local: .env.e2e points at a Neon branch created for tests (E2E_DATABASE_URL[_UNPOOLED]).
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.e2e", quiet: true });

export interface E2eDatabase {
  pooled: string;
  direct: string;
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

export function e2eDatabase(): E2eDatabase {
  const ci = process.env.CI === "true";
  const pooled = process.env.E2E_DATABASE_URL ?? (ci ? process.env.DATABASE_URL : undefined);
  const direct = process.env.E2E_DATABASE_URL_UNPOOLED ?? (ci ? process.env.DATABASE_URL : undefined) ?? pooled;
  if (!pooled || !direct) {
    throw new Error("E2E needs a test database: set E2E_DATABASE_URL (and E2E_DATABASE_URL_UNPOOLED) in .env.e2e, or DATABASE_URL in CI.");
  }

  if (!ci) {
    // Outside CI, refuse anything that looks like the production database from .env.local.
    loadEnv({ path: ".env.local", quiet: true });
    const prodHosts = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].map(hostOf).filter(Boolean).map((h) => h.replace("-pooler", ""));
    const mine = [hostOf(pooled), hostOf(direct)].map((h) => h.replace("-pooler", ""));
    if (mine.some((h) => prodHosts.includes(h))) {
      throw new Error("Refusing to run E2E: the test database is the same as the production database in .env.local.");
    }
  }
  return { pooled, direct };
}
