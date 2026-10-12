import { PrismaClient, type CurrencyAccountOwnerType } from '@prisma/client';

import { PROFILE_COMPLETE_SECTIONS, missingProfileSections } from '../talent/profile-completeness.js';
import { instanceKeys } from './currency.actions.js';
import { limaDayWindow, limaMonthWindow } from './currency.catalog.js';
import { virtualCurrencyName } from './currency.config.js';
import { CurrencyRewardService, rewardCapSettings, rewardFactKey } from './currency.rewards.js';
import { readCurrencySetting } from './currency.settings.js';

/** Un premio por tipo de documento (CV y foto): tope máximo de `DOCUMENT_VERIFIED` por trabajador. */
const DOCUMENT_KINDS = ['CV', 'PROFILE_PHOTO'] as const;

const REPEATABLE: Readonly<Record<string, boolean>> = {
  PROFILE_COMPLETE: false, COMPANY_VERIFIED: false, WELCOME_BONUS: false,
  DOCUMENT_VERIFIED: true, INVITATION_RESPONDED: true, REFERRAL: true, APPLICANTS_RESPONDED_ON_TIME: true, HIRE_CONFIRMED: true,
};

/**
 * Lista de premios del propio actor para que las interfaces (M5) muestren qué puede ganar y qué ya ganó
 * (M6). Solo lectura y solo datos propios: nunca expone claves internas de hechos, movimientos de otros ni
 * identificadores de terceros. Un premio inactivo o ausente del catálogo no aparece (no hay premio).
 */
export class CurrencyRewardStatusService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly rewards: CurrencyRewardService = new CurrencyRewardService(),
    private readonly currencyName = virtualCurrencyName(),
  ) {}

  async listFor(actor: CurrencyAccountOwnerType, userId: string) {
    const now = this.rewards.now();
    const company = actor === 'COMPANY' ? await this.prisma.company.findUnique({ where: { ownerId: userId }, select: { id: true, verifiedAt: true } }) : null;
    const entries = await this.prisma.currencyCatalogEntry.findMany({ where: { actor, kind: 'REWARD', active: true } });
    const grants = await this.prisma.currencyRewardGrant.groupBy({ by: ['actionKey'], where: { userId, actor }, _count: { _all: true }, _sum: { amount: true } });
    const byKey = new Map(grants.map((grant) => [grant.actionKey, { count: grant._count._all, amount: grant._sum.amount ?? 0 }]));
    const month = limaMonthWindow(now);
    const monthlyUsed = (actionKey: string) => this.prisma.currencyRewardGrant.count({ where: { userId, actor, actionKey, occurredAt: { gte: month.start, lt: month.end } } });
    const welcomeSubject = actor === 'WORKER' ? userId : company?.id ?? '';
    const welcome = welcomeSubject
      ? await this.prisma.currencyMovement.count({ where: { idempotencyKey: instanceKeys.welcomeBonus(actor, welcomeSubject) } })
      : 0;

    const items = [];
    for (const entry of entries) {
      const earned = entry.actionKey === 'WELCOME_BONUS' ? { count: welcome, amount: welcome > 0 ? entry.amount : 0 } : byKey.get(entry.actionKey) ?? { count: 0, amount: 0 };
      const repeatable = REPEATABLE[entry.actionKey] ?? true;
      let status: 'EARNED' | 'AVAILABLE' = !repeatable && earned.count > 0 ? 'EARNED' : 'AVAILABLE';
      let extra: Record<string, unknown> = {};
      switch (entry.actionKey) {
        case 'PROFILE_COMPLETE': {
          const profile = await this.prisma.workerTalentProfile.findUnique({
            where: { userId },
            select: { headline: true, bio: true, district: true, availabilityDays: true, availabilityPeriods: true, _count: { select: { specialties: true, experiences: true } }, user: { select: { documents: { select: { kind: true } } } } },
          });
          const kinds = new Set(profile?.user.documents.map((document) => document.kind) ?? []);
          const missing = profile
            ? missingProfileSections({
              headline: profile.headline, bio: profile.bio, district: profile.district,
              availabilityDays: profile.availabilityDays, availabilityPeriods: profile.availabilityPeriods,
              specialtyCount: profile._count.specialties, experienceCount: profile._count.experiences,
              hasCv: kinds.has('CV'), hasPhoto: kinds.has('PROFILE_PHOTO'),
            })
            : [...PROFILE_COMPLETE_SECTIONS];
          extra = { requiredSections: PROFILE_COMPLETE_SECTIONS, missingSections: missing };
          break;
        }
        case 'DOCUMENT_VERIFIED': {
          const documents = await this.prisma.workerDocument.findMany({ where: { userId }, select: { kind: true, verifiedAt: true } });
          const rewarded = await this.prisma.currencyRewardGrant.findMany({ where: { userId, actionKey: 'DOCUMENT_VERIFIED' }, select: { factKey: true } });
          extra = {
            maxRewards: DOCUMENT_KINDS.length,
            documents: DOCUMENT_KINDS.map((kind) => {
              const document = documents.find((candidate) => candidate.kind === kind);
              return { kind, uploaded: Boolean(document), verified: Boolean(document?.verifiedAt), rewarded: rewarded.some((grant) => grant.factKey === rewardFactKey('DOCUMENT_VERIFIED', `${userId}:${kind}`)) };
            }),
          };
          if (earned.count >= DOCUMENT_KINDS.length) status = 'EARNED';
          break;
        }
        case 'REFERRAL': {
          const limit = await readCurrencySetting(this.prisma, 'REFERRAL_MONTHLY_LIMIT');
          const used = await monthlyUsed('REFERRAL');
          extra = { monthly: { limit, used, remaining: Math.max(0, limit - used) } };
          break;
        }
        case 'APPLICANTS_RESPONDED_ON_TIME': {
          const [limit, windowHours] = await Promise.all([readCurrencySetting(this.prisma, 'APPLICANT_RESPONSE_MONTHLY_LIMIT'), readCurrencySetting(this.prisma, 'APPLICANT_RESPONSE_WINDOW_HOURS')]);
          const used = await monthlyUsed('APPLICANTS_RESPONDED_ON_TIME');
          extra = { windowHours, monthly: { limit, used, remaining: Math.max(0, limit - used) } };
          break;
        }
        case 'COMPANY_VERIFIED':
          extra = { verified: Boolean(company?.verifiedAt) };
          break;
        default:
          break;
      }
      items.push({ actionKey: entry.actionKey, amount: entry.amount, repeatable, earnedCount: earned.count, earnedAmount: earned.amount, status, ...extra });
    }

    const caps = rewardCapSettings(actor);
    const [dailyLimit, monthlyLimit] = await Promise.all([readCurrencySetting(this.prisma, caps.daily), readCurrencySetting(this.prisma, caps.monthly)]);
    const earnedIn = async (window: { start: Date; end: Date }) => (await this.prisma.currencyRewardGrant.aggregate({ _sum: { amount: true }, where: { userId, actor, occurredAt: { gte: window.start, lt: window.end } } }))._sum.amount ?? 0;
    const [earnedToday, earnedMonth] = await Promise.all([earnedIn(limaDayWindow(now)), earnedIn(month)]);
    return {
      currency: this.currencyName,
      items,
      caps: {
        daily: { limit: dailyLimit, earned: earnedToday, remaining: Math.max(0, dailyLimit - earnedToday) },
        monthly: { limit: monthlyLimit, earned: earnedMonth, remaining: Math.max(0, monthlyLimit - earnedMonth) },
      },
    };
  }
}
