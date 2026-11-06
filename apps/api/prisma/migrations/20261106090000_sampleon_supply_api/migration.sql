-- SAMPLEON integration: profile attributes, survey cards, participation history, inbound event log.
CREATE TABLE "PanelistAttribute" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "panelistId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNum" DOUBLE PRECISION,
    "valueBool" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT 'profile',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PanelistAttribute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PanelistAttribute_panelistId_key_key" ON "PanelistAttribute"("panelistId", "key");
CREATE INDEX "PanelistAttribute_tenantId_key_idx" ON "PanelistAttribute"("tenantId", "key");

CREATE TABLE "SurveyCard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "audienceRequestId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "panelistId" TEXT NOT NULL,
    "panel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cardUrl" TEXT NOT NULL,
    "loiMinutes" INTEGER NOT NULL,
    "rewardPoints" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "emailed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveyCard_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SurveyCard_tenantId_panelistId_createdAt_idx" ON "SurveyCard"("tenantId", "panelistId", "createdAt");
CREATE INDEX "SurveyCard_tenantId_audienceRequestId_idx" ON "SurveyCard"("tenantId", "audienceRequestId");

CREATE TABLE "Participation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "audienceRequestId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "panelistId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rewardEntryId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Participation_sessionId_key" ON "Participation"("sessionId");
CREATE INDEX "Participation_tenantId_panelistId_idx" ON "Participation"("tenantId", "panelistId");
CREATE INDEX "Participation_tenantId_surveyId_idx" ON "Participation"("tenantId", "surveyId");

CREATE TABLE "InboundEvent" (
    "eventId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("eventId")
);
ALTER TABLE "PanelistAttribute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PanelistAttribute" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PanelistAttribute" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "SurveyCard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SurveyCard" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SurveyCard" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "Participation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Participation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Participation" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "InboundEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InboundEvent" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
