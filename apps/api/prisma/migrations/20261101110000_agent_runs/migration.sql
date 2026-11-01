-- Agents run for real: per-workspace state and schedule, and a log of every run. The simulated
-- statistics columns go; run counts, success rate and duration are computed from AgentRun.
ALTER TABLE "Agent" ADD COLUMN "key" TEXT;
UPDATE "Agent" SET "key" = CASE "name"
  WHEN 'Survey Programming Agent' THEN 'survey-programming'
  WHEN 'Survey QA Agent' THEN 'survey-qa'
  WHEN 'Research Feasibility Agent' THEN 'feasibility'
  WHEN 'Vendor Recommendation Agent' THEN 'supplier-delivery'
  WHEN 'Panel Engagement Agent' THEN 'panel-engagement'
  WHEN 'Respondent Quality Agent' THEN 'respondent-quality'
  WHEN 'Project Management Agent' THEN 'project-health'
  WHEN 'Data Processing Agent' THEN 'data-processing'
  WHEN 'Reporting Agent' THEN 'reporting'
  WHEN 'CRM and Bidding Agent' THEN 'pipeline-followup'
  WHEN 'Finance Reconciliation Agent' THEN 'finance-overdue'
  WHEN 'Executive Intelligence Agent' THEN 'executive-digest'
  ELSE "id" END;
ALTER TABLE "Agent" ALTER COLUMN "key" SET NOT NULL;
-- Nothing has run yet: every agent starts paused until someone turns it on.
UPDATE "Agent" SET "enabled" = false;
ALTER TABLE "Agent" ALTER COLUMN "enabled" SET DEFAULT false;
ALTER TABLE "Agent" DROP COLUMN "runs30d", DROP COLUMN "successRate", DROP COLUMN "avgSeconds", DROP COLUMN "minutesSaved", DROP COLUMN "costUsd30d", DROP COLUMN "costCapUsd";
ALTER TABLE "Agent" ADD COLUMN "everyMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "state" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "nextRunAt" TIMESTAMP(3),
  ADD COLUMN "lastRunAt" TIMESTAMP(3);
UPDATE "Agent" SET "everyMinutes" = CASE "key"
  WHEN 'supplier-delivery' THEN 240 WHEN 'panel-engagement' THEN 10080 WHEN 'survey-qa' THEN 120
  WHEN 'pipeline-followup' THEN 360 WHEN 'finance-overdue' THEN 360 WHEN 'executive-digest' THEN 10080 ELSE 60 END;
CREATE UNIQUE INDEX "Agent_tenantId_key_key" ON "Agent"("tenantId", "key");

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "examined" INTEGER NOT NULL DEFAULT 0,
    "notifications" INTEGER NOT NULL DEFAULT 0,
    "approvals" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentRun_tenantId_startedAt_idx" ON "AgentRun"("tenantId", "startedAt");
CREATE INDEX "AgentRun_agentId_startedAt_idx" ON "AgentRun"("agentId", "startedAt");
ALTER TABLE "AgentRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AgentRun" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
