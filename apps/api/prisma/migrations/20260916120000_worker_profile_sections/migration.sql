-- CreateEnum
CREATE TYPE "LanguageProficiency" AS ENUM ('BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE');

-- AlterTable: work radius/districts and granular per-section visibility on
-- WorkerTalentProfile (Alcance 6 del plan de refuerzo del piloto de
-- talento). Todas las columnas nuevas tienen default seguro para no romper
-- filas existentes: los radios/distritos quedan vacíos y las secciones
-- nacen visibles, igual que el perfil hoy.
ALTER TABLE "WorkerTalentProfile"
  ADD COLUMN "workRadiusKm" INTEGER,
  ADD COLUMN "workDistricts" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "isExperienceVisible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isCertificationsVisible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isLanguagesVisible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isWorkAreaVisible" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "WorkerExperience" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerExperience_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerExperience_profileId_idx" ON "WorkerExperience"("profileId");

ALTER TABLE "WorkerExperience" ADD CONSTRAINT "WorkerExperience_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "WorkerTalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
-- Nota: sin ninguna columna de verificación a propósito (ver comentario en
-- schema.prisma). No añadir "verified"/"isVerified" aquí sin una decisión de
-- producto explícita y su propia migración/auditoría.
CREATE TABLE "WorkerCertification" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issueDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "credentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerCertification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerCertification_profileId_idx" ON "WorkerCertification"("profileId");

ALTER TABLE "WorkerCertification" ADD CONSTRAINT "WorkerCertification_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "WorkerTalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "WorkerLanguage" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "proficiency" "LanguageProficiency" NOT NULL DEFAULT 'CONVERSATIONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerLanguage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerLanguage_profileId_language_key" ON "WorkerLanguage"("profileId", "language");
CREATE INDEX "WorkerLanguage_profileId_idx" ON "WorkerLanguage"("profileId");

ALTER TABLE "WorkerLanguage" ADD CONSTRAINT "WorkerLanguage_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "WorkerTalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
