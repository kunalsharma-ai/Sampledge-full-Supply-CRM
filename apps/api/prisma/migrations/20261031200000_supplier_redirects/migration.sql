-- Supplier redirects: per-allocation exit links, and on each response the allocation, the supplier's
-- respondent id and a keyed device hash for duplicate checks. Existing RLS policies cover both tables.
ALTER TABLE "Allocation" ADD COLUMN "completeUrl" TEXT, ADD COLUMN "screenoutUrl" TEXT, ADD COLUMN "overquotaUrl" TEXT;
ALTER TABLE "Response" ADD COLUMN "allocationId" TEXT, ADD COLUMN "supplierRid" TEXT, ADD COLUMN "deviceHash" TEXT;
CREATE INDEX "Response_surveyId_deviceHash_idx" ON "Response"("surveyId", "deviceHash");
