-- Finance: multi-currency documents with the rate fixed on each, recorded exchange rates, PO
-- reconciliation, and a panel incentives ledger.
ALTER TABLE "Tenant" ADD COLUMN "baseCurrency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Tenant" ADD COLUMN "pointValue" DOUBLE PRECISION NOT NULL DEFAULT 0.01;
ALTER TABLE "Client" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Vendor" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "PurchaseOrder" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "PurchaseOrder" ADD COLUMN "fxRate" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseOrder" ADD COLUMN "acceptedCompletes" INTEGER;
ALTER TABLE "PurchaseOrder" ADD COLUMN "reconciledAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN "reconcileNote" TEXT;
ALTER TABLE "Payable" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Invoice" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Invoice" ADD COLUMN "fxRate" DOUBLE PRECISION NOT NULL DEFAULT 1;

CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExchangeRate_tenantId_currency_effectiveFrom_idx" ON "ExchangeRate"("tenantId", "currency", "effectiveFrom");

CREATE TABLE "IncentiveEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "panelistId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "valueBase" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "projectId" TEXT,
    "note" TEXT,
    "approvalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncentiveEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IncentiveEntry_tenantId_panelistId_idx" ON "IncentiveEntry"("tenantId", "panelistId");
CREATE INDEX "IncentiveEntry_tenantId_createdAt_idx" ON "IncentiveEntry"("tenantId", "createdAt");

ALTER TABLE "ExchangeRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExchangeRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExchangeRate" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "IncentiveEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncentiveEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IncentiveEntry" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
