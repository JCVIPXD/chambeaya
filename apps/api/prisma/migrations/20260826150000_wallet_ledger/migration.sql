-- Persistent worker wallet ledger. Amounts are integer cents; no payment processing is performed here.
CREATE TYPE "WalletMovementStatus" AS ENUM ('PENDING', 'RELEASED', 'REVERSED');

CREATE TABLE "WalletMovement" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "status" "WalletMovementStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WalletMovement_workerId_createdAt_idx" ON "WalletMovement"("workerId", "createdAt");
CREATE INDEX "WalletMovement_workerId_status_idx" ON "WalletMovement"("workerId", "status");
CREATE UNIQUE INDEX "WalletMovement_workerId_reference_key" ON "WalletMovement"("workerId", "reference");
ALTER TABLE "WalletMovement" ADD CONSTRAINT "WalletMovement_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
