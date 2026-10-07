import { PrismaClient, type CurrencyAccountOwnerType } from '@prisma/client';

import { CurrencyActionService, instanceKeys, type ActionQuote, type ActionSubject } from './currency.actions.js';
import { virtualCurrencyName } from './currency.config.js';
import { CurrencyError } from './currency.service.js';

/** Acciones con costo que el actor puede cotizar antes de ejecutarlas. */
const QUOTABLE: Readonly<Record<CurrencyAccountOwnerType, readonly string[]>> = {
  COMPANY: ['JOB_PUBLISH_EXTRA', 'JOB_HIGHLIGHT', 'TALENT_INVITE', 'CANDIDATE_CONTACT_UNLOCK'],
  WORKER: ['APPLICATION_EXTRA', 'APPLICATION_PRIORITY'],
};

export function quotableActions(actor: CurrencyAccountOwnerType) {
  return QUOTABLE[actor];
}

/**
 * Costo previo de una acción (M4), para que el cliente avise ANTES de cobrar. No
 * tiene efectos: no escribe en el libro, no crea cuentas ni registra usos. Con
 * `targetId` (puesto, postulación o perfil según la acción) refleja la
 * idempotencia: si esa instancia ya está pagada o registrada, el costo es 0.
 */
export class CurrencyQuoteService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly actions: CurrencyActionService = new CurrencyActionService(),
    private readonly currencyName = virtualCurrencyName(),
  ) {}

  /** Empresa del usuario dueño; sin empresa aún, el saldo y el uso son cero. */
  private async companyIdFor(ownerId: string) {
    return (await this.prisma.company.findUnique({ where: { ownerId }, select: { id: true } }))?.id ?? null;
  }

  async quote(actor: CurrencyAccountOwnerType, userId: string, actionKey: string, targetId?: string) {
    if (!QUOTABLE[actor].includes(actionKey)) throw new CurrencyError('ACTION_NOT_QUOTABLE', 404);
    const companyId = actor === 'COMPANY' ? await this.companyIdFor(userId) : null;
    const subject: ActionSubject = { actor, userId, subjectId: actor === 'WORKER' ? userId : companyId ?? '' };
    const tx = this.prisma;

    let instanceKey: string | null = null;
    let alreadyActive = false;
    if (targetId) {
      switch (actionKey) {
        case 'JOB_PUBLISH_EXTRA': {
          const posting = companyId ? await tx.jobPosting.findFirst({ where: { id: targetId, companyId }, select: { id: true, publishedAt: true } }) : null;
          if (posting) {
            instanceKey = instanceKeys.jobPublish(posting.id);
            // Solo la primera publicación cobra: un puesto ya publicado (también antes de M4) no vuelve a cobrar.
            alreadyActive = posting.publishedAt !== null;
          }
          break;
        }
        case 'JOB_HIGHLIGHT': {
          const posting = companyId ? await tx.jobPosting.findFirst({ where: { id: targetId, companyId }, select: { highlightedUntil: true } }) : null;
          alreadyActive = !!posting?.highlightedUntil && posting.highlightedUntil.getTime() > this.actions.now().getTime();
          break;
        }
        case 'APPLICATION_EXTRA': {
          const posting = await tx.jobPosting.findFirst({ where: { id: targetId, status: { not: 'DRAFT' } }, select: { id: true } });
          if (posting) instanceKey = instanceKeys.jobApply(posting.id, userId);
          break;
        }
        case 'APPLICATION_PRIORITY': {
          const application = await tx.jobApplication.findFirst({ where: { id: targetId, workerId: userId }, select: { id: true, isPriority: true } });
          if (application) { instanceKey = instanceKeys.jobPriority(application.id); alreadyActive = application.isPriority; }
          break;
        }
        case 'CANDIDATE_CONTACT_UNLOCK': {
          const profile = companyId ? await tx.workerTalentProfile.findFirst({ where: { id: targetId, isVisible: true }, select: { userId: true } }) : null;
          if (profile && companyId) {
            instanceKey = instanceKeys.contactUnlock(companyId, profile.userId);
            const unlocked = await tx.candidateContactUnlock.count({ where: { companyId, workerUserId: profile.userId } });
            const engaged = await tx.jobApplication.count({ where: { workerId: profile.userId, posting: { companyId }, status: { notIn: ['REJECTED', 'WITHDRAWN'] } } });
            alreadyActive = unlocked > 0 || engaged > 0;
          }
          break;
        }
        default:
          break;
      }
    }

    const base: ActionQuote = await this.actions.quote(tx, subject, actionKey, instanceKey);
    const quote: ActionQuote = alreadyActive
      ? { ...base, cost: 0, reason: 'ALREADY_REGISTERED', sufficientBalance: true, withinDailyCap: true, canExecute: true }
      : base;
    return { currency: this.currencyName, ...quote };
  }
}
