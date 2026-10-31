-- A phone number per workspace membership (E.164), for SMS from the Comms Hub. Per workspace, not per
-- user, so one workspace's administrator cannot change a number another workspace relies on.
ALTER TABLE "Membership" ADD COLUMN "phone" TEXT;
