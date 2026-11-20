# MK AI Travel

MK AI Travel is the Phase 1 foundation for a conversational travel-planning platform by MK Solutions. It includes a responsive workspace, searchable editorial destination examples, local recent-trip history, and a PostgreSQL/Prisma domain schema ready for the next phases.

## Current scope

- Responsive travel workspace with sidebar navigation, prompt composer, destination cards and destination detail view.
- Search endpoint backed by a small editorial destination catalogue.
- Recent trip titles persist in the browser's local storage.
- Destination budgets are labelled as illustrative sample ideas. Search results are marked `DEMO DATA`; there is no live hotel, flight or activity availability.
- Prisma schema for customers, conversations, travel requirements, inventory, itinerary, quotations, bookings, payments, vouchers, company settings, markups and audit logs.
- PWA web manifest.

Supplier booking, payments, authentication, admin management, PDFs and AI responses are not wired in this foundation. Yatra and Klook require authorized supplier documentation and credentials before their live adapters can be implemented. Do not represent the sample catalogue as live supplier inventory.

## Requirements

- Node.js 20.9 or later
- npm
- PostgreSQL 14 or later for database work

## Run locally in VS Code

1. Open this folder in VS Code and open a terminal.
2. Install packages: `npm install`
3. Copy `.env.example` to `.env` and set `DATABASE_URL` to your PostgreSQL database.
4. Start the interface: `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000).

The demo destination search can be used without PostgreSQL. To validate and create Prisma Client, run `npm run db:generate`. To create/update a development database schema, run `npm run db:push`. Use `npm run db:studio` to browse the database.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:push` | Apply schema to development database |
| `npm run db:studio` | Open Prisma Studio |

## Architecture

```text
src/app/                  Next.js routes, API route, PWA manifest and UI
src/lib/destinations.ts   Editorial demo destination catalogue
prisma/schema.prisma      PostgreSQL domain schema
```

The inventory models distinguish `DEMO` from supplier-confirmed `AVAILABLE` results. Future suppliers should implement a shared adapter contract under `src/integrations/<supplier>`; keep keys server-side, record the supplier response and verification timestamp, and only treat an availability result as confirmed when returned by that supplier.

## Security and production notes

This is a development foundation, not a production booking system. Before handling customer accounts or money, add a reviewed authentication provider and role checks, encrypt credentials using a managed key service, implement supplier idempotency and webhook signature verification, validate every server input, add rate limiting and audit coverage, and configure backups/monitoring. Never put supplier or payment secrets in browser code. Keep environment files out of source control.

## Deployment

Deploy the Next.js application to Vercel after configuring the production build and environment variables. Host PostgreSQL and, in later phases, Redis/job processing in managed services reachable by the runtime. Run Prisma migrations as a controlled release step and configure the production `DATABASE_URL` in the hosting provider. Android packaging and backend job services are future phases.

## API

See [docs/API.md](docs/API.md) for the current destination-search contract and planned integration boundaries.
