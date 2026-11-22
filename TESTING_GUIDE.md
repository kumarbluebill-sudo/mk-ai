# Testing Guide

Three layers. CI runs all of them on every push (`.github/workflows/ci.yml`).

| Layer | Command | What it needs | Count |
| --- | --- | --- | --- |
| Static | `npm run typecheck`, `npm run lint` | nothing | |
| Unit | `npm test` (Vitest, `src/**/*.test.ts`) | nothing: databases and suppliers are faked | 229 tests |
| End to end | `npm run test:e2e` (Playwright, `e2e/*.spec.ts`) | a **throwaway Postgres**, a production build, a browser | 26 tests |

## Unit tests (what each file protects)

- **Security and tenancy:** `crypto`, `auth/totp` (RFC 6238 vectors), `permissions`, `tenant-scope`, `auth/register`, `same-origin` (CSRF), `rate-limit` (shared and fallback limiter), `team/members` (who can manage whom, cross-agency invisibility), `admin` (platform-admin guard, audit, plan validation), `billing` (limits, trials, suspension).
- **Money and honesty:** `travel/pricing` (minor units, GST split, no lost paisa), `quotation` (no cost or markup shown, "indicative" labels, never says "confirmed"), `booking/*` (price re-check, exact-amount approval, supplier-only CONFIRMED, unknown outcomes, plan checks), `suppliers/*` (parallel search, timeouts, failure isolation, Traveldesk shapes from a real response).
- **Maps and itineraries:** `travel/geo`, `travel/itinerary`, `maps` (Mapbox parsing, token never leaked, one failing day does not hide the others).
- **AI:** `ai/agent`, `ai/tools`, `ai/providers`.
- **Configuration:** `env-check`: every check corresponds to a mistake that actually happened (missing `AUTH_TRUST_HOST`, model display name as model id, key pasted with quotes, hex encryption key).

A few tests earned their keep by finding real bugs before release (a partial plan update that would have reset other fields; a Traveldesk response with null category names). When a test finds a bug, it stays as a regression test.

## End-to-end tests

They start **two** production servers on two ports against one database, and drive real HTTP and a real browser.

| Spec | Proves |
| --- | --- |
| `smoke` | health endpoint (no leaks), security headers incl. enforced CSP, protected pages redirect and APIs answer 401, `/debug` absent, pages render without script errors |
| `pwa` | manifest and every icon exist; service worker registers; offline page appears when the network drops; **the worker stores nothing private** (every cached URL is on a short allow-list after a signed-in session); no CSP violations on the main screens |
| `tenancy` | one agency cannot read, edit, quote, route or list another's trip (404, not 403); another agency sees "not found" in the browser; duplicate emails; a removed member's still-valid session stops working at once |
| `saas` | 14-day Starter trial from plan data; Starter cannot book; team (temporary password, seat limit, role change, removal); admin console closed to everyone without two-factor (with a real TOTP code); plan changes, overrides, suspension, ended trial, all enforced and audited; plans as data |
| `rate-limit` | with 12 simultaneous sign-ups split across **two servers**, exactly 5 succeed; repeated wrong passwords lock the account on both servers |

The rate-limit tests were mutation-checked: with the shared limiter deliberately replaced by a per-process one, 10 sign-ups got through and the lockout test failed. A test that cannot fail proves nothing.

### Running them locally

1. A test database. Locally this is a Neon branch: `neon branches create --name e2e --parent production`, wipe its data, and put its URLs in `.env.e2e` (`E2E_DATABASE_URL` pooled, `E2E_DATABASE_URL_UNPOOLED` direct; the file is git-ignored). Apply migrations to it: `DATABASE_URL_UNPOOLED=<e2e url> npx prisma migrate deploy`.
2. `npm run build`, then `npm run test:e2e`. Set `PW_CHROMIUM` to an installed Chromium to skip the browser download, or run `npx playwright install chromium`.

**The suite refuses to run against production.** `e2e/database.ts` stops the run if the test database host matches the one in `.env.local`. The spawned servers receive the test database explicitly, and `TRAVELDESK_ALLOW_LIVE_BOOKING` is forced to `false`, so tests cannot create supplier bookings. Create the test branch from a database without real customer data, or wipe it, because tests register users and the branch is a copy.

In CI a PostgreSQL 16 service is the database, started empty and migrated from the real migration files, so a broken migration fails the build.

## Not covered

- Real AI provider calls (no AI credit during development): chat is tested with fakes, and the streaming path is only checked by hand with the scripted fallback.
- Real supplier calls in CI. Viator and Traveldesk responses are faked in unit tests. The Traveldesk reserve, confirm, voucher and cancel cycle was run by hand against its test API (and again after each change), but is not automated because it needs a key and creates supplier-side records.
- The Docker image, Razorpay (not built), email (not built), the native Capacitor app (never built on a device), real-device PWA install (only the browser parts are automated), load and performance, accessibility audits, and any browser other than Chromium.
