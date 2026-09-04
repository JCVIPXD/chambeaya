-- CreateEnum
CREATE TYPE "CancellationActorRole" AS ENUM ('WORKER', 'BUSINESS');

-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'CANCELLED';

-- CreateTable
CREATE TABLE "ShiftCancellation" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorRole" "CancellationActorRole" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftCancellation_shiftId_createdAt_idx" ON "ShiftCancellation"("shiftId", "createdAt");

-- CreateIndex
CREATE INDEX "ShiftCancellation_actorId_createdAt_idx" ON "ShiftCancellation"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShiftCancellation" ADD CONSTRAINT "ShiftCancellation_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCancellation" ADD CONSTRAINT "ShiftCancellation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCancellation" ADD CONSTRAINT "ShiftCancellation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
