-- Client self-service studies: one project and one survey each, launched behind an approval.
CREATE TABLE "SelfServeStudy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "audience" "Audience" NOT NULL,
    "countries" TEXT[],
    "sampleSize" INTEGER NOT NULL,
    "incidence" DOUBLE PRECISION NOT NULL,
    "loi" INTEGER NOT NULL,
    "fieldDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "priceCpi" DOUBLE PRECISION,
    "priceTotal" INTEGER,
    "costCpi" DOUBLE PRECISION,
    "version" INTEGER,
    "approvalId" TEXT,
    "decisionNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "launchedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "SelfServeStudy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SelfServeStudy_projectId_key" ON "SelfServeStudy"("projectId");
CREATE UNIQUE INDEX "SelfServeStudy_surveyId_key" ON "SelfServeStudy"("surveyId");
CREATE INDEX "SelfServeStudy_tenantId_clientId_idx" ON "SelfServeStudy"("tenantId", "clientId");
ALTER TABLE "SelfServeStudy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SelfServeStudy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SelfServeStudy" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
