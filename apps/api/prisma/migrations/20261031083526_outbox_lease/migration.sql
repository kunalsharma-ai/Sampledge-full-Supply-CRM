-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "lockedUntil" TIMESTAMP(3);
