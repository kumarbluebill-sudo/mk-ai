# CLAUDE.md

MK AI Travel: multi-tenant AI travel planning SaaS (Next.js 16, Prisma 7, PostgreSQL).

## Commands
- `npm run dev` / `npm run build` / `npm run typecheck` / `npm run lint`
- `npm run db:generate`, `npm run db:push`

## Rules
- Preserve working Viator integration (`src/integrations/viator`) and existing routes.
- Domain logic goes in `src/server`; route handlers stay thin.
- Never fabricate supplier inventory, availability, prices or booking references.
  Anything not from a supplier API must be labelled estimate/demo.
- Never expose secrets to the browser; never commit `.env`.
- Validate input with zod; strict TypeScript, no `any` casts.
- Tenant-owned data must always be scoped by `tenantId`.
- Do not invent supplier endpoints; see `API_INTEGRATION_GUIDE.md`.
