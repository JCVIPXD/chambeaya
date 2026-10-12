-- CN-20261012-049 (BAJO-3): historial de verificaciones del administrador y fecha de
-- subida del archivo. Solo AGREGA un tipo, una columna nula y dos tablas: no modifica ni
-- borra datos existentes.

-- CreateEnum
CREATE TYPE "VerificationChangeAction" AS ENUM ('VERIFIED', 'UNVERIFIED');

-- AlterTable
ALTER TABLE "WorkerDocument" ADD COLUMN     "uploadedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkerDocumentVerificationChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "WorkerDocumentKind" NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "action" "VerificationChangeAction" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerDocumentVerificationChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyVerificationChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "action" "VerificationChangeAction" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyVerificationChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerDocumentVerificationChange_userId_kind_createdAt_idx" ON "WorkerDocumentVerificationChange"("userId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyVerificationChange_companyId_createdAt_idx" ON "CompanyVerificationChange"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkerDocumentVerificationChange" ADD CONSTRAINT "WorkerDocumentVerificationChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerDocumentVerificationChange" ADD CONSTRAINT "WorkerDocumentVerificationChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationChange" ADD CONSTRAINT "CompanyVerificationChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationChange" ADD CONSTRAINT "CompanyVerificationChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
