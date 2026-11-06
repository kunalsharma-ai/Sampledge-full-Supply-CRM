-- SUPPLY360 working records (weekly programme, reports, campaigns, tickets, cases, workflows ...).
CREATE TABLE "SupplyRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplyRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplyRecord_tenantId_ref_key" ON "SupplyRecord"("tenantId", "ref");
CREATE INDEX "SupplyRecord_tenantId_kind_updatedAt_idx" ON "SupplyRecord"("tenantId", "kind", "updatedAt");
ALTER TABLE "SupplyRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplyRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplyRecord" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));

-- A quota cell an operator closed early counts as full until reopened.
ALTER TABLE "QuotaCell" ADD COLUMN "closedAt" TIMESTAMP(3);
