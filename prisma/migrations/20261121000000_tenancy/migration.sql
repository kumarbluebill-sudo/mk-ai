-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'CONSULTANT', 'SALES', 'ACCOUNTS', 'READONLY');

-- DropIndex
DROP INDEX "SupplierCredential_supplierId_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpSecretEncrypted" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "state" JSONB,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "SupplierCredential" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Itinerary" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "MarkupSetting" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "tenantId" TEXT;

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "customDomain" TEXT,
    "branding" JSONB,
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'CONSULTANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_customDomain_key" ON "Tenant"("customDomain");

-- CreateIndex
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "AiUsage_tenantId_createdAt_idx" ON "AiUsage"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_updatedAt_idx" ON "Conversation"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCredential_tenantId_supplierId_key" ON "SupplierCredential"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "Itinerary_tenantId_updatedAt_idx" ON "Itinerary"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "Quotation_tenantId_createdAt_idx" ON "Quotation"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_tenantId_createdAt_idx" ON "Booking"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_idx" ON "Voucher"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_tenantId_key" ON "CompanySettings"("tenantId");

-- CreateIndex
CREATE INDEX "MarkupSetting_tenantId_idx" ON "MarkupSetting"("tenantId");


-- ---------------------------------------------------------------------------
-- Backfill: existing single-tenant data moves into one default tenant.
-- (Hand-written; review before running against production data.)
-- ---------------------------------------------------------------------------
INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt")
SELECT 'tenant_default', 'MK Solutions', 'mk-solutions', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "slug" = 'mk-solutions');

UPDATE "Customer" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "Conversation" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "SupplierCredential" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "Itinerary" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "Quotation" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "Booking" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "Payment" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "Voucher" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "CompanySettings" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "MarkupSetting" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL;
UPDATE "AuditLog" SET "tenantId" = 'tenant_default' WHERE "tenantId" IS NULL AND "userId" IS NOT NULL;

INSERT INTO "Membership" ("id", "userId", "tenantId", "role")
SELECT 'mem_' || u."id", u."id", 'tenant_default',
  CASE u."role" WHEN 'ADMIN' THEN 'OWNER'::"TenantRole" WHEN 'AGENT' THEN 'CONSULTANT'::"TenantRole" ELSE 'READONLY'::"TenantRole" END
FROM "User" u
ON CONFLICT DO NOTHING;

ALTER TABLE "Customer" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Conversation" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SupplierCredential" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Itinerary" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Quotation" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Booking" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Voucher" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "CompanySettings" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "MarkupSetting" ALTER COLUMN "tenantId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCredential" ADD CONSTRAINT "SupplierCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkupSetting" ADD CONSTRAINT "MarkupSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

