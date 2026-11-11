import type { Prisma } from '@prisma/client';

import { isProfileComplete } from '../talent/profile-completeness.js';
import { WorkerReferralService } from './currency.referrals.js';
import { CurrencyRewardService } from './currency.rewards.js';

type Tx = Prisma.TransactionClient;

/**
 * Premios que dependen del estado del perfil del trabajador (M6): `PROFILE_COMPLETE` y,
 * a través de él, el `REFERRAL` del referidor. Se evalúa DENTRO de la transacción que
 * guarda el perfil o sube un documento, así el premio y el cambio son todo-o-nada.
 *
 * `PROFILE_COMPLETE` es único por trabajador (`factKey` por usuario): borrar secciones
 * y volver a completar no vuelve a pagar. Si el premio no cupo (tope) o no existía en el
 * catálogo, la próxima vez que el perfil se guarde cumpliendo el criterio se reintenta.
 */
export class ProfileRewardService {
  constructor(
    private readonly rewards: CurrencyRewardService = new CurrencyRewardService(),
    private readonly referrals: WorkerReferralService = new WorkerReferralService(undefined, rewards),
  ) {}

  async evaluate(tx: Tx, userId: string) {
    const profile = await tx.workerTalentProfile.findUnique({
      where: { userId },
      select: {
        id: true, headline: true, bio: true, district: true, availabilityDays: true, availabilityPeriods: true,
        _count: { select: { specialties: true, experiences: true } },
        user: { select: { documents: { select: { kind: true } } } },
      },
    });
    if (!profile) return { complete: false };
    const kinds = new Set(profile.user.documents.map((document) => document.kind));
    const complete = isProfileComplete({
      headline: profile.headline, bio: profile.bio, district: profile.district,
      availabilityDays: profile.availabilityDays, availabilityPeriods: profile.availabilityPeriods,
      specialtyCount: profile._count.specialties, experienceCount: profile._count.experiences,
      hasCv: kinds.has('CV'), hasPhoto: kinds.has('PROFILE_PHOTO'),
    });
    if (!complete) return { complete: false };
    await this.rewards.tryGrant(tx, {
      actor: 'WORKER', userId, subjectId: userId, actionKey: 'PROFILE_COMPLETE', fact: userId,
      related: { type: 'WorkerTalentProfile', id: profile.id },
      reason: 'Perfil completo',
    });
    await this.referrals.onReferredProfileComplete(tx, userId);
    return { complete: true };
  }
}
