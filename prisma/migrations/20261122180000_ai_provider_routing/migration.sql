-- Fallback control, last success time, and richer AI usage records. Additive only.
ALTER TABLE "AiProviderConfig" ADD COLUMN "lastSuccessAt" TIMESTAMP(3);
ALTER TABLE "AiProviderConfig" ADD COLUMN "useAsFallback" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AiUsage" ADD COLUMN "requestedModel" TEXT;
ALTER TABLE "AiUsage" ADD COLUMN "errorCategory" TEXT;
ALTER TABLE "AiUsage" ADD COLUMN "routing" JSONB;
