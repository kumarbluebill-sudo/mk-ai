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
| Rate limits shared by every server instance (Postgres counter; per-process fallback), mutation-tested | `src/server/rate-limit.ts`, `e2e/rate-limit.spec.ts` |
| Configuration errors surfaced (`/api/health` counts, `/admin/system` names) | `src/server/env-check.ts` |
| Service worker caches no user data (checked after a signed-in session) | `public/sw.js`, `e2e/pwa.spec.ts` |
| Content-Security-Policy, **report-only** | `next.config.ts` |
| Role read from the database on every request (removal/demotion is immediate) | `src/server/tenant-context.ts` |
| Platform admin: DB-checked flag, 2FA required, audited, cross-origin writes blocked; no UI to self-promote | `src/server/admin/*`, `scripts/admin-flag.mjs` |
| Plan and subscription limits enforced server-side before billable work | `src/server/billing/limits.ts` |
| Booking money safety: `booking:manage` for confirm/cancel, exact-amount approval, price re-check, live-booking switch, idempotency keys | `src/server/booking/*`, `TRAVELDESK_ALLOW_LIVE_BOOKING` |
| CSRF defence on booking POSTs (Origin check, plus SameSite cookies) | `src/server/same-origin.ts` |
| Supplier voucher link (contains an anonymous-access guid) never stored or sent to the browser | `getVoucher` proxies the PDF |

## Known gaps (do before production)

- **Temporary passwords** for new team members are shown to the owner once and passed on by hand; there is no email invitation or password reset. A password change does not sign out the person's other devices (12-hour sessions).
- The platform admin console exposes every agency's data to anyone with the flag and 2FA: keep the number of administrators tiny.
- **Booking has no customer payment step.** Confirming charges the agency's balance with the supplier. Do not enable live bookings until Razorpay (or another collection step) exists.
- The CSRF Origin check is applied to the booking routes only; apply it to every state-changing route before production.
- **Content-Security-Policy is report-only.** Next.js inline scripts need `'unsafe-inline'` until a per-request nonce is added in `proxy.ts`; the policy is a floor, not a seal. Enforce it after adding nonces and watching the reports.
- Sign-up rate limiting trusts the first `X-Forwarded-For` value. Vercel sets it itself; a bare container behind no proxy would let a client choose it.
- Rate limiting no longer depends on Redis. The Postgres-backed limiter adds one small database call per limited request.
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
