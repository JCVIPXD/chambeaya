-- WorkerProfile is a company-scoped contact record, not a global worker
-- profile. Global professional data belongs to WorkerTalentProfile.
ALTER TABLE "WorkerProfile"
  DROP COLUMN "cumpleScore",
  DROP COLUMN "matchScore",
  DROP COLUMN "completedJobs",
  DROP COLUMN "verified";
