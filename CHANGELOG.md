# Changelog

## Unreleased

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
