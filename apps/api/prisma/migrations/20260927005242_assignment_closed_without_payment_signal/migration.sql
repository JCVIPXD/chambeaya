-- Alcance D, corrección de MEDIO-1 de CN-20260926-020: señal estructurada de
-- "la empresa cerró esta asignación sin pagar", que reemplaza al prefijo de
-- texto libre en ShiftEvent.detail (se podía falsear escribiendo ese mismo
-- texto en el motivo de cancelShift, y se podía ocultar dejando una NO_SHOW/
-- ABANDONED sin resolver, o cancelando el turno completo). Sin backfill: no
-- hay forma de derivar de manera confiable, sin depender del mismo texto
-- libre que se está reemplazando, cuáles ShiftEvent históricos correspondían
-- a un cierre real; toda fila existente queda con closedWithoutPayment=false
-- y closedWithoutPaymentAt/By en NULL (documentado también en
-- docs/reference/api.md).
-- AlterTable
ALTER TABLE "ShiftAssignment" ADD COLUMN     "closedWithoutPayment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "closedWithoutPaymentAt" TIMESTAMP(3),
ADD COLUMN     "closedWithoutPaymentById" TEXT;

-- CreateIndex
CREATE INDEX "ShiftAssignment_closedWithoutPayment_closedWithoutPaymentAt_idx" ON "ShiftAssignment"("closedWithoutPayment", "closedWithoutPaymentAt");

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_closedWithoutPaymentById_fkey" FOREIGN KEY ("closedWithoutPaymentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
