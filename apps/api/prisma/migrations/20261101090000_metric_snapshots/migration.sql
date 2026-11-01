-- Daily business-metric history for Command Center trends and period comparisons.
CREATE TABLE "MetricSnapshot" (
    "tenantId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("tenantId", "day", "key")
);
CREATE INDEX "MetricSnapshot_tenantId_key_day_idx" ON "MetricSnapshot"("tenantId", "key", "day");
ALTER TABLE "MetricSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MetricSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MetricSnapshot" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
