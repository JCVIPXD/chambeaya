import {
  ConversationStatus,
  MessageSender,
  PaymentStatus,
  PrismaClient,
  WorkerStatus,
} from '@prisma/client';

import type { AuthSession } from '../auth/auth.service.js';
import { isTerminalShift, nextOperationalAction } from '../operations/shift-state.js';

export type CompanyUpdate = {
  name?: string;
  legalName?: string | null;
  industry?: string | null;
  phone?: string | null;
  address?: string | null;
  district?: string | null;
};

export type ShiftInput = {
  title: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  payCents: number;
  requiredWorkers: number;
  description?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  screeningQuestions?: string[];
  modality?: 'PRESENCIAL' | 'REMOTO' | 'HIBRIDO';
  notes?: string | null;
  rescueActive?: boolean;
};

export type WorkerInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  skills?: string[];
  status?: WorkerStatus;
  availability?: string | null;
};

export type ConversationInput = {
  workerId: string;
  shiftId?: string | null;
  subject: string;
  status?: ConversationStatus;
};

export type PaymentInput = {
  reference: string;
  description: string;
  amountCents: number;
  workerCount?: number;
  status?: PaymentStatus;
  dueAt?: Date | null;
  processedAt?: Date | null;
};

export type ApplicationDecision = 'ACCEPTED' | 'REJECTED';
export type PendingApplicationsSummary = { count: number; shiftIds: string[] };

export class BusinessRecordNotFoundError extends Error {}
export class BusinessValidationError extends Error {}
export class BusinessForbiddenError extends Error {}

export interface BusinessOperations {
  getCompany(session: AuthSession): Promise<unknown>;
  updateCompany(session: AuthSession, input: CompanyUpdate): Promise<unknown>;
  listShifts(session: AuthSession): Promise<unknown>;
  getShift(session: AuthSession, id: string): Promise<unknown>;
  createShift(session: AuthSession, input: ShiftInput): Promise<unknown>;
  updateShift(session: AuthSession, id: string, input: Partial<ShiftInput>): Promise<unknown>;
  deleteShift(session: AuthSession, id: string): Promise<void>;
  cancelShift(session: AuthSession, id: string, reason: string): Promise<unknown>;
  getSubscription(session: AuthSession): Promise<unknown>;
  listShiftEvents(session: AuthSession, shiftId: string): Promise<unknown>;
  listShiftApplications(session: AuthSession, shiftId: string): Promise<unknown>;
  pendingApplications(session: AuthSession): Promise<PendingApplicationsSummary>;
  decideShiftApplication(session: AuthSession, shiftId: string, applicationId: string, decision: ApplicationDecision, reason?: string): Promise<unknown>;
  listWorkers(session: AuthSession): Promise<unknown>;
  getWorker(session: AuthSession, id: string): Promise<unknown>;
  createWorker(session: AuthSession, input: WorkerInput): Promise<unknown>;
  updateWorker(session: AuthSession, id: string, input: Partial<WorkerInput>): Promise<unknown>;
  deleteWorker(session: AuthSession, id: string): Promise<void>;
  listConversations(session: AuthSession): Promise<unknown>;
  getConversation(session: AuthSession, id: string): Promise<unknown>;
  createConversation(session: AuthSession, input: ConversationInput): Promise<unknown>;
  updateConversation(session: AuthSession, id: string, input: Partial<Pick<ConversationInput, 'subject' | 'status'>>): Promise<unknown>;
  deleteConversation(session: AuthSession, id: string): Promise<void>;
  createMessage(session: AuthSession, conversationId: string, body: string, sender: MessageSender): Promise<unknown>;
  updateMessage(session: AuthSession, conversationId: string, messageId: string, input: { body?: string; readAt?: Date | null }): Promise<unknown>;
  deleteMessage(session: AuthSession, conversationId: string, messageId: string): Promise<void>;
  listPayments(session: AuthSession): Promise<unknown>;
  getPayment(session: AuthSession, id: string): Promise<unknown>;
  createPayment(session: AuthSession, input: PaymentInput): Promise<unknown>;
  updatePayment(session: AuthSession, id: string, input: Partial<PaymentInput>): Promise<unknown>;
  deletePayment(session: AuthSession, id: string): Promise<void>;
}

export class DatabaseBusinessService implements BusinessOperations {
  constructor(private readonly prisma = new PrismaClient()) {}

  async getCompany(session: AuthSession) {
    return this.companyFor(session);
  }

  async updateCompany(session: AuthSession, input: CompanyUpdate) {
    const company = await this.companyFor(session);
    return this.prisma.company.update({ where: { id: company.id }, data: input });
  }

