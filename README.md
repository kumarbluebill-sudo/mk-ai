# MK AI Travel

Multi-tenant AI travel planning SaaS by MK Solutions. Travel agencies register their own tenant, chat with an AI consultant that can call controlled backend tools (live Viator activity search and availability, requirements capture, itinerary building, pricing and draft quotations), and keep their data isolated from other agencies.

## What works today

- Agency registration and sign-in (Auth.js credentials, JWT sessions), tenant per agency, role-based permissions.
- Tenant isolation via a scoped Prisma client (`src/server/tenant-scope.ts`).
- AI chat with provider-independent adapters (Anthropic, OpenAI, optional fallback), tool calling, per-conversation memory, token-usage logging and streamed progress.
- Viator Partner API v2: live activity search, product details, availability and pricing.
- Traveldesk test bookings (`/bookings`): reserve, confirm, supplier voucher, cancel. Test environment only; customer payment is not collected yet.
- Installable app (PWA) with an offline page that never stores user data; Capacitor config for an Android/iOS shell (not built on a device).
- Plans and subscriptions (limits are editable data), usage dashboard, team management and a platform admin console. No online billing yet.
- Quotations: priced from the itinerary with optional GST split, stored as an immutable snapshot, downloadable as a PDF.
- Itinerary designer (`/designer`): edit trips manually or after the AI builds them, reorder, map with Mapbox tiles, place search and real driving legs (straight-line estimates when Mapbox is not configured).
- Supplier adapter framework (`src/server/suppliers`): normalised inventory, parallel search with per-supplier timeout, failure isolation, 60s cache, price/rating ranking, budget filter. `GET /api/suppliers/search` and `/api/suppliers/status`.
- Itinerary editing by targeted patches, pricing with markup/tax in exact minor units, draft quotations.
- Docker, docker-compose, CI workflow, health check, 229 unit tests and 26 end-to-end tests.

## What does NOT exist yet

Hotels, flights, transfers (no supplier connected), Yatra/Klook adapters (need official API docs and credentials), maps/routing, PDF generation, payments (Razorpay), booking and vouchers, subscriptions/billing, super-admin and tenant dashboards, PWA service worker and Capacitor. The AI is told it cannot book and the booking/payment tools return `NOT_CONFIGURED`. See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

Viator data is **live only when `VIATOR_API_ENV=production`**; in `sandbox` the tools label results as not live. The destination catalogue (`src/lib/destinations.ts`) and `/api/package/quick` are illustrative estimates, not supplier inventory.

## Requirements

Node.js 20.19+, npm, PostgreSQL 14+ (Docker optional).

## Run locally

1. `npm install`
2. Copy `.env.example` to `.env`; set `DATABASE_URL`, `AUTH_SECRET` and `ENCRYPTION_KEY` (`openssl rand -base64 32` for each).
3. Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for the AI planner, and `VIATOR_*` keys for activity search. Without an AI key the chat falls back to basic scripted replies and says so.
4. Database: `npx prisma migrate deploy`.
   - A database previously created with `prisma db push` has no migration history: first run `npx prisma migrate resolve --applied 20261101000000_init`, then `migrate deploy`. The tenancy migration moves existing rows into a default tenant, so review it first.
5. `npm run dev`, open http://localhost:3000, register an agency at `/register`, then use `/chat`.

Or with Docker: `docker compose up --build` (app on :3000, Postgres, Redis, migrations run automatically).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Development, production build, run build |
| `npm run typecheck` / `lint` / `test` | Quality gates (also run in CI) |
| `npm run test:e2e` | End-to-end tests (needs a throwaway database, see TESTING_GUIDE) |
| `npm run admin:grant -- email` | Make someone a platform administrator (they also need two-factor) |
| `npm run db:generate` | Generate Prisma client |

## Layout

```text
src/app/            Routes and pages (login, register, chat, API handlers)
src/server/         Domain logic: auth, tenancy, permissions, crypto, AI, itinerary, pricing
src/integrations/   Supplier clients (Viator)
src/lib/            Prisma client, editorial catalogue
prisma/             Schema and migrations
```

## Documentation

[ARCHITECTURE](ARCHITECTURE.md) · [DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md) · [DATABASE_SCHEMA](DATABASE_SCHEMA.md) · [API_INTEGRATION_GUIDE](API_INTEGRATION_GUIDE.md) · [SECURITY_GUIDE](SECURITY_GUIDE.md) · [TESTING_GUIDE](TESTING_GUIDE.md) · [CLOUD_DEPLOYMENT_GUIDE](CLOUD_DEPLOYMENT_GUIDE.md) · [MOBILE_APP_GUIDE](MOBILE_APP_GUIDE.md) · [SAAS_SUBSCRIPTION_GUIDE](SAAS_SUBSCRIPTION_GUIDE.md) · [CHANGELOG](CHANGELOG.md)
