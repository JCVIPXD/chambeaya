CREATE TABLE "GoogleProfileSetup" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleProfileSetup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleProfileSetup_tokenHash_key"
  ON "GoogleProfileSetup"("tokenHash");
CREATE INDEX "GoogleProfileSetup_subject_expiresAt_idx"
  ON "GoogleProfileSetup"("subject", "expiresAt");
CREATE INDEX "GoogleProfileSetup_expiresAt_idx"
  ON "GoogleProfileSetup"("expiresAt");
