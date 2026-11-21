-- Plans (data, editable by a platform admin) and one subscription per tenant.
-- There is no billing provider yet: status and plan are set by a platform admin.

CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED');

CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "priceMonthlyMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "limits" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "limitOverrides" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Starting plans. These numbers are PLACEHOLDERS, not a commercial offer: edit them in the admin UI.
-- A null limit means unlimited.
INSERT INTO "Plan" ("id", "key", "name", "description", "sortOrder", "limits", "updatedAt") VALUES
  ('plan_starter', 'starter', 'Starter', 'Placeholder limits: edit in the admin console.', 1,
   '{"aiTokensPerMonth":200000,"conversationsPerMonth":50,"quotationsPerMonth":30,"bookingsPerMonth":10,"seats":2,"features":{"ai":true,"bookings":false}}', CURRENT_TIMESTAMP),
  ('plan_growth', 'growth', 'Growth', 'Placeholder limits: edit in the admin console.', 2,
   '{"aiTokensPerMonth":1000000,"conversationsPerMonth":300,"quotationsPerMonth":200,"bookingsPerMonth":100,"seats":5,"features":{"ai":true,"bookings":true}}', CURRENT_TIMESTAMP),
  ('plan_professional', 'professional', 'Professional', 'Placeholder limits: edit in the admin console.', 3,
   '{"aiTokensPerMonth":5000000,"conversationsPerMonth":2000,"quotationsPerMonth":1000,"bookingsPerMonth":500,"seats":15,"features":{"ai":true,"bookings":true}}', CURRENT_TIMESTAMP),
  ('plan_enterprise', 'enterprise', 'Enterprise', 'No limits by default: negotiate and set per tenant.', 4,
   '{"aiTokensPerMonth":null,"conversationsPerMonth":null,"quotationsPerMonth":null,"bookingsPerMonth":null,"seats":null,"features":{"ai":true,"bookings":true}}', CURRENT_TIMESTAMP);

-- Tenants that existed before subscriptions get an ACTIVE Enterprise subscription so nothing they use stops working.
INSERT INTO "Subscription" ("id", "tenantId", "planId", "status", "notes", "updatedAt")
SELECT 'sub_' || t."id", t."id", 'plan_enterprise', 'ACTIVE', 'Backfilled when subscriptions were introduced.', CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."tenantId" = t."id");
