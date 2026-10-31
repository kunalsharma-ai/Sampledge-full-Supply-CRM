-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "codes" JSONB,
ADD COLUMN     "weight" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Survey" ADD COLUMN     "dp" JSONB;
