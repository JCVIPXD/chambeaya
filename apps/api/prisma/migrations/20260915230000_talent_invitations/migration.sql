-- CreateEnum
CREATE TYPE "TalentInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TalentInvitation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workerTalentProfileId" TEXT NOT NULL,
    "shiftId" TEXT,
    "status" "TalentInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TalentInvitation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TalentInvitation_companyId_status_idx" ON "TalentInvitation"("companyId", "status");
CREATE INDEX "TalentInvitation_workerTalentProfileId_status_idx" ON "TalentInvitation"("workerTalentProfileId", "status");
CREATE INDEX "TalentInvitation_shiftId_idx" ON "TalentInvitation"("shiftId");

-- Restricción de negocio: impide una segunda invitación *activa* (PENDING o
-- ACCEPTED) para el mismo par empresa/perfil de talento y, si se indicó, el
-- mismo turno. No es expresable en el DSL de Prisma (no admite índices
-- parciales), así que se declara aquí como SQL crudo; `schema.prisma` no la
-- describe y no debe "corregirse" para que coincida, es intencional.
-- `COALESCE("shiftId", '')` evita que Postgres trate cada NULL como distinto
-- (comportamiento por defecto de un índice único sobre una columna nullable),
-- de modo que dos invitaciones activas sin turno para el mismo par también
-- colisionan.
CREATE UNIQUE INDEX "TalentInvitation_active_company_profile_shift_key"
  ON "TalentInvitation" ("companyId", "workerTalentProfileId", (COALESCE("shiftId", '')))
  WHERE "status" IN ('PENDING', 'ACCEPTED');

ALTER TABLE "TalentInvitation" ADD CONSTRAINT "TalentInvitation_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TalentInvitation" ADD CONSTRAINT "TalentInvitation_workerTalentProfileId_fkey"
  FOREIGN KEY ("workerTalentProfileId") REFERENCES "WorkerTalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TalentInvitation" ADD CONSTRAINT "TalentInvitation_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TalentInvitation" ADD CONSTRAINT "TalentInvitation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
