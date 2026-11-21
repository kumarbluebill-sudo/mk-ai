import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { e2eDatabase } from "./e2e/database";

// Secrets (AUTH_SECRET, ENCRYPTION_KEY, supplier keys) come from .env.local when running locally; CI sets them.
loadEnv({ path: ".env.e2e", quiet: true });
loadEnv({ path: ".env.local", quiet: true });

const db = e2eDatabase();
const PORT_A = Number(process.env.E2E_PORT ?? 3210);
const PORT_B = PORT_A + 1;

/**
 * Two production servers on two ports, both on the same E2E database. Tests that talk to both prove that
 * rate limits are shared between instances (what Vercel does with many serverless instances).
 *
 * The spawned servers get the E2E database explicitly; Next does not let a .env file override variables
 * that are already set, so production credentials in .env.local can never leak into these tests.
 */
const serverEnv = {
  ...process.env,
  DATABASE_URL: db.pooled,
  DATABASE_URL_UNPOOLED: db.direct,
  AUTH_TRUST_HOST: "true",
  NODE_ENV: "production",
  // Tests must never create real supplier bookings or spend real money.
  TRAVELDESK_ALLOW_LIVE_BOOKING: "false",
  SUPERADMIN_ALLOW_NO_MFA: "false",
};

const server = (port: number) => ({
  command: `npx next start -p ${port}`,
  url: `http://localhost:${port}/api/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  env: serverEnv as Record<string, string>,
});

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT_A}`,
    trace: "retain-on-failure",
    // Locally an already-installed Chromium can be used instead of downloading one.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: [server(PORT_A), server(PORT_B)],
});
