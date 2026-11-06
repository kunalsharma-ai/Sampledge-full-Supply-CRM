-- SUPPLY360 workspace settings (Audience Orbit X settings screen).
ALTER TABLE "Tenant" ADD COLUMN "supplySettings" JSONB NOT NULL DEFAULT '{}';
