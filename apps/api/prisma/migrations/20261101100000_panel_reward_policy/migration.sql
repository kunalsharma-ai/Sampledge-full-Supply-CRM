-- Versioned panel reward policy (reward categories, redemption threshold, weekly invitation cap).
CREATE TABLE "PanelRewardPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "categories" JSONB NOT NULL,
    "redemptionThreshold" INTEGER NOT NULL,
    "weeklyInviteCap" INTEGER NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PanelRewardPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PanelRewardPolicy_tenantId_version_key" ON "PanelRewardPolicy"("tenantId", "version");
ALTER TABLE "PanelRewardPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PanelRewardPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PanelRewardPolicy" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
