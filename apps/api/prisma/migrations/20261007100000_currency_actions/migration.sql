-- M4: acciones conectadas a la moneda virtual + ajustes de decisiones del dueño
-- del producto sobre M3. Solo agrega columnas, tablas y valores de enum, y
-- cambia tres FK de CASCADE a RESTRICT (no toca ni borra filas existentes; la
-- única sentencia de datos rellena `autoClosedReason` en filas ya cerradas).

-- Enums. Los valores nuevos no se usan dentro de esta migración.
ALTER TYPE "CurrencyMovementAction" ADD VALUE 'ACTION_CHARGE';
ALTER TYPE "CurrencyMovementAction" ADD VALUE 'ACTION_REFUND';
ALTER TYPE "CurrencyMovementAction" ADD VALUE 'REWARD';
ALTER TYPE "JobApplicationEventType" ADD VALUE 'APPLICATION_REOPENED';

-- Libro mayor: clave de acción y enlace de la devolución con el cargo original.
ALTER TABLE "CurrencyMovement" ADD COLUMN "actionKey" TEXT;
ALTER TABLE "CurrencyMovement" ADD COLUMN "refundOfId" TEXT;
CREATE UNIQUE INDEX "CurrencyMovement_refundOfId_key" ON "CurrencyMovement"("refundOfId");
ALTER TABLE "CurrencyMovement" ADD CONSTRAINT "CurrencyMovement_refundOfId_fkey"
  FOREIGN KEY ("refundOfId") REFERENCES "CurrencyMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Una devolución siempre suma.
ALTER TABLE "CurrencyMovement" ADD CONSTRAINT "CurrencyMovement_refund_positive"
  CHECK ("refundOfId" IS NULL OR "quantity" > 0);

-- Usos de acciones con costo (cuota gratuita, tope diario, idempotencia, devolución).
CREATE TABLE "CurrencyActionUse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actor" "CurrencyAccountOwnerType" NOT NULL,
    "actionKey" TEXT NOT NULL,
    "instanceKey" TEXT NOT NULL,
    "accountId" TEXT,
    "chargedAmount" INTEGER NOT NULL DEFAULT 0,
    "movementId" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "refundDueAt" TIMESTAMP(3),
    "refundSettledAt" TIMESTAMP(3),
    "refundMovementId" TEXT,

    CONSTRAINT "CurrencyActionUse_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CurrencyActionUse_charged_not_negative" CHECK ("chargedAmount" >= 0)
);
CREATE UNIQUE INDEX "CurrencyActionUse_instanceKey_key" ON "CurrencyActionUse"("instanceKey");
CREATE INDEX "CurrencyActionUse_userId_actionKey_occurredAt_idx" ON "CurrencyActionUse"("userId", "actionKey", "occurredAt");
CREATE INDEX "CurrencyActionUse_userId_occurredAt_idx" ON "CurrencyActionUse"("userId", "occurredAt");
CREATE INDEX "CurrencyActionUse_refundSettledAt_refundDueAt_idx" ON "CurrencyActionUse"("refundSettledAt", "refundDueAt");
ALTER TABLE "CurrencyActionUse" ADD CONSTRAINT "CurrencyActionUse_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ajustes numéricos editables (tope diario, duración de un puesto destacado) con historial.
CREATE TABLE "CurrencySetting" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "CurrencySetting_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "CurrencySetting_value_positive" CHECK ("value" > 0)
);
CREATE TABLE "CurrencySettingChange" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencySettingChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CurrencySettingChange_key_createdAt_idx" ON "CurrencySettingChange"("key", "createdAt");
ALTER TABLE "CurrencySetting" ADD CONSTRAINT "CurrencySetting_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CurrencySettingChange" ADD CONSTRAINT "CurrencySettingChange_changedById_fkey"
  FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- VALORES INICIALES PROVISIONALES (isProvisional = true). Deben coincidir con
-- DEFAULT_CURRENCY_SETTINGS (currency.settings.ts); si una fila falta, el código
-- usa ese mismo valor por defecto.
INSERT INTO "CurrencySetting" ("key", "value", "updatedAt") VALUES
  ('DAILY_SPEND_CAP_WORKER', 200, CURRENT_TIMESTAMP),
  ('DAILY_SPEND_CAP_COMPANY', 200, CURRENT_TIMESTAMP),
  ('JOB_HIGHLIGHT_DURATION_HOURS', 168, CURRENT_TIMESTAMP);

-- Contacto y CV desbloqueados de un candidato que no postuló.
CREATE TABLE "CandidateContactUnlock" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workerUserId" TEXT NOT NULL,
    "movementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateContactUnlock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CandidateContactUnlock_companyId_workerUserId_key" ON "CandidateContactUnlock"("companyId", "workerUserId");
CREATE INDEX "CandidateContactUnlock_workerUserId_idx" ON "CandidateContactUnlock"("workerUserId");
ALTER TABLE "CandidateContactUnlock" ADD CONSTRAINT "CandidateContactUnlock_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateContactUnlock" ADD CONSTRAINT "CandidateContactUnlock_workerUserId_fkey"
  FOREIGN KEY ("workerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Puestos: destacado, postulación con prioridad y cierre automático.
ALTER TABLE "JobPosting" ADD COLUMN "highlightedUntil" TIMESTAMP(3);
CREATE INDEX "JobPosting_status_highlightedUntil_idx" ON "JobPosting"("status", "highlightedUntil");
ALTER TABLE "JobApplication" ADD COLUMN "isPriority" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JobApplication" ADD COLUMN "prioritizedAt" TIMESTAMP(3);
ALTER TABLE "JobApplication" ADD COLUMN "autoClosedReason" TEXT;
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_autoClosedReason_check"
  CHECK ("autoClosedReason" IS NULL OR "autoClosedReason" IN ('POSTING_CLOSED', 'POSTING_FILLED'));

-- Relleno de lo ya cerrado por el sistema (M3): el cierre automático no guarda
-- `decisionReason`, a diferencia del rechazo manual (cuyo texto libre podría
-- coincidir con el código y por eso no se usa para distinguirlos).
UPDATE "JobApplication" a
SET "autoClosedReason" = e."detail"
FROM "JobApplicationEvent" e
WHERE e."applicationId" = a."id"
  AND e."type" = 'REJECTED'
  AND e."detail" IN ('POSTING_CLOSED', 'POSTING_FILLED')
  AND a."status" = 'REJECTED'
  AND a."decisionReason" IS NULL;

-- Constancia conservada: la oferta aceptada (y su postulación) ya no se borra
-- por cascada al eliminar la cuenta del trabajador, la empresa o el puesto.
ALTER TABLE "JobPosting" DROP CONSTRAINT "JobPosting_companyId_fkey";
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobApplication" DROP CONSTRAINT "JobApplication_postingId_fkey";
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_postingId_fkey"
  FOREIGN KEY ("postingId") REFERENCES "JobPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobApplication" DROP CONSTRAINT "JobApplication_workerId_fkey";
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
