# Testing Guide

`npm test` runs Vitest (`src/**/*.test.ts`). CI runs typecheck, lint, test and build.

## Covered

- `crypto`: round trip, tamper, wrong key, key length.
- `auth/totp`: RFC 6238 test vectors, drift window, base32.
- `permissions`: role matrix, cost visibility.
- `tenant-scope`: every operation type is forced to the caller's tenant, including upsert and update-moves.
- `auth/register`: validation, hashed password, owner membership, slug collisions, duplicate email.
- `travel/pricing`: markup/tax/discount order, minor-unit precision, mixed currencies rejected.
- `travel/itinerary`: patches change only the target, immutability, renumbering.
- `ai/tools`: all 20 spec tools registered, unconfigured tools return `NOT_CONFIGURED`, validation, permissions, cost hiding, atomic patch batches.
- `ai/agent`: tool loop, error propagation to the model, step limit, usage logging, abort.
- `ai/providers`: provider ordering, fallback, Anthropic/OpenAI message conversion.

## Not covered (needs a database or credentials)

- Prisma queries and the migrations (no database was available when written).
- End-to-end register → login → chat flow, real provider calls, real Viator calls, the SSE stream, the Docker image.
- Cross-tenant access through the HTTP API (the scoping logic is unit tested; the wiring is not).

Suggested next step: add a Postgres service to CI and integration tests for the above, plus Playwright for the chat UI.
