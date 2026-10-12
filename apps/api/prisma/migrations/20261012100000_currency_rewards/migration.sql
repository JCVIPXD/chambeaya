-- M6: ganar monedas (premios automaticos), referidos, verificaciones y destacar el
-- perfil. Solo AGREGA columnas, tablas, indices y filas de ajustes: no modifica ni
-- borra datos existentes y no usa valores de enum nuevos.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralCode" TEXT;

-- AlterTable
ALTER TABLE "WorkerDocument" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "WorkerTalentProfile" ADD COLUMN     "highlightedAt" TIMESTAMP(3),
ADD COLUMN     "highlightedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CurrencyRewardGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actor" "CurrencyAccountOwnerType" NOT NULL,
    "actionKey" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "movementId" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyRewardGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerReferral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyRewardGrant_factKey_key" ON "CurrencyRewardGrant"("factKey");

-- CreateIndex
CREATE INDEX "CurrencyRewardGrant_userId_occurredAt_idx" ON "CurrencyRewardGrant"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "CurrencyRewardGrant_userId_actionKey_occurredAt_idx" ON "CurrencyRewardGrant"("userId", "actionKey", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerReferral_referredId_key" ON "WorkerReferral"("referredId");

-- CreateIndex
CREATE INDEX "WorkerReferral_referrerId_createdAt_idx" ON "WorkerReferral"("referrerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "WorkerTalentProfile_highlightedUntil_idx" ON "WorkerTalentProfile"("highlightedUntil");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerDocument" ADD CONSTRAINT "WorkerDocument_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyRewardGrant" ADD CONSTRAINT "CurrencyRewardGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerReferral" ADD CONSTRAINT "WorkerReferral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerReferral" ADD CONSTRAINT "WorkerReferral_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Un premio siempre suma; un referido nunca es el propio referidor.
ALTER TABLE "CurrencyRewardGrant" ADD CONSTRAINT "CurrencyRewardGrant_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "WorkerReferral" ADD CONSTRAINT "WorkerReferral_not_self" CHECK ("referrerId" <> "referredId");

-- VALORES INICIALES PROVISIONALES (isProvisional = true). Deben coincidir con
-- DEFAULT_CURRENCY_SETTINGS (currency.settings.ts); si una fila falta, el codigo
-- usa ese mismo valor por defecto. El administrador los edita con historial.
INSERT INTO "CurrencySetting" ("key", "value", "updatedAt") VALUES
  ('REWARD_CAP_DAILY_WORKER', 100, CURRENT_TIMESTAMP),
  ('REWARD_CAP_MONTHLY_WORKER', 600, CURRENT_TIMESTAMP),
  ('REWARD_CAP_DAILY_COMPANY', 100, CURRENT_TIMESTAMP),
  ('REWARD_CAP_MONTHLY_COMPANY', 600, CURRENT_TIMESTAMP),
  ('REFERRAL_MONTHLY_LIMIT', 5, CURRENT_TIMESTAMP),
  ('APPLICANT_RESPONSE_WINDOW_HOURS', 72, CURRENT_TIMESTAMP),
  ('APPLICANT_RESPONSE_MONTHLY_LIMIT', 20, CURRENT_TIMESTAMP),
  ('PROFILE_HIGHLIGHT_DURATION_HOURS', 168, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
