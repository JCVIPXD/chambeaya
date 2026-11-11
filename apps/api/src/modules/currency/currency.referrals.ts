import { randomInt } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { limaMonthWindow } from './currency.catalog.js';
import { CurrencyRewardService } from './currency.rewards.js';
import { readCurrencySetting } from './currency.settings.js';

type Tx = Prisma.TransactionClient;

/**
 * Referidos de trabajadores (M6). Diseño mínimo y seguro:
 *  - Cada trabajador tiene un código propio (8 caracteres sin ambiguos), creado al
 *    pedirlo por primera vez. Es un identificador aleatorio, no deriva de datos personales.
 *  - Quien se registra con un código válido queda como referido único del dueño del
 *    código (`WorkerReferral.referredId` único): un referido solo cuenta una vez.
 *  - El premio `REFERRAL` NO se paga al registrarse: se paga cuando el referido completa
 *    su perfil (criterio de `PROFILE_COMPLETE`), así registrar cuentas vacías no rinde nada.
 *  - Sin auto-referido: el código solo existe para una cuenta ya creada y el referido es
 *    siempre una cuenta nueva distinta (además de un CHECK en la base).
 *  - Límite mensual de referidos premiados por referidor (`REFERRAL_MONTHLY_LIMIT`, editable
 *    por el admin con historial) y los topes diario/mensual de premios del titular. Un
 *    referido que no cabe queda pendiente y se reintenta cuando el referido vuelva a
 *    guardar su perfil.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export function generateReferralCode() {
  let code = '';
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Normaliza lo que escribe el usuario; `null` si no puede ser un código. */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export class WorkerReferralService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly rewards: CurrencyRewardService = new CurrencyRewardService(),
  ) {}

  /** Código propio del trabajador (se crea la primera vez) y su resumen. Solo datos propios. */
  async summary(userId: string) {
    const code = await this.ensureCode(userId);
    const now = this.rewards.now();
    const month = limaMonthWindow(now);
    const [referred, rewarded, limit, usedThisMonth] = await Promise.all([
      this.prisma.workerReferral.count({ where: { referrerId: userId } }),
      this.prisma.workerReferral.count({ where: { referrerId: userId, rewardedAt: { not: null } } }),
      readCurrencySetting(this.prisma, 'REFERRAL_MONTHLY_LIMIT'),
      this.prisma.currencyRewardGrant.count({ where: { userId, actor: 'WORKER', actionKey: 'REFERRAL', occurredAt: { gte: month.start, lt: month.end } } }),
    ]);
    return { code, referred, rewarded, monthly: { limit, used: usedThisMonth, remaining: Math.max(0, limit - usedThisMonth) } };
  }

  private async ensureCode(userId: string) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
      if (current?.referralCode) return current.referralCode;
      try {
        // Condicional: dos peticiones simultáneas no pisan el código ya creado.
        await this.prisma.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: generateReferralCode() } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    throw new Error('REFERRAL_CODE_GENERATION_FAILED');
  }

  /**
   * El referido acaba de cumplir el criterio de perfil completo: paga al referidor
   * (una sola vez por referido, con `factKey` único por referido). Seguro si no hay
   * referido, si ya se pagó o si el premio no cabe (queda pendiente).
   */
  async onReferredProfileComplete(tx: Tx, referredId: string) {
    const referral = await tx.workerReferral.findUnique({ where: { referredId } });
    if (!referral || referral.rewardedAt) return;
    const outcome = await this.rewards.tryGrant(tx, {
      actor: 'WORKER', userId: referral.referrerId, subjectId: referral.referrerId,
      actionKey: 'REFERRAL', fact: referral.id,
      related: { type: 'WorkerReferral', id: referral.id },
      reason: 'Referido con perfil completo',
      monthlyLimit: 'REFERRAL_MONTHLY_LIMIT',
    });
    if (outcome.granted) {
      await tx.workerReferral.updateMany({ where: { id: referral.id, rewardedAt: null }, data: { rewardedAt: this.rewards.now() } });
    }
  }
}
