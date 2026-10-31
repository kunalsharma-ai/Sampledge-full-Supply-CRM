-- Shared rate-limit counters (fixed window) for multi-instance deployments.
-- Not tenant data: keys are hashes of route and caller IP, so no row-level security policy.
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");
