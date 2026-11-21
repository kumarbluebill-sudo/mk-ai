# MK AI Travel – Architecture

## Current state (audited 2026-11-21)

| Area | Status |
| --- | --- |
| Framework | Next.js 16 App Router, React 19, strict TypeScript, Tailwind 3 |
| Database | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`), client in `src/lib/prisma.ts` |
| Suppliers | Viator Partner API v2 integrated (`src/integrations/viator`). Yatra/Klook: not implemented |
| AI | Provider-independent agent with tool calling (`src/server/ai`); Anthropic + OpenAI adapters, fallback, usage logging |
| Auth / tenancy | Auth.js credentials + JWT, `Tenant`/`Membership`, tenant-scoped Prisma client, role permissions |
| Payments, PDF, admin, billing, maps | Not implemented (schema only for payments) |

## Layering

```
src/app          Next.js routes and pages (thin: validate input, call server layer)
src/server       Framework-independent domain logic (auth, tenancy, crypto, AI, pricing)
src/integrations Supplier adapters (one folder per supplier)
src/lib          Shared helpers (prisma client, static destination catalogue)
src/components   React UI
```

Domain logic lives in `src/server` so it can later be extracted into a separate
service (e.g. NestJS) without rewriting business rules.

## Principles

- **No fake inventory.** Anything not coming from a supplier API is labelled an
  estimate / demo (`InventoryStatus.DEMO`, `isEstimate: true`).
- **No fake confirmations.** A booking is confirmed only when a supplier returns a
  confirmation reference.
- **Secrets stay server-side.** Supplier and AI keys are never sent to the browser;
  supplier credentials are stored encrypted (AES-256-GCM).
- **Tenant isolation.** Every tenant-owned row carries `tenantId`; queries are scoped
  by the authenticated session.

See `DEVELOPMENT_PLAN.md` for phases and `API_INTEGRATION_GUIDE.md` for suppliers.
