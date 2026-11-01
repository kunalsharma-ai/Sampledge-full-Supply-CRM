-- Completion rate and logic complexity are now computed from responses and the current
-- questionnaire version when surveys are listed; the stored copies were never updated.
ALTER TABLE "Survey" DROP COLUMN "complexity", DROP COLUMN "completionRate";
