import { Prisma, PrismaClient } from '@prisma/client';

import type { AuthSession } from '../auth/auth.service.js';
import { CurrencyActionService, instanceKeys } from '../currency/currency.actions.js';
import type { CurrencyRewardService } from '../currency/currency.rewards.js';
import { withSerializableRetry } from '../operations/serializable-retry.js';

export type TalentInvitationInput = {
  workerTalentProfileId: string;
  shiftId?: string | null;
  message?: string | null;
};

export type TalentInvitationErrorCode =
  | 'BUSINESS_ACCOUNT_REQUIRED'
  | 'WORKER_ACCOUNT_REQUIRED'
  | 'TALENT_PROFILE_NOT_AVAILABLE'
  | 'SHIFT_NOT_FOUND'
  | 'INVITATION_ALREADY_ACTIVE'
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_NOT_PENDING';

export class TalentInvitationError extends Error {
  constructor(public readonly code: TalentInvitationErrorCode) {
    super(code);
  }
}

export interface TalentInvitationOperations {
  createInvitation(session: AuthSession, input: TalentInvitationInput): Promise<unknown>;
  listForBusiness(session: AuthSession): Promise<unknown>;
  listForWorker(session: AuthSession): Promise<unknown>;
  acceptInvitation(session: AuthSession, id: string): Promise<unknown>;
  declineInvitation(session: AuthSession, id: string): Promise<unknown>;
}

/**
 * Días de vigencia de una invitación nueva. Se calcula siempre en el
 * servidor a partir de `createdAt`; el cliente nunca puede fijar ni
 * extender `expiresAt`.
 */
const INVITATION_EXPIRATION_DAYS = 7;
const ACTIVE_STATUSES = ['PENDING', 'ACCEPTED'] as const;

const invitationInclude = {
  company: { select: { id: true, name: true } },
  workerTalentProfile: { select: { id: true, userId: true, user: { select: { name: true } } } },
  shift: { select: { id: true, title: true, startsAt: true, endsAt: true } },
};

type InvitationRecord = {
  id: string;
  status: string;
  message: string | null;
  expiresAt: Date;
  respondedAt: Date | null;
  createdAt: Date;
  company: { id: string; name: string };
  workerTalentProfile: { id: string; userId: string; user: { name: string } };
  shift: { id: string; title: string; startsAt: Date; endsAt: Date } | null;
};

export class DatabaseTalentInvitationService implements TalentInvitationOperations {
  /**
   * `charging` activa el cobro de `TALENT_INVITE` (M4): la invitación y su cobro son
   * todo-o-nada en una sola transacción. Sin él no se cobra nada (pruebas con un cliente
   * simulado); `createApp` siempre lo inyecta.
   */
  constructor(
    private readonly prisma = new PrismaClient(),
    private readonly charging?: CurrencyActionService,
    /** M6: premio `INVITATION_RESPONDED` al trabajador. Sin él no se otorga nada. */
    private readonly rewards?: CurrencyRewardService,
  ) {}

