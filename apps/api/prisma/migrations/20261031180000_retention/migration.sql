-- Per-workspace data retention periods (days per category; empty means keep everything) and the last run.
ALTER TABLE "Tenant" ADD COLUMN "retention" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Tenant" ADD COLUMN "retentionRunAt" TIMESTAMP(3);
