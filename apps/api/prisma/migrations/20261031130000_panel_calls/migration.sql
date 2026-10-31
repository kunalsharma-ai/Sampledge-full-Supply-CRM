-- Approved calls to the panel backend, sent at most once by the worker.
CREATE TABLE "PanelCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "panel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "body" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "httpStatus" INTEGER,
    "response" JSONB,
    "error" TEXT,
    "approvalId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "PanelCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PanelCall_tenantId_createdAt_idx" ON "PanelCall"("tenantId", "createdAt");

ALTER TABLE "PanelCall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PanelCall" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PanelCall" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
