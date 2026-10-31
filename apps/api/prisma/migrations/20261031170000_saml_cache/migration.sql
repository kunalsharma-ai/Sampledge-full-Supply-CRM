-- SAML sign-in: outstanding request IDs and assertions already used, shared by every API instance.
-- Not tenant data (keys are random request IDs and assertion IDs), so no row-level security policy.
CREATE TABLE "SamlCache" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SamlCache_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "SamlCache_expiresAt_idx" ON "SamlCache"("expiresAt");
