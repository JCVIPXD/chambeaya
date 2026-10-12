import type { JobHooks } from '../jobs/jobs.service.js';
import { CurrencyActionService, instanceKeys } from './currency.actions.js';
import type { CurrencyRewardService } from './currency.rewards.js';
import { readCurrencySetting } from './currency.settings.js';

/**
 * Conecta las acciones de puestos fijos (M3) con el cobro de moneda (M4) por los
 * puntos de extensión `JobHooks`. Se ejecutan dentro de la transacción de la
 * operación: si el cobro falla, la operación no ocurre; si la operación falla
 * después, el cobro se revierte.
 *
 * - Publicar: solo la PRIMERA publicación de un puesto cuenta como una unidad de
 *   `JOB_PUBLISH_EXTRA` (volver a publicar tras una pausa es gratis).
 * - Postular: `APPLICATION_EXTRA` con clave por (puesto, trabajador), de modo que
 *   volver a postular tras retirarse (se reabre la MISMA postulación) no cobra de nuevo.
 * - Aceptar una oferta, retirarse y ver el proceso nunca pasan por aquí: lo básico es gratis.
 *
 * Premios de empresa (M6, solo si se inyecta `rewards`), en la misma transacción del hecho:
 * - `HIRE_CONFIRMED`: una vez por contratación (`afterHire`, hecho = la postulación).
 * - `APPLICANTS_RESPONDED_ON_TIME`: la primera vez que la empresa mueve una postulación fuera de
 *   `APPLIED` dentro de `APPLICANT_RESPONSE_WINDOW_HOURS` desde que llegó (o se reabrió); una vez
 *   por postulación (mover y devolver no repite) y con tope mensual por empresa.
 */
export function createJobCurrencyHooks(actions: CurrencyActionService, rewards?: CurrencyRewardService): JobHooks {
  return {
    async afterHire({ tx, userId, companyId, applicationId }) {
      if (!rewards) return;
      await rewards.tryGrant(tx, {
        actor: 'COMPANY', userId, subjectId: companyId, actionKey: 'HIRE_CONFIRMED', fact: applicationId,
        related: { type: 'JobApplication', id: applicationId },
        reason: 'Contratación confirmada',
      });
    },
    async afterCompanyResponse({ tx, userId, companyId, applicationId, at }) {
      if (!rewards) return;
      const arrival = await tx.jobApplicationEvent.findFirst({
        where: { applicationId, type: { in: ['APPLIED', 'APPLICATION_REOPENED'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!arrival) return;
      const windowHours = await readCurrencySetting(tx, 'APPLICANT_RESPONSE_WINDOW_HOURS');
      if (at.getTime() - arrival.createdAt.getTime() > windowHours * 3_600_000) return;
      await rewards.tryGrant(tx, {
        actor: 'COMPANY', userId, subjectId: companyId, actionKey: 'APPLICANTS_RESPONDED_ON_TIME', fact: applicationId,
        related: { type: 'JobApplication', id: applicationId },
        reason: 'Postulante respondido a tiempo',
        monthlyLimit: 'APPLICANT_RESPONSE_MONTHLY_LIMIT',
      });
    },
    async beforePublish({ tx, userId, companyId, postingId, firstPublication }) {
      if (!firstPublication) return;
      return actions.charge(tx, {
        actor: 'COMPANY', userId, subjectId: companyId, actionKey: 'JOB_PUBLISH_EXTRA',
        instanceKey: instanceKeys.jobPublish(postingId),
        related: { type: 'JobPosting', id: postingId },
        reason: 'Publicación de puesto',
      });
    },
    async beforeApply({ tx, userId, postingId, applicationId }) {
      return actions.charge(tx, {
        actor: 'WORKER', userId, subjectId: userId, actionKey: 'APPLICATION_EXTRA',
        instanceKey: instanceKeys.jobApply(postingId, userId),
        related: { type: 'JobApplication', id: applicationId },
        reason: 'Postulación a un puesto',
      });
    },
    async chargePriority({ tx, userId, applicationId }) {
      return actions.charge(tx, {
        actor: 'WORKER', userId, subjectId: userId, actionKey: 'APPLICATION_PRIORITY',
        instanceKey: instanceKeys.jobPriority(applicationId),
        related: { type: 'JobApplication', id: applicationId },
        reason: 'Postulación con prioridad',
      });
    },
    async chargeHighlight({ tx, userId, companyId, postingId }) {
      const sequence = (await tx.currencyActionUse.count({ where: { actionKey: 'JOB_HIGHLIGHT', relatedEntityType: 'JobPosting', relatedEntityId: postingId } })) + 1;
      return actions.charge(tx, {
        actor: 'COMPANY', userId, subjectId: companyId, actionKey: 'JOB_HIGHLIGHT',
        instanceKey: instanceKeys.jobHighlight(postingId, sequence),
        related: { type: 'JobPosting', id: postingId },
        reason: 'Puesto destacado',
      });
    },
  };
}
