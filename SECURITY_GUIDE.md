# Security Guide

## Implemented

| Control | Where |
| --- | --- |
| Password hashing (bcrypt, cost 12) | `src/server/auth/password.ts` |
| Sessions: Auth.js JWT, 12h, `AUTH_SECRET` signed | `src/auth.config.ts` |
| Per-account login throttling; register and chat rate limits | `src/server/rate-limit.ts` (in-memory) |
| TOTP two-factor (RFC 6238, tested against its vectors) | `src/server/auth/totp.ts`, `/settings/security`, `/api/auth/mfa/*` |
| Audit log writes | `src/server/audit.ts` |
| Role-based permissions | `src/server/permissions.ts`; enforced in handlers and AI tools |
| Tenant isolation | `src/server/tenant-scope.ts` forces `tenantId` on reads/writes of tenant models |
| Conversation ownership (tenant and customer profile) | `src/app/api/chat/route.ts` |
| Secret encryption at rest (AES-256-GCM) | `src/server/crypto.ts` |
| Input validation (zod) on auth, chat, tools, quick package | throughout |
| Security headers | `next.config.ts` |
| Auth on chat, package, booking and Viator routes | `requireTenantContext` / `guardRoute` |
| Clients cannot set bookings CONFIRMED/REFUNDED | `src/app/api/viator/booking/route.ts` |
| Cost/margin hidden from roles without `cost:view` | pricing tools |
| `/debug` blocked in production | `src/app/debug/layout.tsx` |
| Tool results treated as data in the AI system prompt | `src/server/ai/agent.ts` |

## Known gaps (do before production)

- **Rate limiting is per-process memory**; use Redis before running more than one instance.
- **MFA is optional per user**, not enforceable per tenant yet; there are no recovery codes (a user who loses their authenticator must be reset directly in the database); a TOTP code can be reused within its ~90s window.
- **No CSRF token** beyond Auth.js defaults and same-site cookies; review for any cross-site embedding.
- **No email verification or password reset.**
- **Supplier credential management UI** and key rotation are not built; `ENCRYPTION_KEY` rotation needs a re-encrypt script.
- **Webhook signature verification** (Razorpay) not built because payments are not implemented.
- **Audit log** covers registration, login / MFA failures, MFA changes, quotation creation and booking drafts/status changes. No viewer UI yet.
- **Backups / retention policy** are infrastructure tasks (see CLOUD_DEPLOYMENT_GUIDE).
- Tenant isolation relies on using the scoped client; raw `getPrismaClient()` in a handler bypasses it. Review any new code for that, and consider Postgres row-level security as defence in depth.
- `next-auth` v5 is a beta release.
- The Viator routes `/api/viator/booking` only creates local DRAFT records; no supplier reservation happens.

Never commit `.env`; never send supplier or AI keys to the browser.
