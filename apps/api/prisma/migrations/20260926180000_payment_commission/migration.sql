-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "taxBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
-- Nullable por ahora: el backfill de más abajo necesita escribir un valor
-- fila por fila antes de poder exigir NOT NULL (ver el ALTER final de esta
-- migración).
ALTER TABLE "Shift" ADD COLUMN     "commissionBps" INTEGER,
ADD COLUMN     "taxBps" INTEGER;

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "commissionBps" INTEGER NOT NULL DEFAULT 1000,
    "taxBps" INTEGER NOT NULL DEFAULT 1800,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettingChange" (
    "id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSettingChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformSettingChange_field_createdAt_idx" ON "PlatformSettingChange"("field", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformSettings" ADD CONSTRAINT "PlatformSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSettingChange" ADD CONSTRAINT "PlatformSettingChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill de los pagos existentes (Alcance C del plan de pagos): antes de
-- esta migración no existía comisión ni IGV, así que quedan en 0 y el total
-- que pagaba la empresa era exactamente el monto del trabajador.
-- `totalCents`/`commissionCents`/`taxCents` ya llegan en 0 por el DEFAULT de
-- las columnas nuevas; solo falta igualar `totalCents` a `amountCents`.
UPDATE "Payment" SET "totalCents" = "amountCents";

-- Un pago sin `assignmentId` no nació de un check-out ni de un cierre manual
-- de asignación (`checkOut`/`resolveAssignment`): es un registro manual de la
-- empresa (CRUD de `business.routes.ts`, retirado en el Alcance D). Queda
-- marcado `'legacy'` para distinguirlo de los pagos `'manual'` que sí nacen
-- de una asignación.
UPDATE "Payment" SET "provider" = 'legacy' WHERE "assignmentId" IS NULL;

-- Antes de este alcance, `SCHEDULED` lo fijaba la empresa a mano desde el
-- CRUD de pagos (no existía una pasarela que lo hiciera). Sin una pasarela
-- real ese estado no tiene sentido: se homologa a `PENDING`, el estado que
-- usa el reporte manual del Alcance D.
UPDATE "Payment" SET "status" = 'PENDING' WHERE "status" = 'SCHEDULED';

-- Fila única de ajustes globales, con los valores iniciales decididos por el
-- usuario (10% de comisión + 18% de IGV sobre la comisión). `ON CONFLICT`
-- es defensivo: esta migración es la única que debe crear esta fila.
INSERT INTO "PlatformSettings" ("id", "commissionBps", "taxBps", "updatedAt")
VALUES ('global', 1000, 1800, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Decisión del usuario (corrección de MEDIO-2, CN-20260926-012): un turno
-- publicado antes de esta migración se cobra SIN comisión (0%, no el 10%
-- global): la empresa lo publicó sin que ninguna pantalla le mostrara jamás
-- una comisión, así que fijarlo en el ajuste global vigente sería cobrarle
-- algo que nunca aceptó ni vio. `commissionBps`/`taxBps` quedan en `0` para
-- siempre en esos turnos (igual que fijaría cualquier turno nuevo, solo que
-- con 0% en vez del ajuste vigente al publicarse).
UPDATE "Shift" SET "commissionBps" = 0, "taxBps" = 0 WHERE "commissionBps" IS NULL;

-- Con todas las filas ya en un valor concreto, la columna puede exigir
-- NOT NULL: cada turno SIEMPRE tiene su propia comisión fijada, y ningún
-- código necesita (ni debe) leer el ajuste global como respaldo para un
-- turno ya creado.
ALTER TABLE "Shift" ALTER COLUMN "commissionBps" SET NOT NULL,
ALTER COLUMN "taxBps" SET NOT NULL;