  async listShifts(session: AuthSession) {
    const company = await this.companyFor(session);
    return this.prisma.shift.findMany({ where: { companyId: company.id }, orderBy: { startsAt: 'asc' } });
  }

  async getShift(session: AuthSession, id: string) {
    return this.ownedShift(session, id);
  }

  async createShift(session: AuthSession, input: ShiftInput) {
    const company = await this.companyFor(session);
    const shift = await this.prisma.shift.create({ data: { ...input, companyId: company.id, confirmedWorkers: 0 } });
    await this.prisma.shiftEvent.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', type: 'PUBLISHED', detail: 'Turno publicado' } });
    return shift;
  }

  async updateShift(session: AuthSession, id: string, input: Partial<ShiftInput>) {
    const shift = await this.ownedShift(session, id);
    if (isTerminalShift(shift.status) || shift.status === 'CHECKED_IN') throw new BusinessValidationError('SHIFT_NOT_EDITABLE');
    const requiredWorkers = input.requiredWorkers ?? shift.requiredWorkers;
    const confirmedWorkers = shift.confirmedWorkers;
    const startsAt = input.startsAt ?? shift.startsAt;
    const endsAt = input.endsAt ?? shift.endsAt;
    if (confirmedWorkers > requiredWorkers) throw new BusinessValidationError('INVALID_COVERAGE');
    if (endsAt <= startsAt) throw new BusinessValidationError('INVALID_DATE_RANGE');
    const updated = await this.prisma.shift.update({ where: { id: shift.id }, data: input });
    await this.prisma.shiftEvent.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', type: 'UPDATED', detail: 'Turno actualizado' } });
    return updated;
  }

  async deleteShift(session: AuthSession, id: string) {
    const shift = await this.ownedShift(session, id);
    const applications = await this.prisma.shiftApplication.count({ where: { shiftId: shift.id } });
    if (applications > 0 || shift.status !== 'PUBLISHED') throw new BusinessValidationError('SHIFT_NOT_DELETABLE');
    await this.prisma.shift.delete({ where: { id: shift.id } });
  }

  async cancelShift(session: AuthSession, id: string, reason: string) {
    if (reason.trim().length < 3) throw new BusinessValidationError('INVALID_CANCELLATION_REASON');
    const shift = await this.ownedShift(session, id);
    if (isTerminalShift(shift.status) || shift.status === 'CHECKED_IN') throw new BusinessValidationError('SHIFT_NOT_CANCELLABLE');
    const checkedIn = await this.prisma.shiftAssignment.count({ where: { shiftId: shift.id, checkedInAt: { not: null } } });
    if (checkedIn > 0) throw new BusinessValidationError('SHIFT_NOT_CANCELLABLE');
    return this.prisma.$transaction(async (tx) => {
      await tx.shiftAssignment.updateMany({ where: { shiftId: shift.id, status: 'ASSIGNED' }, data: { status: 'CANCELLED' } });
      await tx.shiftApplication.updateMany({ where: { shiftId: shift.id, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'CANCELLED' } });
      await tx.shiftCancellation.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', reason: reason.trim() } });
      await tx.shiftEvent.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', type: 'CANCELLED', detail: reason.trim() } });
      return tx.shift.update({ where: { id: shift.id }, data: { status: 'CANCELLED', confirmedWorkers: 0 }, include: { company: true } });
    });
  }

