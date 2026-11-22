-- Platform switch per supplier and a log of real supplier requests. New tables only.
CREATE TABLE "SupplierSetting" (
    "supplierId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierSetting_pkey" PRIMARY KEY ("supplierId")
);

CREATE TABLE "SupplierCall" (
    "id" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupplierCall_supplier_createdAt_idx" ON "SupplierCall"("supplier", "createdAt");
