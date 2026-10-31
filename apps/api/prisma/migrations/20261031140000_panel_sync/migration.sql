-- Projects synced to the panels, and the responses imported back from them.
CREATE TABLE "PanelSync" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "panel" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pid" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "syncedBy" TEXT,
    "cursor" TEXT,
    "importedAt" TIMESTAMP(3),
    "importError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PanelSync_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PanelSync_tenantId_panel_projectId_key" ON "PanelSync"("tenantId", "panel", "projectId");

CREATE TABLE "PanelResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "panel" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "responseID" TEXT NOT NULL,
    "respondentID" TEXT,
    "marketID" TEXT,
    "quotaID" TEXT,
    "status" TEXT NOT NULL,
    "qualityReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "loiMinutes" DOUBLE PRECISION,
    "deviceType" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "profile" JSONB,
    "panelUpdatedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PanelResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PanelResponse_tenantId_panel_responseID_key" ON "PanelResponse"("tenantId", "panel", "responseID");
CREATE INDEX "PanelResponse_tenantId_projectId_status_idx" ON "PanelResponse"("tenantId", "projectId", "status");

ALTER TABLE "PanelSync" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PanelSync" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PanelSync" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "PanelResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PanelResponse" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PanelResponse" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
