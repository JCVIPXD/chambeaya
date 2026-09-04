-- Link a direct company payment to the exact completed assignment it covers.
ALTER TABLE "Payment" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "assignmentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "workerConfirmedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_assignmentId_key" ON "Payment"("assignmentId");
CREATE INDEX "Payment_shiftId_idx" ON "Payment"("shiftId");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "ShiftEventType" ADD VALUE 'PAYMENT_REPORTED';
ALTER TYPE "ShiftEventType" ADD VALUE 'PAYMENT_CONFIRMED';
