-- Client deliverables: files released to a client, stored as released (with SHA-256).
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "surveyId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "status" TEXT NOT NULL,
    "approvalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "downloads" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Deliverable_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Deliverable_tenantId_projectId_status_idx" ON "Deliverable"("tenantId", "projectId", "status");
ALTER TABLE "Deliverable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deliverable" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Deliverable" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
