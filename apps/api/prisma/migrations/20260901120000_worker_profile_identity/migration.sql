ALTER TABLE "WorkerProfile" ADD COLUMN "workerUserId" TEXT;

CREATE INDEX "WorkerProfile_workerUserId_status_idx" ON "WorkerProfile"("workerUserId", "status");

ALTER TABLE "WorkerProfile" ADD CONSTRAINT "WorkerProfile_workerUserId_fkey"
  FOREIGN KEY ("workerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
