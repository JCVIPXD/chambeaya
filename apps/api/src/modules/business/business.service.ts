import {
  ConversationStatus,
  MessageSender,
  PaymentStatus,
  PrismaClient,
  ShiftStatus,
  WorkerStatus,
} from '@prisma/client';

import type { AuthSession } from '../auth/auth.service.js';

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
  confirmedWorkers?: number;
  notes?: string | null;
  rescueActive?: boolean;
  status?: ShiftStatus;
};

export type WorkerInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  skills?: string[];
  status?: WorkerStatus;
  availability?: string | null;
  cumpleScore?: number;
  matchScore?: number;
  completedJobs?: number;
  verified?: boolean;
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
    return this.prisma.shift.create({ data: { ...input, companyId: company.id } });
  }

  async updateShift(session: AuthSession, id: string, input: Partial<ShiftInput>) {
    const shift = await this.ownedShift(session, id);
    const requiredWorkers = input.requiredWorkers ?? shift.requiredWorkers;
    const confirmedWorkers = input.confirmedWorkers ?? shift.confirmedWorkers;
    const startsAt = input.startsAt ?? shift.startsAt;
    const endsAt = input.endsAt ?? shift.endsAt;
    if (confirmedWorkers > requiredWorkers) throw new BusinessValidationError('INVALID_COVERAGE');
    if (endsAt <= startsAt) throw new BusinessValidationError('INVALID_DATE_RANGE');
    return this.prisma.shift.update({ where: { id: shift.id }, data: input });
  }

  async deleteShift(session: AuthSession, id: string) {
    const shift = await this.ownedShift(session, id);
    await this.prisma.shift.delete({ where: { id: shift.id } });
  }

  async listWorkers(session: AuthSession) {
    const company = await this.companyFor(session);
    return this.prisma.workerProfile.findMany({ where: { companyId: company.id }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  }

  async getWorker(session: AuthSession, id: string) {
    return this.ownedWorker(session, id);
  }

  async createWorker(session: AuthSession, input: WorkerInput) {
    const company = await this.companyFor(session);
    return this.prisma.workerProfile.create({ data: { ...input, companyId: company.id } });
  }

  async updateWorker(session: AuthSession, id: string, input: Partial<WorkerInput>) {
    const worker = await this.ownedWorker(session, id);
    return this.prisma.workerProfile.update({ where: { id: worker.id }, data: input });
  }

  async deleteWorker(session: AuthSession, id: string) {
    const worker = await this.ownedWorker(session, id);
    await this.prisma.workerProfile.delete({ where: { id: worker.id } });
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
    return conversation;
  }

  async createConversation(session: AuthSession, input: ConversationInput) {
    const company = await this.companyFor(session);
    await this.requireWorker(company.id, input.workerId);
    if (input.shiftId) await this.requireShift(company.id, input.shiftId);
    return this.prisma.conversation.create({
      data: { ...input, companyId: company.id },
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
    return this.prisma.payment.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' } });
  }

  async getPayment(session: AuthSession, id: string) {
    const company = await this.companyFor(session);
    const payment = await this.prisma.payment.findFirst({ where: { id, companyId: company.id } });
    if (!payment) throw new BusinessRecordNotFoundError('PAYMENT_NOT_FOUND');
    return payment;
  }

  async createPayment(session: AuthSession, input: PaymentInput) {
    const company = await this.companyFor(session);
    return this.prisma.payment.create({ data: { ...input, companyId: company.id } });
  }

  async updatePayment(session: AuthSession, id: string, input: Partial<PaymentInput>) {
    const payment = await this.getPayment(session, id) as { id: string };
    return this.prisma.payment.update({ where: { id: payment.id }, data: input });
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
    const worker = await this.prisma.workerProfile.findFirst({ where: { id, companyId } });
    if (!worker) throw new BusinessRecordNotFoundError('WORKER_NOT_FOUND');
    return worker;
  }
}
