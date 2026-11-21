# SaaS Subscription Guide

Plans, subscriptions, usage limits, the tenant dashboard, team management and the platform admin console are built (Phase 8). **There is no payment provider yet**: nobody is billed, no invoices are produced, and a platform administrator sets each agency's plan and status by hand.

## How it works

- **Plans are data** (`Plan` table, edited in `/admin/plans`). Limits are never constants in code. A blank/`null` limit means unlimited. The four starting plans (Starter, Growth, Professional, Enterprise) use **placeholder numbers, not a price list**.
- **One subscription per agency** (`Subscription`): plan, status (`TRIAL`, `ACTIVE`, `PAST_DUE`, `CANCELLED`, `SUSPENDED`), trial end, per-agency `limitOverrides` and private notes.
- **New agencies** start a trial on `TRIAL_PLAN_KEY` (default `starter`) for `TRIAL_DAYS` (default 14). Agencies that existed before this feature were given an ACTIVE Enterprise subscription so nothing stopped working.
- **Usage** is measured per calendar month (UTC): AI tokens, trips and chats started, quotations, supplier bookings (failed attempts do not count), and team seats.
- **Enforcement** (`src/server/billing/limits.ts`): `assertWithinLimit` and `assertFeature` run before billable work: starting a chat (AI feature + token budget + conversation quota), creating a manual trip, creating a quotation (also from the AI tool), placing a booking hold (feature + quota; a replayed idempotent request is free), and adding a team member (seats). Refusals are HTTP 403 with `PLAN_LIMIT`, `FEATURE_DISABLED` or `SUBSCRIPTION_INACTIVE` and a plain-language message.
- **Status meaning:** `TRIAL` works until the trial end, then is blocked. `ACTIVE` works. `PAST_DUE` works with a warning (the admin decides when to suspend). `CANCELLED`, `SUSPENDED` and an ended trial block all new billable work but leave sign-in and read access, so an agency can still see and export its data.
- The AI token limit is checked before a message starts, so one message can overshoot the limit slightly.

## Screens

| Screen | Who | What |
| --- | --- | --- |
| `/dashboard` | everyone in an agency | plan, status, trial days, usage bars, warnings (suspended, temporary password, no 2FA) |
| `/team` | owner, admin | add a member (temporary password shown once), change role, new temporary password, remove |
| `/settings/security` | everyone | two-factor and change password |
| `/admin`, `/admin/tenants/[id]` | platform admin | search agencies, plan, status, trial, limit overrides, notes, usage, members, recent activity |
| `/admin/plans` | platform admin | create and edit plans and their limits |
| `/admin/audit` | platform admin | audit log across agencies |

## Platform administrator access

There is deliberately **no screen to become an administrator**. From a trusted shell with database access:

```text
npm run admin:grant  -- someone@example.com
npm run admin:revoke -- someone@example.com
```

The person must already have an account and must turn on two-factor authentication (Settings > Security) before the console opens (`SUPERADMIN_ALLOW_NO_MFA=true` waives this; do not use it in production). The flag is read from the database on every request, never from the session. Everything an administrator changes is written to the audit log against the affected agency. People who are not administrators are told "Not available".

## Team rules

- The owner manages everyone below owner and is the only one who can make an admin. An admin manages roles below admin. Nobody can assign owner, change the owner, or change/remove themselves here.
- There is no email delivery yet, so a new member (or a reset) gets a **temporary password shown once**, which the owner must pass on securely, and the member is asked to change it.
- **Removing or demoting someone takes effect immediately**: the role is read from the database on every request, not from the sign-in token.

## Not built (needs a payment provider and decisions)

- Razorpay subscriptions, webhooks (signature verification), payment-failure grace periods, proration, GST invoices, receipts.
- Self-service plan upgrade/downgrade, plan comparison page, usage alerts by email, white-label branding and custom domains, public API keys, per-tenant supplier credentials UI, usage export.
- Email invitations and password reset (needs an email provider).
