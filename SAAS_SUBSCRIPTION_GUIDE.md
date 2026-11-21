# SaaS Subscription Guide (design only: not implemented)

What exists: `Tenant.planId` (placeholder), `Membership` roles, `AiUsage` token metering per tenant. Nothing enforces limits or bills yet.

## Planned model (Phase 8)

- `Plan` table with **configurable** limits (never hard-coded): monthly AI requests/tokens, itineraries, staff seats, enabled suppliers/features, API access, white-label.
- `Subscription` (tenant, plan, status: TRIAL/ACTIVE/PAST_DUE/CANCELLED, billing interval, period start/end, trial end) and `Invoice`.
- Super-admin UI to edit plans, assign plans, override limits per tenant.
- Enforcement point: a single `assertWithinLimit(tenant, metric)` called from the chat route, tool execution and itinerary/quotation creation, reading usage from `AiUsage` and counts.
- Billing: Razorpay subscriptions with webhook signature verification, payment-failure grace period, upgrade/downgrade proration, invoice generation (GST).

Tier names from the product brief: Starter, Growth, Professional, Enterprise. Their limits are data to be set in the admin UI, not constants in code.
