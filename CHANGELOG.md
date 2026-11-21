# Changelog

## Unreleased

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
