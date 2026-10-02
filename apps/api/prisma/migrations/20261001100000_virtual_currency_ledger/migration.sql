-- M1: libro mayor separado de `WalletMovement`. Esa tabla ya existente
-- representa pagos históricos en céntimos; no se convierte ni se borra.
CREATE TYPE "CurrencyAccountOwnerType" AS ENUM ('WORKER', 'COMPANY');
CREATE TYPE "CurrencyMovementAction" AS ENUM ('ADMIN_ADJUSTMENT');

CREATE TABLE "CurrencyAccount" (
    "id" TEXT NOT NULL,
    "ownerType" "CurrencyAccountOwnerType" NOT NULL,
    "workerId" TEXT,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CurrencyAccount_owner_matches_subject"
      CHECK (
        ("ownerType" = 'WORKER' AND "workerId" IS NOT NULL AND "companyId" IS NULL)
        OR
        ("ownerType" = 'COMPANY' AND "companyId" IS NOT NULL AND "workerId" IS NULL)
      )
);

CREATE TABLE "CurrencyMovement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "action" "CurrencyMovementAction" NOT NULL,
    "reason" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyMovement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CurrencyMovement_quantity_not_zero" CHECK ("quantity" <> 0),
    CONSTRAINT "CurrencyMovement_balance_not_negative" CHECK ("balanceAfter" >= 0)
);

CREATE UNIQUE INDEX "CurrencyAccount_workerId_key" ON "CurrencyAccount"("workerId");
CREATE UNIQUE INDEX "CurrencyAccount_companyId_key" ON "CurrencyAccount"("companyId");
CREATE INDEX "CurrencyAccount_ownerType_idx" ON "CurrencyAccount"("ownerType");
CREATE UNIQUE INDEX "CurrencyMovement_idempotencyKey_key" ON "CurrencyMovement"("idempotencyKey");
CREATE UNIQUE INDEX "CurrencyMovement_accountId_sequence_key" ON "CurrencyMovement"("accountId", "sequence");
CREATE INDEX "CurrencyMovement_accountId_sequence_idx" ON "CurrencyMovement"("accountId", "sequence");
CREATE INDEX "CurrencyMovement_createdById_createdAt_idx" ON "CurrencyMovement"("createdById", "createdAt");

ALTER TABLE "CurrencyAccount" ADD CONSTRAINT "CurrencyAccount_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CurrencyAccount" ADD CONSTRAINT "CurrencyAccount_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CurrencyMovement" ADD CONSTRAINT "CurrencyMovement_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "CurrencyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CurrencyMovement" ADD CONSTRAINT "CurrencyMovement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El acceso de la aplicación solo inserta movimientos, pero esta barrera de
-- base también evita una mutación accidental desde una consola o un futuro
-- repositorio Prisma. `TRUNCATE ... CASCADE` de las pruebas sigue permitido.
CREATE FUNCTION "prevent_currency_movement_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CURRENCY_MOVEMENT_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CurrencyMovement_append_only"
BEFORE UPDATE OR DELETE ON "CurrencyMovement"
FOR EACH ROW EXECUTE FUNCTION "prevent_currency_movement_mutation"();
