-- Notification read state moves from one flag per notification (shared by everyone who could see
-- it) to one row per person who has read it.
CREATE TABLE "NotificationRead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationRead_notificationId_userId_key" ON "NotificationRead"("notificationId", "userId");
CREATE INDEX "NotificationRead_tenantId_userId_idx" ON "NotificationRead"("tenantId", "userId");
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep what was already read: everyone who could see a read notification has read it.
INSERT INTO "NotificationRead" ("id", "tenantId", "notificationId", "userId", "readAt")
SELECT 'nr_' || md5(n."id" || m."userId"), n."tenantId", n."id", m."userId", n."createdAt"
FROM "Notification" n JOIN "Membership" m ON m."tenantId" = n."tenantId"
WHERE n."read" AND (cardinality(n."roles") = 0 OR m."role" = ANY (n."roles"));

ALTER TABLE "Notification" DROP COLUMN "read";

ALTER TABLE "NotificationRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationRead" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NotificationRead" USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true)) WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
