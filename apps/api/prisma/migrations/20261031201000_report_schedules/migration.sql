-- Scheduled report deliveries to clients.
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "weekday" INTEGER,
    "hourUtc" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "lastDeliverableId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReportSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ReportSchedule_active_nextRunAt_idx" ON "ReportSchedule"("active", "nextRunAt");
ALTER TABLE "ReportSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportSchedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReportSchedule" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
