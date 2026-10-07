import { Prisma } from '@prisma/client';

/**
 * Constancia conservada (decisión del dueño del producto, M4): la oferta aceptada,
 * junto con su postulación, el puesto y la empresa, es la evidencia del acuerdo
 * (soporte y disputas, retención legal y antifraude; el DNI de la constancia se
 * conserva para eso). Por eso borrar una cuenta que tenga una oferta aceptada se
 * BLOQUEA con `409 CONTRACT_RECORDS_RETAINED`, igual que el libro de monedas
 * (`CURRENCY_LEDGER_RETAINED`): no se borra nada, ni filas ni archivos. Las FK de
 * `JobPosting` y `JobApplication` son `RESTRICT` y respaldan la regla aunque otra
 * ruta intentara borrar. Anonimizar la cuenta conservando la constancia queda como
 * alcance futuro.
 */
export class ContractRecordsRetainedError extends Error {
  constructor() {
    super('CONTRACT_RECORDS_RETAINED');
  }
}

type RemovedFiles = string[];

function keysOf(applications: Array<{ offers: Array<{ documentStorageKey: string | null }>; uploads: Array<{ storageKey: string }> }>): RemovedFiles {
  return applications.flatMap((application) => [
    ...application.offers.flatMap((offer) => (offer.documentStorageKey ? [offer.documentStorageKey] : [])),
    ...application.uploads.map((upload) => upload.storageKey),
  ]);
}

const withFiles = { offers: { select: { documentStorageKey: true } }, uploads: { select: { storageKey: true } } } as const;

/**
 * Quita los registros de puestos de un trabajador que se va a borrar (postulaciones sin
 * oferta aceptada, con sus ofertas, subidas y eventos). Lanza `ContractRecordsRetainedError`
 * si alguna oferta fue aceptada. Devuelve las claves de los archivos privados para borrarlos
 * DESPUÉS de confirmar la transacción.
 */
export async function removeWorkerJobRecords(tx: Prisma.TransactionClient, workerId: string): Promise<RemovedFiles> {
  // Bloquea las postulaciones: una aceptación en curso termina antes y se ve en el conteo.
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "JobApplication" WHERE "workerId" = ${workerId} FOR UPDATE`);
  if (await tx.jobOffer.count({ where: { status: 'ACCEPTED', application: { workerId } } }) > 0) throw new ContractRecordsRetainedError();
  const applications = await tx.jobApplication.findMany({ where: { workerId }, select: withFiles });
  await tx.jobApplication.deleteMany({ where: { workerId } });
  return keysOf(applications);
}

/** Igual que `removeWorkerJobRecords`, para una empresa: sus puestos y las postulaciones recibidas. */
export async function removeCompanyJobRecords(tx: Prisma.TransactionClient, companyId: string): Promise<RemovedFiles> {
  await tx.$queryRaw(Prisma.sql`
    SELECT a."id" FROM "JobApplication" a JOIN "JobPosting" p ON p."id" = a."postingId"
    WHERE p."companyId" = ${companyId} FOR UPDATE OF a`);
  if (await tx.jobOffer.count({ where: { status: 'ACCEPTED', application: { posting: { companyId } } } }) > 0) throw new ContractRecordsRetainedError();
  const applications = await tx.jobApplication.findMany({ where: { posting: { companyId } }, select: withFiles });
  await tx.jobApplication.deleteMany({ where: { posting: { companyId } } });
  await tx.jobPosting.deleteMany({ where: { companyId } });
  return keysOf(applications);
}