  async getSubscription(session: AuthSession) {
    const company = await this.companyFor(session);
    return this.prisma.companySubscription.upsert({
      where: { companyId: company.id },
      create: { companyId: company.id, plan: 'PILOT', status: 'TRIAL', trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      update: {},
    });
  }

  async listShiftEvents(session: AuthSession, shiftId: string) {
    const shift = await this.ownedShift(session, shiftId);
    return this.prisma.shiftEvent.findMany({
      where: { shiftId: shift.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listShiftApplications(session: AuthSession, shiftId: string) {
    const shift = await this.ownedShift(session, shiftId);
    const applications = await this.prisma.shiftApplication.findMany({
      where: { shiftId: shift.id },
      include: { worker: { select: { id: true, name: true, email: true, identifier: true } }, assignment: true },
      orderBy: { createdAt: 'asc' },
    });
    return applications.map((application) => ({
      ...application,
      nextAction: nextOperationalAction({
        shiftStatus: shift.status,
        applicationStatus: application.status,
        assignment: application.assignment,
      }),
    }));
  }

  async pendingApplications(session: AuthSession): Promise<PendingApplicationsSummary> {
    const company = await this.companyFor(session);
    const applications = await this.prisma.shiftApplication.findMany({
      where: { status: 'PENDING', shift: { companyId: company.id } },
      select: { shiftId: true },
    });
    return { count: applications.length, shiftIds: [...new Set(applications.map((application) => application.shiftId))] };
  }

  async decideShiftApplication(session: AuthSession, shiftId: string, applicationId: string, decision: ApplicationDecision, reason?: string) {
    const shift = await this.ownedShift(session, shiftId);
    if (isTerminalShift(shift.status) || shift.status === 'CHECKED_IN' || shift.endsAt <= new Date()) {
      throw new BusinessValidationError('SHIFT_NOT_ASSIGNABLE');
    }
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const application = await tx.shiftApplication.findFirst({ where: { id: applicationId, shiftId: shift.id }, include: { worker: { select: { id: true, name: true, email: true, identifier: true } } } });
      if (!application) throw new BusinessRecordNotFoundError('APPLICATION_NOT_FOUND');
      if (application.status !== 'PENDING') throw new BusinessValidationError('APPLICATION_ALREADY_DECIDED');
      if (decision === 'REJECTED') {
        const normalizedReason = reason?.trim();
        await tx.shiftEvent.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', type: 'APPLICATION_REJECTED', detail: `${application.id} · ${normalizedReason ?? 'Sin motivo registrado'}` } });
        return tx.shiftApplication.update({ where: { id: application.id }, data: { status: 'REJECTED' }, include: { worker: { select: { id: true, name: true, email: true, identifier: true } } } });
      }
      const assignedCount = await tx.shiftAssignment.count({ where: { shiftId: shift.id, status: 'ASSIGNED' } });
      if (assignedCount >= shift.requiredWorkers) throw new BusinessValidationError('SHIFT_FULL');
      const updated = await tx.shiftApplication.update({ where: { id: application.id }, data: { status: 'ACCEPTED' }, include: { worker: { select: { id: true, name: true, email: true, identifier: true } } } });
      await tx.shiftAssignment.create({ data: { shiftId: shift.id, workerId: application.workerId, applicationId: application.id, checkInCredential: `CUMPLE-${shift.id.slice(-8).toUpperCase()}` } });
      await tx.shiftEvent.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', type: 'APPLICATION_ACCEPTED', detail: application.id } });
      const nextCount = assignedCount + 1;
      await tx.shift.update({ where: { id: shift.id }, data: { confirmedWorkers: nextCount, status: nextCount >= shift.requiredWorkers ? 'ASSIGNED' : 'PUBLISHED' } });
      return updated;
    }, { isolationLevel: 'Serializable' }));
  }

  async listWorkers(session: AuthSession) {
    const company = await this.companyFor(session);
    return this.prisma.companyWorkerContact.findMany({ where: { companyId: company.id }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  }

  async getWorker(session: AuthSession, id: string) {
    return this.ownedWorker(session, id);
  }

  async createWorker(session: AuthSession, input: WorkerInput) {
    const company = await this.companyFor(session);
    return this.prisma.companyWorkerContact.create({ data: { ...input, companyId: company.id } });
  }

  async updateWorker(session: AuthSession, id: string, input: Partial<WorkerInput>) {
    const worker = await this.ownedWorker(session, id);
    return this.prisma.companyWorkerContact.update({ where: { id: worker.id }, data: input });
  }

  async deleteWorker(session: AuthSession, id: string) {
    const worker = await this.ownedWorker(session, id);
    await this.prisma.companyWorkerContact.delete({ where: { id: worker.id } });
  }

  async listConversations(session: AuthSession) {
    const company = await this.companyFor(session);
    return this.prisma.conversation.findMany({
      where: { companyId: company.id },
      include: { worker: true, shift: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getConversation(session: AuthSession, id: string) {
    const company = await this.companyFor(session);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, companyId: company.id },
      include: { worker: true, shift: true, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new BusinessRecordNotFoundError('CONVERSATION_NOT_FOUND');
    await this.prisma.message.updateMany({ where: { conversationId: id, sender: 'WORKER', readAt: null }, data: { readAt: new Date() } });
    return conversation;
  }

  async createConversation(session: AuthSession, input: ConversationInput) {
    const company = await this.companyFor(session);
    await this.requireWorker(company.id, input.workerId);
    if (input.shiftId) await this.requireShift(company.id, input.shiftId);
    const workerProfile = await this.prisma.companyWorkerContact.findUnique({ where: { id: input.workerId } });
    const workerUser = workerProfile?.email
      ? await this.prisma.user.findFirst({ where: { email: workerProfile.email, role: 'WORKER' } })
      : null;
    return this.prisma.conversation.create({
      data: { ...input, companyId: company.id, workerUserId: workerUser?.id },
      include: { worker: true, shift: true, messages: true },
    });
  }

  async updateConversation(session: AuthSession, id: string, input: Partial<Pick<ConversationInput, 'subject' | 'status'>>) {
    await this.getConversation(session, id);
    return this.prisma.conversation.update({ where: { id }, data: input, include: { worker: true, shift: true, messages: true } });
  }

  async deleteConversation(session: AuthSession, id: string) {
    await this.getConversation(session, id);
    await this.prisma.conversation.delete({ where: { id } });
  }

  async createMessage(session: AuthSession, conversationId: string, body: string, sender: MessageSender) {
    await this.getConversation(session, conversationId);
    const message = await this.prisma.message.create({ data: { conversationId, body, sender } });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return message;
  }

  async updateMessage(session: AuthSession, conversationId: string, messageId: string, input: { body?: string; readAt?: Date | null }) {
    await this.getConversation(session, conversationId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId } });
    if (!message) throw new BusinessRecordNotFoundError('MESSAGE_NOT_FOUND');
    if (message.sender !== MessageSender.BUSINESS) throw new BusinessForbiddenError('MESSAGE_NOT_OWNED');
    return this.prisma.message.update({ where: { id: messageId }, data: input });
  }

  async deleteMessage(session: AuthSession, conversationId: string, messageId: string) {
    await this.getConversation(session, conversationId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId } });
    if (!message) throw new BusinessRecordNotFoundError('MESSAGE_NOT_FOUND');
    if (message.sender !== MessageSender.BUSINESS) throw new BusinessForbiddenError('MESSAGE_NOT_OWNED');
    await this.prisma.message.delete({ where: { id: messageId } });
  }

  async listPayments(session: AuthSession) {
    const company = await this.companyFor(session);
    return this.prisma.payment.findMany({
      where: { companyId: company.id },
      include: { shift: { select: { id: true, title: true, startsAt: true, endsAt: true } }, assignment: { include: { worker: { select: { id: true, name: true, email: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPayment(session: AuthSession, id: string) {
    const company = await this.companyFor(session);
    const payment = await this.prisma.payment.findFirst({ where: { id, companyId: company.id } });
    if (!payment) throw new BusinessRecordNotFoundError('PAYMENT_NOT_FOUND');
    return payment;
  }

  async createPayment(session: AuthSession, input: PaymentInput) {
    const company = await this.companyFor(session);
    return this.prisma.payment.create({ data: { ...input, companyId: company.id, processedAt: input.status === PaymentStatus.PROCESSED ? input.processedAt ?? new Date() : input.processedAt } });
  }

  async updatePayment(session: AuthSession, id: string, input: Partial<PaymentInput>) {
    const payment = await this.getPayment(session, id) as { id: string; status: PaymentStatus; assignmentId: string | null; shiftId: string | null };
    const nextStatus = input.status ?? payment.status;
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        ...input,
        processedAt: nextStatus === PaymentStatus.PROCESSED
          ? input.processedAt ?? new Date()
          : input.processedAt ?? null,
      },
    });
    if (nextStatus === PaymentStatus.PROCESSED && payment.assignmentId && payment.shiftId) {
      await this.prisma.shiftEvent.create({ data: { shiftId: payment.shiftId, actorId: session.userId, actorRole: 'BUSINESS', type: 'PAYMENT_REPORTED', detail: payment.id } });
    }
    return updated;
  }

  async deletePayment(session: AuthSession, id: string) {
    const payment = await this.getPayment(session, id) as { id: string };
    await this.prisma.payment.delete({ where: { id: payment.id } });
  }

  private async companyFor(session: AuthSession) {
    return this.prisma.company.upsert({
      where: { ownerId: session.userId },
      update: {},
      create: { ownerId: session.userId, name: session.name, legalName: session.name, ruc: session.identifier },
    });
  }

  private async ownedShift(session: AuthSession, id: string) {
    const company = await this.companyFor(session);
    return this.requireShift(company.id, id);
  }

  private async ownedWorker(session: AuthSession, id: string) {
    const company = await this.companyFor(session);
    return this.requireWorker(company.id, id);
  }

  private async requireShift(companyId: string, id: string) {
    const shift = await this.prisma.shift.findFirst({ where: { id, companyId } });
    if (!shift) throw new BusinessRecordNotFoundError('SHIFT_NOT_FOUND');
    return shift;
  }

  private async requireWorker(companyId: string, id: string) {
    const worker = await this.prisma.companyWorkerContact.findFirst({ where: { id, companyId } });
    if (!worker) throw new BusinessRecordNotFoundError('WORKER_NOT_FOUND');
    return worker;
  }
}

/** Reintenta conflictos de serialización/transacción que pueden ocurrir bajo concurrencia real. */
export async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code !== 'P2034' || attempt === maxAttempts) throw error;
    }
  }
  throw new Error('UNREACHABLE');
}
