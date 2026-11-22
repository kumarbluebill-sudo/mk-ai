-- Platform-level AI provider settings (super admin) and richer AI usage records. Additive only.
ALTER TABLE "AiUsage" ADD COLUMN "latencyMs" INTEGER;
ALTER TABLE "AiUsage" ADD COLUMN "ok" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AiUsage" ADD COLUMN "costMicros" INTEGER;
CREATE INDEX "AiUsage_provider_createdAt_idx" ON "AiUsage"("provider", "createdAt");

CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "encryptedKey" TEXT,
    "keyLast4" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "inputPricePerM" DECIMAL(12,4),
    "outputPricePerM" DECIMAL(12,4),
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckMessage" TEXT,
    "lastLatencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiProviderConfig_provider_key" ON "AiProviderConfig"("provider");
