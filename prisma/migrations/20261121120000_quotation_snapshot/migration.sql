-- Immutable copy of what was quoted (document data), so a PDF can be reproduced exactly later.
ALTER TABLE "Quotation" ADD COLUMN "snapshot" JSONB;
