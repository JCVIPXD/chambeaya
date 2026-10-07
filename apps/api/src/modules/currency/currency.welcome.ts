import { Prisma, PrismaClient, type CurrencyAccountOwnerType } from '@prisma/client';

import { withSerializableRetry } from '../operations/serializable-retry.js';
import { CurrencyActionService, instanceKeys } from './currency.actions.js';

export type WelcomeBackfillResult = {
  workers: { granted: number; alreadyHad: number };
  companies: { granted: number; alreadyHad: number };
};

const BACKFILL_PAGE = 200;

/**
 * Bono de bienvenida (`WELCOME_BONUS`, M4). Se otorga solo al crear la cuenta de
 * empresa o de trabajador y es idempotente por titular (`welcome-bonus:{tipo}:{id}`):
 * repetirlo, o ejecutar la ruta de regularización, nunca paga dos veces. El monto
 * sale del catálogo vigente; si el premio está inactivo no se otorga nada.
 */
export class WelcomeBonusService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly actions: CurrencyActionService = new CurrencyActionService(),
  ) {}

  grant(actor: CurrencyAccountOwnerType, subjectId: string, userId: string) {
    return withSerializableRetry(() => this.prisma.$transaction(
      (tx) => this.actions.grantReward(tx, { actor, userId, subjectId }, 'WELCOME_BONUS', instanceKeys.welcomeBonus(actor, subjectId), 'Bono de bienvenida'),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ));
  }

  grantForWorker(workerId: string) {
    return this.grant('WORKER', workerId, workerId);
  }

  async grantForCompanyOwner(ownerId: string) {
    const company = await this.prisma.company.findUnique({ where: { ownerId }, select: { id: true } });
    return company ? this.grant('COMPANY', company.id, ownerId) : { granted: false as const, idempotent: false, amount: 0 };
  }

  /**
   * Regulariza las cuentas que ya existían antes de M4: otorga el bono a todo
   * trabajador y empresa que aún no lo tenga. Mecanismo explícito de administración
   * (no es una migración masiva) y reintentable: lo ya otorgado se cuenta como `alreadyHad`.
   */
  async backfill(): Promise<WelcomeBackfillResult> {
    const result: WelcomeBackfillResult = { workers: { granted: 0, alreadyHad: 0 }, companies: { granted: 0, alreadyHad: 0 } };
    let cursor: string | undefined;
    for (;;) {
      const workers: Array<{ id: string }> = await this.prisma.user.findMany({ where: { role: 'WORKER' }, select: { id: true }, orderBy: { id: 'asc' }, take: BACKFILL_PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (workers.length === 0) break;
      for (const worker of workers) {
        const outcome = await this.grantForWorker(worker.id);
        if (outcome.granted && !outcome.idempotent) result.workers.granted += 1;
        else if (outcome.granted) result.workers.alreadyHad += 1;
      }
      cursor = workers.at(-1)!.id;
    }
    cursor = undefined;
    for (;;) {
      const companies: Array<{ id: string; ownerId: string }> = await this.prisma.company.findMany({ select: { id: true, ownerId: true }, orderBy: { id: 'asc' }, take: BACKFILL_PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (companies.length === 0) break;
      for (const company of companies) {
        const outcome = await this.grant('COMPANY', company.id, company.ownerId);
        if (outcome.granted && !outcome.idempotent) result.companies.granted += 1;
        else if (outcome.granted) result.companies.alreadyHad += 1;
      }
      cursor = companies.at(-1)!.id;
    }
    return result;
  }
}
