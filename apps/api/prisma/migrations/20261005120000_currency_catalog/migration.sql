-- M2: catálogo configurable de costos y premios de la moneda virtual, con
-- historial de cambios. La migración solo agrega; no toca tablas existentes.
CREATE TYPE "CurrencyCatalogKind" AS ENUM ('COST', 'REWARD');

CREATE TABLE "CurrencyCatalogEntry" (
    "id" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "actor" "CurrencyAccountOwnerType" NOT NULL,
    "kind" "CurrencyCatalogKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "freeMonthlyQuota" INTEGER NOT NULL DEFAULT 0,
    "refundWindowHours" INTEGER,
    "isProvisional" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "CurrencyCatalogEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CurrencyCatalogEntry_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "CurrencyCatalogEntry_quota_not_negative" CHECK ("freeMonthlyQuota" >= 0),
    CONSTRAINT "CurrencyCatalogEntry_refund_positive" CHECK ("refundWindowHours" IS NULL OR "refundWindowHours" > 0),
    -- Cuota gratuita y devolución solo tienen sentido en un costo.
    CONSTRAINT "CurrencyCatalogEntry_reward_without_cost_rules" CHECK ("kind" = 'COST' OR ("freeMonthlyQuota" = 0 AND "refundWindowHours" IS NULL))
);

CREATE TABLE "CurrencyCatalogChange" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "actor" "CurrencyAccountOwnerType" NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyCatalogChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CurrencyCatalogEntry_actionKey_actor_key" ON "CurrencyCatalogEntry"("actionKey", "actor");
CREATE INDEX "CurrencyCatalogChange_entryId_createdAt_idx" ON "CurrencyCatalogChange"("entryId", "createdAt");

ALTER TABLE "CurrencyCatalogEntry" ADD CONSTRAINT "CurrencyCatalogEntry_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CurrencyCatalogChange" ADD CONSTRAINT "CurrencyCatalogChange_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "CurrencyCatalogEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CurrencyCatalogChange" ADD CONSTRAINT "CurrencyCatalogChange_changedById_fkey"
  FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- VALORES INICIALES PROVISIONALES (isProvisional = true): el dueño del producto
-- los ajustará desde el panel de administración. Deben coincidir con
-- DEFAULT_CURRENCY_CATALOG (currency.catalog.ts); una prueba lo verifica.
-- Columnas: actionKey, actor, kind, amount, freeMonthlyQuota, refundWindowHours.
INSERT INTO "CurrencyCatalogEntry" ("id", "actionKey", "actor", "kind", "amount", "freeMonthlyQuota", "refundWindowHours", "updatedAt")
SELECT 'ccat_' || replace(gen_random_uuid()::text, '-', ''), v."actionKey", v."actor"::"CurrencyAccountOwnerType", v."kind"::"CurrencyCatalogKind", v."amount", v."freeMonthlyQuota", v."refundWindowHours", CURRENT_TIMESTAMP
FROM (VALUES
  ('JOB_PUBLISH_EXTRA', 'COMPANY', 'COST', 10, 3, NULL::integer),
  ('JOB_HIGHLIGHT', 'COMPANY', 'COST', 10, 0, NULL::integer),
  ('TALENT_INVITE', 'COMPANY', 'COST', 5, 0, 72),
  ('CANDIDATE_CONTACT_UNLOCK', 'COMPANY', 'COST', 10, 0, NULL::integer),
  ('APPLICATION_EXTRA', 'WORKER', 'COST', 5, 10, 72),
  ('APPLICATION_PRIORITY', 'WORKER', 'COST', 10, 0, 72),
  ('PROFILE_HIGHLIGHT', 'WORKER', 'COST', 10, 0, NULL::integer),
  ('PROFILE_COMPLETE', 'WORKER', 'REWARD', 20, 0, NULL::integer),
  ('DOCUMENT_VERIFIED', 'WORKER', 'REWARD', 10, 0, NULL::integer),
  ('INVITATION_RESPONDED', 'WORKER', 'REWARD', 5, 0, NULL::integer),
  ('REFERRAL', 'WORKER', 'REWARD', 20, 0, NULL::integer),
  ('WELCOME_BONUS', 'WORKER', 'REWARD', 50, 0, NULL::integer),
  ('COMPANY_VERIFIED', 'COMPANY', 'REWARD', 20, 0, NULL::integer),
  ('APPLICANTS_RESPONDED_ON_TIME', 'COMPANY', 'REWARD', 5, 0, NULL::integer),
  ('HIRE_CONFIRMED', 'COMPANY', 'REWARD', 20, 0, NULL::integer),
  ('WELCOME_BONUS', 'COMPANY', 'REWARD', 50, 0, NULL::integer)
) AS v("actionKey", "actor", "kind", "amount", "freeMonthlyQuota", "refundWindowHours");
