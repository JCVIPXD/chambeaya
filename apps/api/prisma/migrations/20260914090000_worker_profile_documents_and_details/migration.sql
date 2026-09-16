CREATE TYPE "SpecialtyProficiency" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');
CREATE TYPE "WorkerDocumentKind" AS ENUM ('CV');
CREATE TYPE "ExternalIdentityProvider" AS ENUM ('GOOGLE');

ALTER TABLE "WorkerTalentProfile"
  ADD COLUMN "availabilityDays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "availabilityPeriods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "WorkerTalentSpecialty"
  ADD COLUMN "proficiency" "SpecialtyProficiency" NOT NULL DEFAULT 'INTERMEDIATE',
  ADD COLUMN "yearsExperience" INTEGER;

ALTER TABLE "WorkerTalentSpecialty"
  ADD CONSTRAINT "WorkerTalentSpecialty_yearsExperience_check"
  CHECK ("yearsExperience" IS NULL OR "yearsExperience" BETWEEN 0 AND 60);

CREATE TABLE "WorkerDocument" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "WorkerDocumentKind" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "ExternalIdentityProvider" NOT NULL,
  "subject" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerDocument_storageKey_key" ON "WorkerDocument"("storageKey");
CREATE UNIQUE INDEX "WorkerDocument_userId_kind_key" ON "WorkerDocument"("userId", "kind");
CREATE INDEX "WorkerDocument_userId_createdAt_idx" ON "WorkerDocument"("userId", "createdAt");
CREATE UNIQUE INDEX "ExternalIdentity_provider_subject_key" ON "ExternalIdentity"("provider", "subject");
CREATE INDEX "ExternalIdentity_userId_provider_idx" ON "ExternalIdentity"("userId", "provider");

ALTER TABLE "WorkerDocument" ADD CONSTRAINT "WorkerDocument_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
