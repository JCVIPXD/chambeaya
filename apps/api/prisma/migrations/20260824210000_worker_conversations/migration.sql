ALTER TABLE "Conversation" ADD COLUMN "workerUserId" TEXT;

CREATE INDEX "Conversation_workerUserId_updatedAt_idx"
ON "Conversation" ("workerUserId", "updatedAt");

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_workerUserId_fkey"
FOREIGN KEY ("workerUserId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
