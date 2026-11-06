-- Members moving through active engagement workflows.
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "panelistId" TEXT NOT NULL,
    "nodeId" TEXT,
    "status" TEXT NOT NULL,
    "wakeAt" TIMESTAMP(3),
    "path" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkflowRun_workflowId_panelistId_key" ON "WorkflowRun"("workflowId", "panelistId");
CREATE INDEX "WorkflowRun_tenantId_workflowId_status_wakeAt_idx" ON "WorkflowRun"("tenantId", "workflowId", "status", "wakeAt");
ALTER TABLE "WorkflowRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkflowRun" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
