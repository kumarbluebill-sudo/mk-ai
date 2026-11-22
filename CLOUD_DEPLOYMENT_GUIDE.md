# Cloud Deployment Guide

## What is running today

| Piece | Where | Notes |
| --- | --- | --- |
| Web app | Vercel project `mk-ai`, production branch `main` | Every push to `main` builds and deploys by itself. |
| Database | Neon Postgres, project branch `production` | App uses the **pooled** URL (`DATABASE_URL`); migrations use the **direct** URL (`DATABASE_URL_UNPOOLED`). |
| Test database | Neon branch `e2e` (created from production, data wiped) | Used only by the end-to-end tests. See TESTING_GUIDE.md. |
| Maps | Mapbox (public `pk.` token) | Falls back to OpenStreetMap tiles without a key. |
| Suppliers | Viator (production key), Traveldesk (**test API**) | Traveldesk bookings are sandbox only. |

Not provided: Redis (not needed any more: rate limits live in Postgres), error reporting, log shipping, uptime monitoring, background workers, document storage, CDN rules. See "Still needed" below.

## Environment variables

`.env.example` is the full list. The ones that matter most (a wrong value here has caused real outages):

| Variable | Rule |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** URL (host contains `-pooler`), no extra quotes. |
| `DATABASE_URL_UNPOOLED` | Neon direct URL, for `prisma migrate`. Not needed at runtime. |
| `AUTH_SECRET` | 32+ characters (`openssl rand -base64 32`). |
| `AUTH_TRUST_HOST` | `true` anywhere except Vercel. Without it **every sign-in returns HTTP 500**. |
| `ENCRYPTION_KEY` | 32 bytes as 64 hex characters or base64. Needed for two-factor. Do not change it once people use two-factor (their secrets become unreadable). |
| `ANTHROPIC_MODEL` / `OPENAI_MODEL` | A model **id** (`claude-sonnet-5-5`), never a display name with spaces. |
| `MAPBOX_API_KEY` | A **public** `pk.` token, restricted to your site URLs in the Mapbox dashboard (it is sent to signed-in browsers for map tiles). |
| `TRAVELDESK_ALLOW_LIVE_BOOKING` | Leave `false`. See "Going live" below. |
| `SUPERADMIN_ALLOW_NO_MFA` | Never `true` in production. |

**The app checks these itself.** `GET /api/health` answers `503` when the database is unreachable and `200 "degraded"` when the database works but the configuration has errors (counts only, no names). Signed in as a platform admin, **/admin/system** lists each problem by variable name with the reason, never the value. The checks are in `src/server/env-check.ts` and each one corresponds to a real mistake made during this project.

## Releasing

1. Push to `main`. Vercel builds (`postinstall` runs `prisma generate`) and deploys; CI runs unit tests, the dependency audit and the end-to-end suite in parallel.
2. **Database changes first.** Migrations are not run by Vercel. Before (or together with) a release that adds one: `npx prisma migrate deploy` against production from a trusted machine. Write migrations so the *previous* version of the code still works against the new schema (add columns as nullable/defaulted, never rename or drop in the same release), because the old deployment keeps serving while the new one builds.
3. After a deploy, check `/api/health` and `/admin/system`.

Rollback: in Vercel, promote the previous deployment ("Instant Rollback"). Database migrations are not rolled back automatically; this is why step 2 asks for backwards-compatible migrations. To undo bad data, restore the Neon branch (below).

## Backups and recovery

Neon keeps a history of the database (point-in-time restore within the plan's retention window; check your plan's window). Useful commands:

```text
neon branches list
neon branches restore production ^self@2026-11-21T08:00:00Z   # restore to a moment, keeping the old state as a backup branch
neon branches create --name investigate --parent production    # a copy to look at without touching production
```

Practise a restore on a copy (`neon branches create`) before you need one. Nothing here has been restored under pressure.

## Going live with real bookings (do not skip)

Placing a real Traveldesk booking needs all of: a Traveldesk **production** API key and base URL, `TRAVELDESK_API_ENV=production`, `TRAVELDESK_ALLOW_LIVE_BOOKING=true`, and **customer payment collection (Razorpay) built**. Confirming a booking charges your supplier balance, and this app does not yet collect the money from your customer. Also confirm with Traveldesk what their `PendingVerification` status means after a confirmation.

## Container option (not used today)

`Dockerfile` builds a standalone image (`BUILD_STANDALONE=1`) with a health check, and `docker-compose.yml` runs Postgres, a migration job and the app locally. It has never been built or run (no Docker on the development machine). Behind any proxy set `AUTH_TRUST_HOST=true` and make the proxy set the `Host` and `X-Forwarded-For` headers correctly: sign-up rate limiting trusts the first `X-Forwarded-For` value, which Vercel sets itself but a bare container does not.

## Still needed for production

- **Uptime monitoring** on `/api/health` (nothing wired; use a free monitor such as UptimeRobot). Server errors are recorded in the app itself and listed at /admin/errors; there is no alerting, so someone has to look. A service such as Sentry would add alerts and browser-side errors.
- Email delivery (invitations, password reset), background jobs, document storage, CDN rules.
- A staging environment. Today there are only production and the test branch.
