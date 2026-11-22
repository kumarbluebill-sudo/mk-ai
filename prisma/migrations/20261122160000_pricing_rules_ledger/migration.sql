-- Pricing rules (conditions on the existing MarkupSetting table) and an append-only ledger. Additive only.
ALTER TABLE "MarkupSetting" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'MARKUP';
ALTER TABLE "MarkupSetting" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MarkupSetting" ADD COLUMN "supplierKey" TEXT;
ALTER TABLE "MarkupSetting" ADD COLUMN "productType" TEXT;
ALTER TABLE "MarkupSetting" ADD COLUMN "destination" TEXT;
ALTER TABLE "MarkupSetting" ADD COLUMN "customerId" TEXT;
ALTER TABLE "MarkupSetting" ADD COLUMN "userId" TEXT;
ALTER TABLE "MarkupSetting" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "MarkupSetting" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotationId" TEXT,
    "bookingId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "supplierKey" TEXT,
    "label" TEXT,
    "ruleId" TEXT,
    "userId" TEXT,
    "reversesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LedgerEntry_tenantId_quotationId_idx" ON "LedgerEntry"("tenantId", "quotationId");
CREATE INDEX "LedgerEntry_tenantId_createdAt_idx" ON "LedgerEntry"("tenantId", "createdAt");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The ledger is history: no row may be changed or removed. Corrections are new rows.
-- (TRUNCATE is not covered, so test databases can still be reset.)
CREATE FUNCTION "ledger_is_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only: add a correcting entry instead of changing or deleting rows';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_no_update_delete"
BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "ledger_is_append_only"();
