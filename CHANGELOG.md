# Changelog

## Unreleased

### Book from a trip
- Traveldesk items in the designer have a **Book** button that opens `/bookings/new` with that tour and the day's date chosen. Only a plain numeric tour id and a valid date are accepted from the link. Availability, price and slots are still checked with the supplier before anything is reserved; nothing is booked from the link itself. Viator items have no booking flow yet, so they get no button. E2E covers it.

### CSP with per-request script nonces
- `src/proxy.ts` now creates a fresh nonce for every page request and sets the Content-Security-Policy (`src/server/csp.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, **no `unsafe-inline` for scripts**. Next.js stamps the nonce on its own scripts. Injected inline handlers and parser-inserted scripts are refused (browser E2E test). Styles still allow inline (React style attributes). The root layout is `force-dynamic`, so every page is rendered per request (the login page is no longer pre-built static HTML). E2E 28/28 including the offline-page and CSP-violation tests.

### Optimise a day by road
- "Optimise order" now asks the Mapbox Optimization API (`POST /api/itineraries/[id]/optimize`) for the best order by road time, applied through a new validated `reorder_day` patch (must list each located stop exactly once). The **first and last stops stay fixed**: a live check showed the API rejects open-ended trips (`destination=any` is `NotImplemented`), and it needs at least 4 located stops and at most 12. When road data is unavailable, too few stops, or any error, the designer falls back to the old straight-line order and **says so** on screen (an estimate). Another agency's trip answers 404. Unit tests cover parsing, rejected answers and the patch; verified against the live API.

### Error log (no third-party service)
- Unhandled server errors are recorded by `src/instrumentation.ts` into a new `ErrorLog` table (migration `error_log`, additive), grouped by fingerprint with a count, and listed at **/admin/errors** (platform admin, 2FA) with a "mark resolved" button. Emails, URLs, tokens and long ids are redacted before storing; recording never throws. Unit tests for redaction, grouping and failure safety; E2E checks the endpoint is closed to non-admins.
- E2E setup now clears the shared rate-limit counters so repeated runs within an hour no longer fail with 429.

### Enforced CSP
- The Content-Security-Policy is now enforced (was report-only). Scripts still allow `unsafe-inline` (nonces not done), so this blocks foreign origins, frames, plugins and form targets but not inline script injection.

### Self-hosted fonts
- DM Sans and DM Serif Display now come from `next/font` (downloaded at build, served from our own domain). Pages no longer contact Google, and the CSP no longer allows fonts.googleapis.com or fonts.gstatic.com. Unit 232, E2E 26/26 (including the CSP-violation browser test) pass.

### Phase 9: installable app (PWA) and native shell
- Installable web app: manifest with icons (192, 512, maskable, Apple touch), shortcuts, install prompt, iOS instructions, offline page and offline banner. Service worker stores **nothing that belongs to a user** (only the offline page and public hashed static files); verified in a real browser after a signed-in session.
- Capacitor Android/iOS shell around the deployed site (`capacitor.config.ts`, `capacitor-web/`). Config loads and `cap add/sync android` succeed. **Not built or run on any device** (no Android SDK); see MOBILE_APP_GUIDE.md for the decisions needed before a store release, including Apple's website-wrapper rule.

### Phase 10: end-to-end tests and deployment hardening
- 26 Playwright end-to-end tests (smoke, PWA, tenancy, plans/team/admin, shared rate limits) against two servers and a real database, plus CI jobs for them (empty Postgres 16, real migrations) and for `npm audit`. The suite refuses to run against production; locally it uses a Neon `e2e` branch. Rate-limit tests were mutation-checked.
- **Rate limits are now shared across server instances** (Postgres `RateLimitBucket`, one atomic upsert; in-memory fallback if the database call fails). Before, each Vercel instance had its own counter, so brute-force limits were weaker than they looked. Migration `rate_limit`.
- Configuration checks (`src/server/env-check.ts`): `/api/health` now reports `down` (503), `degraded` or `ok` with counts; **/admin/system** lists each problem by variable name. Each check is a mistake that really happened in this project.
- Content-Security-Policy in report-only mode; the E2E test immediately caught that Google Fonts were missing from the allow-list.
- Docs: CLOUD_DEPLOYMENT_GUIDE rewritten to match what is actually running (release steps, rollback, backups, going live); TESTING_GUIDE; MOBILE_APP_GUIDE.
- 229 unit tests plus 26 end-to-end tests.

### Phase 8: subscriptions, tenant dashboard, team, platform admin
- Plans as data (`Plan`) and one subscription per agency (`Subscription`, status TRIAL/ACTIVE/PAST_DUE/CANCELLED/SUSPENDED, trial end, per-agency limit overrides). Four starting plans with placeholder limits; existing agencies backfilled to ACTIVE Enterprise; new agencies start a 14-day trial (`TRIAL_DAYS`, `TRIAL_PLAN_KEY`). Migrations `plans_subscriptions`, `must_change_password`.
- Enforcement before billable work: chat (AI feature, token budget, conversation quota), manual trips, quotations (also the AI tool), booking holds (feature + quota; replays are free), team seats. 403 with `PLAN_LIMIT` / `FEATURE_DISABLED` / `SUBSCRIPTION_INACTIVE` and a readable message; suspended, cancelled and trial-ended agencies keep read access.
- Tenant `/dashboard` (plan, status, usage bars, warnings) and `/team` (add with a one-time temporary password, change role, reset, remove) with strict role rules; change-password form in Security.
- Platform admin console (`/admin`, tenants, plans, audit): flag read from the database on every request, two-factor required, every change audited against the affected agency, cross-origin writes blocked. Grant with `npm run admin:grant -- email`.
- Security fix: the user's role is now read from the database on every request. Before, a removed or demoted member kept their old power until the 12-hour sign-in token expired. `Membership` and `Subscription` joined the tenant-scoped models.
- Bug found by a test and fixed before release: a partial plan update would have reset `sortOrder` and `currency` to their defaults.
- 50 end-to-end checks against the real database (trial, limits, suspend, team, admin with real two-factor) plus 50 new unit tests (211 total). The booking page now shows plan messages in chat instead of an error code.
- Not built: Razorpay billing, invoices, email invitations and password reset (see SAAS_SUBSCRIPTION_GUIDE.md).

### Mapbox (finishes phase 5)
- Map tiles are Mapbox's when a public (pk.) token is configured (OpenStreetMap otherwise). The token is served only to signed-in users and a secret (sk.) token is never sent to the browser.
- Real driving legs per day via Mapbox Directions (`GET /api/itineraries/[id]/routes`); legs and day totals are labelled "Mapbox", straight-line guesses stay labelled "estimate". Example: Burj Khalifa to Dubai Marina is 22 km / 21 min by road, the straight-line estimate said 25 km / 50 min.
- "Find on map" place search in the item form (`GET /api/maps/geocode`) using the Search Box API, because Geocoding v6 has no tourist places ("Dubai Frame" returned a street). Results are biased towards the trip's existing stops.
- Mapbox results are never cached on the server. Check Mapbox's terms for your plan before keeping searched coordinates long-term (typed-in coordinates are always fine).
- Not done: Mapbox-based stop ordering (Optimise order is still straight-line), walking legs, multi-day routes, geocoding of existing items.
- 13 new tests (161 total).

### Phase 7: Traveldesk booking flow (test API)
- Reserve (free 15-minute hold) -> confirm (supplier charges the agency balance) -> supplier voucher PDF, plus cancel and refresh. Screens: `/bookings`, `/bookings/new`, `/bookings/[id]`.
- Built from a real run against the test API, which showed: `bookingReference` just echoes our own `referenceNumber`; the supplier's identifier is its numeric booking `id`; a confirmed instant item reports status `PendingVerification` (not `Completed`); cancellation tiers are "hours before pick-up -> refund %" (read off the supplier voucher).
- Honesty rules enforced in code: price, slot and availability are re-checked server-side (client numbers ignored); CONFIRMED only from a supplier response (`traveldesk-status.ts`); an unknown outcome is never reported as confirmed and a POST is never auto-retried; the user must approve the exact amount (`expectedTotal`) and a price change since the hold blocks the charge; the supplier's own status is shown next to ours; test bookings are labelled TEST; customer payment is shown as "not collected".
- Safety: new `booking:manage` permission (owner, admin, manager) for confirm/cancel; `Idempotency-Key` required on reserve (replays return the same booking, races included); `TRAVELDESK_ALLOW_LIVE_BOOKING=true` required to book against a production key; Origin check on POST routes; the supplier's anonymous voucher link is never stored or sent to the browser (voucher is proxied).
- AI still cannot book: `create_booking`, `check_booking_status` and `generate_voucher` stay disabled and point to the Bookings screen.
- Migration `20261121150000_booking_stages` adds `RESERVED` and `PENDING_SUPPLIER`. 32 new tests (149 total).
- Not built: customer payment (Razorpay), our own branded voucher, booking from the itinerary/quotation, email/WhatsApp delivery, on-request approval notifications, Viator booking.

### Traveldesk supplier (test API)
- New supplier `traveldesk` built from Traveldesk's published OpenAPI (`/swagger/b2bpublic/swagger.json`): tours as activities, live per-date availability with seats left and unit prices. Read endpoints only; reserve/confirm/cancel are not wired.
- Treated as test data (`SANDBOX`) unless `TRAVELDESK_API_ENV=production`. Coverage is UAE only: searches that do not mention a UAE place return nothing from it, with a note.
- `check_availability` AI tool takes `supplier` (viator|traveldesk); new `GET /api/suppliers/traveldesk/availability`.
- Response schemas are tolerant (a real response had null category names, caught by testing against the live API). 19 new tests (117 total).

### Phase 6: pricing, GST and PDF quotations
- Pricing engine: Indian GST split (CGST+SGST within a state, IGST across states) with exact-paisa halves; rate is always supplied by the user, no statutory rates or TCS are assumed. Breakdown now has `taxable` and `taxLines`.
- Quotation service shared by the AI tool and the API: creates a DRAFT quotation and stores an immutable `snapshot` (migration `20261121120000_quotation_snapshot`).
- Customer PDF (pdf-lib): company header and GSTIN, day-wise itinerary, package price (cost and markup never shown separately), discount, tax lines, total, validity, notices. Non-supplier-checked items are marked "indicative"; it never claims a confirmed booking.
- API: `POST /api/itineraries/[id]/quotation`, `GET /api/quotations`, `GET /api/quotations/[id]/pdf` (tenant and owner scoped, audited). Quotation panel in the designer.
- Known limits: built-in PDF fonts cannot draw the rupee sign or non-Latin scripts (currency is written as a code, other characters become "?"); no email/WhatsApp delivery; no quotation edit/versioning or status workflow yet.
- 22 new tests (98 total).

### Phase 5 basics: itinerary designer
- `/designer` (trip list, create a trip without the AI) and `/designer/[id]` (edit days and items: add, edit, remove, move up/down/to another day, rename day, add/remove day, optimise order). Edits the same `Conversation.state.itinerary` the AI uses.
- Map (Leaflet + OpenStreetMap tiles, no key) of one day's located items.
- `src/server/travel/geo.ts`: haversine distance, straight-line travel estimates (always labelled estimate), nearest-neighbour ordering, per-day route totals.
- Itinerary patches `move_item` and `optimize_day`; optional `lat`/`lng` on items.
- API: `GET/POST /api/itineraries`, `GET/PATCH /api/itineraries/[id]` (atomic multi-patch, tenant and owner scoped, rate limited). Chat links to the designer.
- 8 new tests (84 total). Verified in a real browser and against Neon, including cross-tenant denial.

### Phase 4: supplier framework
- `SupplierAdapter` interface and normalised `InventoryItem` (integer minor units, `LIVE`/`SANDBOX` status, `checkedAt`).
- Parallel search engine: per-supplier timeout, one failing supplier never affects others, upstream errors hidden from users, 60s in-memory cache, ranking (relevance/price/rating), budget filter that ignores items in other currencies.
- Viator wrapped as the first adapter; Yatra and Klook are declared as `NOT_CONFIGURED` (no endpoints guessed, see API_INTEGRATION_GUIDE).
- `search_activities` AI tool now uses the engine and reports each supplier's status.
- New routes `GET /api/suppliers/search`, `GET /api/suppliers/status`. 15 new tests (76 total).

### Neon
- Database moved to Neon Postgres (`neon.ts`, `neon env pull` writes `DATABASE_URL` pooled and `DATABASE_URL_UNPOOLED` direct). App uses the pooled URL through the existing Prisma + `pg` driver; `prisma.config.ts` uses the direct URL for migrations and now loads `.env.local`.
- Both migrations applied to a fresh Neon database; register, login, chat persistence and cross-tenant denial verified over HTTP.
- Fixed: login returned 500 (`UntrustedHost`) under `next start`; `AUTH_TRUST_HOST` is now documented in `.env.example`.
- Fixed: `ENCRYPTION_KEY` given as 64 hex characters was rejected; hex and base64 are both accepted.
- Pool tuned for Neon, `as any` cast removed from `src/lib/prisma.ts`.

### Added
- Multi-tenancy: `Tenant`, `Membership`, tenant roles, `tenantId` on tenant-owned tables, baseline + tenancy migrations (backfill into a default tenant).
- Auth.js credentials auth, agency registration, `/login`, `/register`, route proxy, rate limits.
- Tenant-scoped Prisma client, permission matrix, AES-256-GCM secret encryption.
- AI engine: Anthropic and OpenAI adapters with fallback, 20-tool registry (9 implemented, 11 explicit NOT_CONFIGURED), agent loop, per-conversation memory, token usage logging.
- Streaming chat API (SSE) and rewritten chat UI with stop button, progress, recent conversations, itinerary cards with LIVE/ESTIMATE/UNVERIFIED badges.
- Itinerary patch engine and exact-precision pricing engine.
- Dockerfile, docker-compose, `/api/health`, GitHub Actions CI, Vitest (61 tests), security headers.
- Documentation set (README, ARCHITECTURE, DEVELOPMENT_PLAN, DATABASE_SCHEMA, API_INTEGRATION_GUIDE, SECURITY_GUIDE, TESTING_GUIDE, CLOUD_DEPLOYMENT_GUIDE, SAAS_SUBSCRIPTION_GUIDE, CLAUDE.md).

- TOTP two-factor authentication (setup page, login check) and audit-log writes.

### Changed
- `/api/chat` now requires auth, no longer trusts client-supplied user ids, and uses the tool-calling agent. Scripted replies only when no AI key is configured, and the UI says so.
- `/api/package/quick` validates input and is labelled `isEstimate`.
- `/api/package/create` and `/api/viator/booking` require auth and tenant context; hardcoded `customerId: "demo"` removed; hardcoded estimates are `DEMO`, not `AVAILABLE`.
- Booking PATCH can no longer set CONFIRMED/REFUNDED; Viator product ids are no longer stored as supplier booking references.
- All Viator routes require sign-in (`/api/viator/init` requires `supplier:manage`).
- `.env.example` moved to the repo root and completed. `/debug` disabled in production.
- Viator routes report `liveInventory: true` only in the production environment (was always true).
