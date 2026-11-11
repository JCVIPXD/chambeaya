-- CreateEnum
CREATE TYPE "JobPostingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'FILLED');

-- CreateEnum
CREATE TYPE "JobModality" AS ENUM ('ONSITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "JobWorkload" AS ENUM ('FULL_TIME', 'PART_TIME');

-- CreateEnum
CREATE TYPE "JobContractType" AS ENUM ('INDEFINITE', 'FIXED_TERM', 'INTERNSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "JobApplicationStatus" AS ENUM ('APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "JobInterviewMode" AS ENUM ('ONSITE', 'VIDEO', 'PHONE');

-- CreateEnum
CREATE TYPE "JobOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "JobApplicationEventType" AS ENUM ('APPLIED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'OFFER_ISSUED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "JobPosting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "responsibilities" TEXT,
    "requirements" TEXT,
    "benefits" TEXT,
    "modality" "JobModality" NOT NULL,
    "workload" "JobWorkload" NOT NULL,
    "salaryMinCents" INTEGER NOT NULL,
    "salaryMaxCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PEN',
    "location" TEXT NOT NULL,
    "contractType" "JobContractType" NOT NULL,
    "expectedStartDate" TIMESTAMP(3),
    "vacancies" INTEGER NOT NULL,
    "filledVacancies" INTEGER NOT NULL DEFAULT 0,
    "screeningQuestions" JSONB,
    "status" "JobPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" "JobApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "screeningAnswers" JSONB,
    "interviewAt" TIMESTAMP(3),
    "interviewMode" "JobInterviewMode",
    "interviewNote" TEXT,
    "decisionReason" TEXT,
    "hiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOffer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "JobOfferStatus" NOT NULL DEFAULT 'PENDING',
    "salaryCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PEN',
    "contractType" "JobContractType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "documentStorageKey" TEXT,
    "documentName" TEXT,
    "documentMediaType" TEXT,
    "documentSizeBytes" INTEGER,
    "documentSha256" TEXT,
    "respondedAt" TIMESTAMP(3),
    "acceptanceSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOfferUpload" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOfferUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "ShiftEventActorRole" NOT NULL,
    "type" "JobApplicationEventType" NOT NULL,
    "fromStatus" "JobApplicationStatus",
    "toStatus" "JobApplicationStatus",
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobPosting_companyId_status_idx" ON "JobPosting"("companyId", "status");

-- CreateIndex
CREATE INDEX "JobPosting_status_publishedAt_id_idx" ON "JobPosting"("status", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "JobApplication_workerId_status_idx" ON "JobApplication"("workerId", "status");

-- CreateIndex
CREATE INDEX "JobApplication_postingId_status_idx" ON "JobApplication"("postingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_postingId_workerId_key" ON "JobApplication"("postingId", "workerId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOffer_documentStorageKey_key" ON "JobOffer"("documentStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "JobOffer_applicationId_version_key" ON "JobOffer"("applicationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "JobOfferUpload_storageKey_key" ON "JobOfferUpload"("storageKey");

-- CreateIndex
CREATE INDEX "JobOfferUpload_applicationId_consumedAt_idx" ON "JobOfferUpload"("applicationId", "consumedAt");

-- CreateIndex
CREATE INDEX "JobApplicationEvent_applicationId_createdAt_idx" ON "JobApplicationEvent"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "JobApplicationEvent_actorId_createdAt_idx" ON "JobApplicationEvent"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOfferUpload" ADD CONSTRAINT "JobOfferUpload_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplicationEvent" ADD CONSTRAINT "JobApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplicationEvent" ADD CONSTRAINT "JobApplicationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariantes que Prisma no expresa. Solo agregan; no tocan tablas existentes.
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_salary_range_check"
  CHECK ("salaryMinCents" > 0 AND "salaryMinCents" <= "salaryMaxCents");
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_vacancies_check"
  CHECK ("vacancies" >= 1 AND "filledVacancies" >= 0 AND "filledVacancies" <= "vacancies");
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_salary_check" CHECK ("salaryCents" > 0);
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_version_check" CHECK ("version" >= 1);

-- A lo sumo una oferta abierta (pendiente) o aceptada por postulación: una
-- versión nueva solo existe si la anterior quedó reemplazada.
CREATE UNIQUE INDEX "JobOffer_one_open_per_application_key"
  ON "JobOffer" ("applicationId")
  WHERE "status" IN ('PENDING', 'ACCEPTED');

-- Una oferta aceptada es la constancia de las condiciones: ningún UPDATE
-- posterior (salario, fechas, snapshot, estado) la puede alterar. Borrarla
-- solo ocurre por cascada al eliminar la postulación, la vacante o la cuenta.
CREATE FUNCTION "job_offer_accepted_is_immutable"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'ACCEPTED' THEN
    RAISE EXCEPTION 'JOB_OFFER_ACCEPTED_IS_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JobOffer_accepted_is_immutable"
  BEFORE UPDATE ON "JobOffer"
  FOR EACH ROW EXECUTE FUNCTION "job_offer_accepted_is_immutable"();