  async createInvitation(session: AuthSession, input: TalentInvitationInput) {
    this.requireBusiness(session);
    const company = await this.companyFor(session);

    // No enumeración: la misma consulta (y el mismo error) cubre "no
    // existe" y "existe pero no es visible"; no hay una segunda ruta de
    // código que distinga ambos casos.
    const profile = await this.prisma.workerTalentProfile.findFirst({
      where: { id: input.workerTalentProfileId, isVisible: true },
      select: { id: true, userId: true },
    });
    if (!profile) throw new TalentInvitationError('TALENT_PROFILE_NOT_AVAILABLE');

    let shiftId: string | null = null;
    if (input.shiftId) {
      const shift = await this.prisma.shift.findFirst({
        where: { id: input.shiftId, companyId: company.id },
        select: { id: true },
      });
      if (!shift) throw new TalentInvitationError('SHIFT_NOT_FOUND');
      shiftId = shift.id;
    }

    // Comprobación previa (mejor mensaje de error); la garantía real contra
    // condiciones de carrera es el índice único parcial de la migración
    // (`TalentInvitation_active_company_profile_shift_key`), capturado abajo.
    const existing = await this.prisma.talentInvitation.findFirst({
      where: { companyId: company.id, workerTalentProfileId: profile.id, shiftId, status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true },
    });
    if (existing) throw new TalentInvitationError('INVITATION_ALREADY_ACTIVE');

    const expiresAt = new Date(Date.now() + INVITATION_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
    const data = {
      companyId: company.id,
      workerTalentProfileId: profile.id,
      shiftId,
      message: input.message?.trim() || null,
      expiresAt,
      createdById: session.userId,
    };
    try {
      if (!this.charging) {
        const created = await this.prisma.talentInvitation.create({ data, include: invitationInclude });
        return toBusinessInvitation(created as InvitationRecord);
      }
      const charging = this.charging;
      // Invitar de forma proactiva cuesta (`TALENT_INVITE`): creación y cobro en una sola
      // transacción; si el saldo no alcanza o se supera el tope, no queda invitación alguna.
      const { created, charged } = await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
        const created = await tx.talentInvitation.create({ data, include: invitationInclude });
        const charge = await charging.charge(tx, {
          actor: 'COMPANY', userId: session.userId, subjectId: company.id, actionKey: 'TALENT_INVITE',
          instanceKey: instanceKeys.talentInvite(created.id),
          related: { type: 'TalentInvitation', id: created.id },
          reason: 'Invitación a un candidato',
        });
        return { created, charged: charge.amount };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
      return { ...toBusinessInvitation(created as InvitationRecord), chargedAmount: charged };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw new TalentInvitationError('INVITATION_ALREADY_ACTIVE');
      throw error;
    }
  }

  async listForBusiness(session: AuthSession) {
    this.requireBusiness(session);
    const company = await this.companyFor(session);
    const invitations = await this.prisma.talentInvitation.findMany({
      where: { companyId: company.id },
      include: invitationInclude,
      orderBy: { createdAt: 'desc' },
    });
    const resolved = await Promise.all((invitations as InvitationRecord[]).map((invitation) => this.withLazyExpiration(invitation)));
    return resolved.map(toBusinessInvitation);
  }

  async listForWorker(session: AuthSession) {
    this.requireWorker(session);
    const invitations = await this.prisma.talentInvitation.findMany({
      where: { workerTalentProfile: { userId: session.userId } },
      include: invitationInclude,
      orderBy: { createdAt: 'desc' },
    });
    const resolved = await Promise.all((invitations as InvitationRecord[]).map((invitation) => this.withLazyExpiration(invitation)));
    return resolved.map(toWorkerInvitation);
  }

  async acceptInvitation(session: AuthSession, id: string) {
    return this.respond(session, id, 'ACCEPTED');
  }

  async declineInvitation(session: AuthSession, id: string) {
    return this.respond(session, id, 'DECLINED');
  }

  private async respond(session: AuthSession, id: string, nextStatus: 'ACCEPTED' | 'DECLINED') {
    this.requireWorker(session);
    // Aislamiento por trabajador: la búsqueda ya filtra por el `userId` de
    // la sesión, así que una invitación ajena responde igual que una
    // inexistente (404 genérico), sin distinguir "no existe" de "no es tuya".
    const invitation = await this.prisma.talentInvitation.findFirst({
      where: { id, workerTalentProfile: { userId: session.userId } },
      include: invitationInclude,
    });
    if (!invitation) throw new TalentInvitationError('INVITATION_NOT_FOUND');

    const current = await this.withLazyExpiration(invitation as InvitationRecord);
    if (current.status === 'EXPIRED') throw new TalentInvitationError('INVITATION_EXPIRED');
    if (current.status !== 'PENDING') throw new TalentInvitationError('INVITATION_NOT_PENDING');

    // `updateMany` con guarda de estado evita una carrera entre dos
    // respuestas concurrentes (aceptar y rechazar a la vez): sólo una gana.
    // M6: responder (aceptar o rechazar) dentro del plazo premia al trabajador, una vez por
    // invitación. La respuesta y el premio van en la misma transacción; una invitación anulada,
    // vencida o ya respondida no llega aquí con estado PENDING y por eso nunca premia.
    const applyResponse = async (client: Prisma.TransactionClient | PrismaClient) => {
      const respondedAt = new Date();
      const result = await client.talentInvitation.updateMany({
        where: { id: current.id, status: 'PENDING', expiresAt: { gt: respondedAt } },
        data: { status: nextStatus, respondedAt },
      });
      return result.count > 0;
    };
    const rewards = this.rewards;
    const responded = rewards
      ? await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
        if (!(await applyResponse(tx))) return false;
        await rewards.tryGrant(tx, {
          actor: 'WORKER', userId: session.userId, subjectId: session.userId,
          actionKey: 'INVITATION_RESPONDED', fact: current.id,
          related: { type: 'TalentInvitation', id: current.id },
          reason: 'Invitación respondida a tiempo',
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))
      : await applyResponse(this.prisma);
    if (!responded) throw new TalentInvitationError('INVITATION_NOT_PENDING');

    const updated = await this.prisma.talentInvitation.findUniqueOrThrow({
      where: { id: current.id },
      include: invitationInclude,
    });
    return toWorkerInvitation(updated as InvitationRecord);
  }

  /**
   * El vencimiento se evalúa siempre aquí, en el servidor, nunca a partir de
   * un valor calculado por el cliente. Si una invitación `PENDING` ya venció,
   * se transiciona a `EXPIRED` de forma perezosa (al leerla o al intentar
   * responderla), sin depender de un job programado.
   */
  private async withLazyExpiration(invitation: InvitationRecord): Promise<InvitationRecord> {
    if (invitation.status === 'PENDING' && invitation.expiresAt.getTime() <= Date.now()) {
      await this.prisma.talentInvitation
        .updateMany({ where: { id: invitation.id, status: 'PENDING' }, data: { status: 'EXPIRED' } })
        .catch(() => undefined);
      return { ...invitation, status: 'EXPIRED' };
    }
    return invitation;
  }

  private requireBusiness(session: AuthSession) {
    if (session.role !== 'BUSINESS') throw new TalentInvitationError('BUSINESS_ACCOUNT_REQUIRED');
  }

  private requireWorker(session: AuthSession) {
    if (session.role !== 'WORKER') throw new TalentInvitationError('WORKER_ACCOUNT_REQUIRED');
  }

  private async companyFor(session: AuthSession) {
    return this.prisma.company.upsert({
      where: { ownerId: session.userId },
      update: {},
      create: { ownerId: session.userId, name: session.name, legalName: session.name, ruc: session.identifier },
    });
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';
}

function toBusinessInvitation(invitation: InvitationRecord) {
  return {
    id: invitation.id,
    status: invitation.status,
    message: invitation.message,
    expiresAt: invitation.expiresAt.toISOString(),
    respondedAt: invitation.respondedAt ? invitation.respondedAt.toISOString() : null,
    createdAt: invitation.createdAt.toISOString(),
    shift: shiftSummary(invitation.shift),
    // Nunca se expone `workerTalentProfile.userId`: la empresa solo conoce
    // el identificador de perfil ya usado en el directorio de talento.
    workerTalentProfileId: invitation.workerTalentProfile.id,
    workerName: invitation.workerTalentProfile.user.name,
  };
}

function toWorkerInvitation(invitation: InvitationRecord) {
  return {
    id: invitation.id,
    status: invitation.status,
    message: invitation.message,
    expiresAt: invitation.expiresAt.toISOString(),
    respondedAt: invitation.respondedAt ? invitation.respondedAt.toISOString() : null,
    createdAt: invitation.createdAt.toISOString(),
    shift: shiftSummary(invitation.shift),
    companyId: invitation.company.id,
    companyName: invitation.company.name,
  };
}

function shiftSummary(shift: InvitationRecord['shift']) {
  if (!shift) return null;
  return {
    id: shift.id,
    title: shift.title,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
  };
}
