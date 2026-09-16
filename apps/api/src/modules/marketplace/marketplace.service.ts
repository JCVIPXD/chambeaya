import { PrismaClient, type Company, type Prisma, type Shift } from '@prisma/client';

import { filterShifts, type ShiftIndustry, type ShiftSearchFilter } from './shift_search.js';
import { deriveShiftStatus, nextOperationalAction, type OperationalAction } from '../operations/shift-state.js';

export type DemoShiftStatus = 'PUBLISHED' | 'ASSIGNED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';

export interface DemoShift {
  id: string;
  role: string;
  businessName: string;
  dateLabel: string;
  location: string;
  rateCents: number;
  feeCents: number;
  workerPayCents: number;
  status: DemoShiftStatus;
  workerId?: string;
  checkInCredential?: string;
  industry: ShiftIndustry;
  urgent: boolean;
  /** Present only for the isolated demo until matching v1 is implemented. */
  matchScore?: number;
  description: string | null;
  responsibilities: string | null;
  requirements: string | null;
  screeningQuestions: string[];
  modality: string;
  companyVerified?: boolean;
  paymentProtected?: boolean;
}

export interface ScreeningAnswer {
  question: string;
  answer: string;
}

export type WorkerApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED';

export interface WorkerApplication {
  id: string;
  shiftId: string;
  status: WorkerApplicationStatus;
  createdAt: string;
  updatedAt: string;
  screeningAnswers: ScreeningAnswer[];
  shift: DemoShift;
  assignment?: {
    id: string;
    status: 'ASSIGNED' | 'CANCELLED' | 'COMPLETED';
    checkInCredential: string | null;
    workerConfirmedAt: string | null;
    checkedInAt: string | null;
    checkedOutAt: string | null;
  };
  nextAction: OperationalAction;
}

export interface MarketplaceOperations {
  listAvailableShifts(filter?: ShiftSearchFilter): Promise<DemoShift[]> | DemoShift[];
  acceptShift(workerId: string, shiftId: string): Promise<DemoShift> | DemoShift;
  applyToShift(workerId: string, shiftId: string, answers?: ScreeningAnswer[]): Promise<WorkerApplication> | WorkerApplication;
  listApplications(workerId: string): Promise<WorkerApplication[]> | WorkerApplication[];
  confirmAssignment(workerId: string, shiftId: string): Promise<WorkerApplication> | WorkerApplication;
  checkIn(workerId: string, shiftId: string, credential: string): Promise<{ shiftId: string; checkedInAt: string }> | { shiftId: string; checkedInAt: string };
  checkOut(workerId: string, shiftId: string): Promise<{ shiftId: string; checkedOutAt: string }> | { shiftId: string; checkedOutAt: string };
  cancelAssignment(workerId: string, shiftId: string, reason: string): Promise<WorkerApplication> | WorkerApplication;
  listWorkerConversations(workerId: string): Promise<unknown[]> | unknown[];
  getWorkerConversation(workerId: string, conversationId: string): Promise<unknown> | unknown;
  createWorkerMessage(workerId: string, conversationId: string, body: string): Promise<unknown> | unknown;
  activeShift(workerId: string): Promise<DemoShift | null> | DemoShift | null;
  updateAvailability(workerId: string, isAvailable: boolean): Promise<{ isAvailable: boolean }> | { isAvailable: boolean };
  workerAvailability(workerId: string): Promise<{ isAvailable: boolean }> | { isAvailable: boolean };
  wallet(workerId: string): Promise<unknown> | unknown;
  confirmPayment(workerId: string, paymentId: string): Promise<unknown> | unknown;
  recordWalletMovement(workerId: string, movement: { amountCents: number; description: string; status?: 'PENDING' | 'RELEASED' | 'REVERSED'; reference?: string }): Promise<unknown> | unknown;
}

export class MarketplaceError extends Error {
  constructor(
    public readonly code: 'SHIFT_NOT_FOUND' | 'SHIFT_UNAVAILABLE' | 'ASSIGNMENT_NOT_FOUND' | 'INVALID_CHECK_IN' | 'CANCELLATION_NOT_ALLOWED' | 'INVALID_SCREENING_ANSWERS' | 'DIRECT_ASSIGNMENT_DISABLED' | 'PAYMENT_NOT_FOUND' | 'PAYMENT_NOT_REPORTABLE',
    public readonly statusCode: number,
  ) {
    super(code);
  }
}

export function splitPaymentCents(rateCents: number, feePercent: number) {
  const feeCents = Math.round((rateCents * feePercent) / 100);
  return { feeCents, workerPayCents: rateCents - feeCents };
}

export class DemoMarketplaceService implements MarketplaceOperations {
  private readonly shifts: DemoShift[];
  private readonly availability = new Map<string, boolean>();
  private readonly applications = new Map<string, WorkerApplication>();
  private readonly confirmedAssignments = new Set<string>();
  private readonly checkedInAssignments = new Set<string>();

  constructor() {
    const firstPayment = splitPaymentCents(10000, 10);
    const secondPayment = splitPaymentCents(12000, 10);
    this.shifts = [
      {
        id: 'shift-la-mar', role: 'Mozo de Salón', businessName: 'Restaurante La Mar',
        dateLabel: 'Hoy · 18:00 – 00:00', location: 'Miraflores, Lima', rateCents: 10000,
        ...firstPayment, status: 'PUBLISHED', industry: 'HOSPITALITY', urgent: true, matchScore: 98,
        description: 'Apoya al equipo de salón durante un turno de alta demanda.',
        responsibilities: 'Preparar el salón\nAtender mesas\nCoordinar con cocina',
        requirements: 'Experiencia en atención al cliente y disponibilidad completa.',
        screeningQuestions: [],
        modality: 'PRESENCIAL',
      },
      {
        id: 'shift-eventos-peru', role: 'Ayudante de Cocina', businessName: 'Eventos Perú',
        dateLabel: 'Sábado · 10:00 – 18:00', location: 'San Isidro, Lima', rateCents: 12000,
        ...secondPayment, status: 'PUBLISHED', industry: 'EVENTS', urgent: false, matchScore: 88,
        description: 'Apoya en la preparación y servicio de alimentos para un evento.',
        responsibilities: 'Preparar insumos\nMantener el área ordenada\nApoyar durante el servicio',
        requirements: 'Disponibilidad durante todo el turno.',
        screeningQuestions: ['¿Tienes disponibilidad durante todo el horario indicado?'],
        modality: 'PRESENCIAL',
      },
    ];
  }

  listAvailableShifts(filter: ShiftSearchFilter = {}) {
    return filterShifts(this.shifts.filter((shift) => shift.status === 'PUBLISHED'), filter);
  }

  acceptShift(workerId: string, shiftId: string) {
    const shift = this.shifts.find((candidate) => candidate.id === shiftId);
    if (!shift) throw new MarketplaceError('SHIFT_NOT_FOUND', 404);
    if (shift.status !== 'PUBLISHED') throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);

    shift.status = 'ASSIGNED';
    shift.workerId = workerId;
    shift.checkInCredential = `DEMO-CUMPLE-${shift.id.toUpperCase()}`;
    return shift;
  }

  applyToShift(workerId: string, shiftId: string, answers: ScreeningAnswer[] = []) {
    const shift = this.shifts.find((candidate) => candidate.id === shiftId);
    if (!shift) throw new MarketplaceError('SHIFT_NOT_FOUND', 404);
    if (shift.status !== 'PUBLISHED') throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    const key = `${workerId}:${shiftId}`;
    const existing = this.applications.get(key);
    if (existing) return existing;
    const screeningAnswers = validateScreeningAnswers(shift.screeningQuestions, answers);
    const now = new Date().toISOString();
    const application: WorkerApplication = {
      id: `demo-application-${shiftId}-${workerId}`,
      shiftId,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      screeningAnswers,
      shift: { ...shift },
      nextAction: nextOperationalAction({ shiftStatus: shift.status, applicationStatus: 'PENDING' }),
    };
    this.applications.set(key, application);
    return application;
  }

  listApplications(workerId: string) {
    return [...this.applications.values()].filter((application) => application.shift.workerId === workerId || this.applications.has(`${workerId}:${application.shiftId}`));
  }

  confirmAssignment(workerId: string, shiftId: string) {
    const shift = this.shifts.find((candidate) => candidate.id === shiftId && candidate.workerId === workerId && candidate.status === 'ASSIGNED');
    if (!shift) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    this.confirmedAssignments.add(`${workerId}:${shiftId}`);
    const now = new Date().toISOString();
    return {
      id: `demo-application-${shiftId}-${workerId}`,
      shiftId,
      status: 'ACCEPTED' as const,
      createdAt: now,
      updatedAt: now,
      screeningAnswers: [],
      shift: { ...shift },
      nextAction: nextOperationalAction({
        shiftStatus: shift.status,
        applicationStatus: 'ACCEPTED',
        assignment: { status: 'ASSIGNED', workerConfirmedAt: now },
      }),
    };
  }

  checkIn(workerId: string, shiftId: string, credential: string) {
    const shift = this.shifts.find((candidate) => candidate.id === shiftId && candidate.workerId === workerId && candidate.status === 'ASSIGNED');
    if (!shift) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    if (!this.confirmedAssignments.has(`${workerId}:${shiftId}`)) throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    if (credential.trim() !== shift.checkInCredential) throw new MarketplaceError('INVALID_CHECK_IN', 400);
    const checkedInAt = new Date().toISOString();
    this.checkedInAssignments.add(`${workerId}:${shiftId}`);
    shift.status = 'CHECKED_IN';
    return { shiftId, checkedInAt };
  }

  checkOut(workerId: string, shiftId: string) {
    const shift = this.shifts.find((candidate) => candidate.id === shiftId && candidate.workerId === workerId && candidate.status === 'CHECKED_IN');
    if (!shift) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    if (!this.checkedInAssignments.has(`${workerId}:${shiftId}`)) throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    shift.status = 'COMPLETED';
    return { shiftId, checkedOutAt: new Date().toISOString() };
  }

  cancelAssignment(workerId: string, shiftId: string, reason: string) {
    const application = this.applications.get(`${workerId}:${shiftId}`);
    if (!application) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    if (!reason.trim()) throw new MarketplaceError('CANCELLATION_NOT_ALLOWED', 400);
    application.status = 'CANCELLED';
    application.updatedAt = new Date().toISOString();
    application.nextAction = nextOperationalAction({ shiftStatus: application.shift.status, applicationStatus: 'CANCELLED' });
    return application;
  }

  listWorkerConversations() { return []; }
  getWorkerConversation() { throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404); }
  createWorkerMessage() { throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404); }

  activeShift(workerId: string) {
    return this.shifts.find((shift) => shift.workerId === workerId && ['ASSIGNED', 'CHECKED_IN'].includes(shift.status)) ?? null;
  }

  updateAvailability(workerId: string, isAvailable: boolean) {
    this.availability.set(workerId, isAvailable);
    return { isAvailable };
  }

  workerAvailability(workerId: string) {
    return { isAvailable: this.availability.get(workerId) ?? true };
  }

  wallet(workerId: string) {
    // Demo movements are scoped to the authenticated worker; never expose
    // another worker's identity or state through this compatibility service.
    return {
      workerId,
      balanceCents: 9000,
      pendingBalanceCents: 11000,
      movements: [
        { id: 'payment-la-mar', description: 'Restaurante La Mar', amountCents: 9000, status: 'RELEASED' },
        { id: 'payment-eventos', description: 'Eventos Perú', amountCents: 11000, status: 'PENDING' },
      ],
    };
  }

  confirmPayment(_workerId: string, _paymentId: string) {
    throw new MarketplaceError('PAYMENT_NOT_FOUND', 404);
  }

  recordWalletMovement(workerId: string, movement: { amountCents: number; description: string; status?: 'PENDING' | 'RELEASED' | 'REVERSED'; reference?: string }) {
    return { id: `demo-movement-${Date.now()}`, workerId, ...movement, status: movement.status ?? 'PENDING', createdAt: new Date().toISOString() };
  }
}

type PublishedShift = Shift & { company: Company };

export class DatabaseMarketplaceService implements MarketplaceOperations {
  constructor(private readonly prisma = new PrismaClient()) {}

  async listAvailableShifts(filter: ShiftSearchFilter = {}) {
    const shifts = await this.prisma.shift.findMany({
      where: { status: 'PUBLISHED', endsAt: { gt: new Date() } },
      include: { company: true },
      orderBy: [{ rescueActive: 'desc' }, { startsAt: 'asc' }],
    });
    return filterShifts(shifts.map(toMarketplaceShift), filter);
  }

  async acceptShift(workerId: string, shiftId: string): Promise<DemoShift> {
    void workerId;
    void shiftId;
    throw new MarketplaceError('DIRECT_ASSIGNMENT_DISABLED', 410);
  }

  async applyToShift(workerId: string, shiftId: string, answers: ScreeningAnswer[] = []) {
    const worker = await this.prisma.user.findFirst({ where: { id: workerId, role: 'WORKER' } });
    if (!worker) throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, status: 'PUBLISHED', endsAt: { gt: new Date() } },
      include: { company: true },
    });
    if (!shift) throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    const existing = await this.prisma.shiftApplication.findUnique({
      where: { shiftId_workerId: { shiftId, workerId } },
      include: { shift: { include: { company: true } } },
    });
    if (existing) return toWorkerApplication(existing);
    const screeningAnswers = validateScreeningAnswers(readStringList(shift.screeningQuestions), answers);
    let application;
    try {
      application = await this.prisma.$transaction(async (tx) => {
        const concurrentApplication = await tx.shiftApplication.findUnique({
          where: { shiftId_workerId: { shiftId, workerId } },
          include: { shift: { include: { company: true } } },
        });
        if (concurrentApplication) return concurrentApplication;
        const createdApplication = await tx.shiftApplication.create({
          data: { shiftId, workerId, screeningAnswers },
          include: { shift: { include: { company: true } } },
        });
        await tx.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'WORKER', type: 'APPLICATION_SUBMITTED', detail: createdApplication.id } });
        await this.ensureWorkerConversation(tx, worker, shift);
        return createdApplication;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrentApplication = await this.prisma.shiftApplication.findUnique({
        where: { shiftId_workerId: { shiftId, workerId } },
        include: { shift: { include: { company: true } } },
      });
      if (!concurrentApplication) throw error;
      return toWorkerApplication(concurrentApplication);
    }
    return toWorkerApplication(application);
  }

  async listWorkerConversations(workerId: string) {
    return this.prisma.conversation.findMany({
      where: { workerUserId: workerId },
      include: {
        company: { select: { name: true } },
        worker: true,
        shift: { select: { id: true, title: true, startsAt: true, endsAt: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getWorkerConversation(workerId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, workerUserId: workerId },
      include: { company: { select: { name: true } }, worker: true, shift: true, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    await this.prisma.message.updateMany({
      where: { conversationId, sender: 'BUSINESS', readAt: null },
      data: { readAt: new Date() },
    });
    return conversation;
  }

  async createWorkerMessage(workerId: string, conversationId: string, body: string) {
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, workerUserId: workerId } });
    if (!conversation) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    const message = await this.prisma.message.create({ data: { conversationId, sender: 'WORKER', body: body.trim() } });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return message;
  }

  private async ensureWorkerConversation(prisma: Prisma.TransactionClient, worker: { id: string; name: string; email: string }, shift: PublishedShift) {
    let profile = await prisma.companyWorkerContact.findFirst({ where: { companyId: shift.companyId, email: worker.email } });
    if (!profile) {
      profile = await prisma.companyWorkerContact.create({
        data: { companyId: shift.companyId, workerUserId: worker.id, name: worker.name, email: worker.email, role: 'Postulante', skills: [], status: 'AVAILABLE' },
      });
    }
    const existing = await prisma.conversation.findFirst({ where: { companyId: shift.companyId, workerId: profile.id, shiftId: shift.id } });
    if (existing) {
      if (existing.workerUserId !== worker.id) await prisma.conversation.update({ where: { id: existing.id }, data: { workerUserId: worker.id } });
      return existing;
    }
    return prisma.conversation.create({
      data: { companyId: shift.companyId, workerId: profile.id, workerUserId: worker.id, shiftId: shift.id, subject: `Postulación · ${shift.title}` },
    });
  }

  async listApplications(workerId: string) {
    const applications = await this.prisma.shiftApplication.findMany({
      where: { workerId },
      include: { shift: { include: { company: true } }, assignment: true },
      orderBy: { createdAt: 'desc' },
    });
    return applications.map(toWorkerApplication);
  }

  async confirmAssignment(workerId: string, shiftId: string) {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: {
        workerId,
        shiftId,
        status: 'ASSIGNED',
        shift: { status: { in: ['PUBLISHED', 'ASSIGNED'] }, endsAt: { gt: new Date() } },
      },
      include: { shift: { include: { company: true } }, application: true },
    });
    if (!assignment) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    if (assignment.workerConfirmedAt) return toWorkerApplication({ ...assignment.application, shiftId, shift: assignment.shift, assignment });
    const updated = await this.prisma.shiftAssignment.update({
      where: { id: assignment.id },
      data: { workerConfirmedAt: new Date() },
      include: { shift: { include: { company: true } } },
    });
    await this.prisma.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'WORKER', type: 'ASSIGNMENT_CONFIRMED' } });
    return toWorkerApplication({
      id: assignment.applicationId,
      shiftId,
      status: 'ACCEPTED',
      createdAt: assignment.assignedAt,
      updatedAt: updated.updatedAt,
      shift: updated.shift,
      assignment: updated,
    });
  }

  async checkIn(workerId: string, shiftId: string, credential: string) {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { workerId, shiftId, status: 'ASSIGNED' },
      include: { shift: true },
    });
    if (!assignment) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    if (!assignment.workerConfirmedAt || assignment.shift.endsAt <= new Date() || ['COMPLETED', 'CANCELLED'].includes(assignment.shift.status)) {
      throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    }
    if (!assignment.checkInCredential || credential.trim() !== assignment.checkInCredential) throw new MarketplaceError('INVALID_CHECK_IN', 400);
    if (assignment.checkedInAt) return { shiftId, checkedInAt: assignment.checkedInAt.toISOString() };
    const checkedInAt = new Date();
    await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      await tx.shiftAssignment.update({ where: { id: assignment.id }, data: { checkedInAt } });
      const assignments = await tx.shiftAssignment.findMany({ where: { shiftId } });
      const status = deriveShiftStatus(assignment.shift.status, assignment.shift.requiredWorkers, assignments);
      await tx.shift.update({ where: { id: shiftId }, data: { status } });
      await tx.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'WORKER', type: 'CHECKED_IN' } });
    }, { isolationLevel: 'Serializable' }));
    return { shiftId, checkedInAt: checkedInAt.toISOString() };
  }

  async checkOut(workerId: string, shiftId: string) {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { workerId, shiftId, status: 'ASSIGNED' },
      include: { shift: { include: { company: true } } },
    });
    if (!assignment) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    if (!assignment.checkedInAt) throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    const checkedOutAt = new Date();
    await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      await tx.shiftAssignment.update({
        where: { id: assignment.id },
        data: { checkedOutAt, completedAt: checkedOutAt, status: 'COMPLETED' },
      });
      const assignments = await tx.shiftAssignment.findMany({ where: { shiftId } });
      const status = deriveShiftStatus(assignment.shift.status, assignment.shift.requiredWorkers, assignments);
      await tx.shift.update({ where: { id: shiftId }, data: { status } });
      await tx.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'WORKER', type: 'CHECKED_OUT' } });
      await tx.payment.upsert({
        where: { assignmentId: assignment.id },
        update: {},
        create: {
          companyId: assignment.shift.companyId,
          shiftId,
          assignmentId: assignment.id,
          reference: `CN-${shiftId.slice(-8).toUpperCase()}-${assignment.id.slice(-8).toUpperCase()}`,
          description: `${assignment.shift.title} · ${assignment.shift.company.name}`,
          amountCents: assignment.shift.payCents,
          workerCount: 1,
          status: 'PENDING',
          dueAt: checkedOutAt,
        },
      });
      if (status === 'COMPLETED') {
        await tx.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'SYSTEM', type: 'COMPLETED' } });
      }
    }, { isolationLevel: 'Serializable' }));
    return { shiftId, checkedOutAt: checkedOutAt.toISOString() };
  }

  async cancelAssignment(workerId: string, shiftId: string, reason: string) {
    if (reason.trim().length < 3) throw new MarketplaceError('CANCELLATION_NOT_ALLOWED', 400);
    return this.prisma.$transaction(async (tx) => {
      const application = await tx.shiftApplication.findFirst({
        where: { workerId, shiftId },
        include: { shift: true, assignment: true },
      });
      if (!application || ['REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(application.status)) {
        throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
      }
      if (application.assignment?.checkedInAt) throw new MarketplaceError('CANCELLATION_NOT_ALLOWED', 409);
      const assignmentId = application.assignment?.id;
      if (assignmentId) {
        await tx.shiftAssignment.update({ where: { id: assignmentId }, data: { status: 'CANCELLED' } });
      }
      const cancelled = await tx.shiftApplication.update({
        where: { id: application.id },
        data: { status: 'CANCELLED' },
        include: { shift: { include: { company: true } }, assignment: true },
      });
      await tx.shiftCancellation.create({
        data: { shiftId, assignmentId, actorId: workerId, actorRole: 'WORKER', reason: reason.trim() },
      });
      await tx.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'WORKER', type: 'CANCELLED', detail: reason.trim() } });
      if (assignmentId) {
        const assignments = await tx.shiftAssignment.findMany({ where: { shiftId } });
        const activeCount = assignments.filter((assignment) => assignment.status === 'ASSIGNED').length;
        const status = deriveShiftStatus(application.shift.status, application.shift.requiredWorkers, assignments);
        await tx.shift.update({
          where: { id: shiftId },
          data: { confirmedWorkers: activeCount, status },
        });
      }
      return toWorkerApplication(cancelled);
    });
  }

  async activeShift(workerId: string) {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { workerId, status: 'ASSIGNED', shift: { endsAt: { gt: new Date() } } },
      include: { shift: { include: { company: true } } },
      orderBy: { assignedAt: 'asc' },
    });
    if (assignment) {
      return {
        ...toMarketplaceShift(assignment.shift),
        status: assignment.checkedInAt ? 'CHECKED_IN' as const : 'ASSIGNED' as const,
        workerId,
        checkInCredential: assignment.checkInCredential ?? undefined,
      };
    }
    return null;
  }

  async updateAvailability(workerId: string, isAvailable: boolean) {
    // Persist availability on the worker profile(s) linked to the authenticated
    // user.  The worker id is resolved server-side; callers cannot select a
    // different profile through the payload.
    const worker = await this.prisma.user.findFirst({
      where: { id: workerId, role: 'WORKER' },
      select: { email: true },
    });
    if (!worker) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    await this.prisma.companyWorkerContact.updateMany({
      where: { email: worker.email },
      data: { status: isAvailable ? 'AVAILABLE' : 'UNAVAILABLE' },
    });
    return { isAvailable };
  }

  async workerAvailability(workerId: string) {
    const worker = await this.prisma.user.findFirst({ where: { id: workerId, role: 'WORKER' }, select: { id: true, email: true } });
    if (!worker) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    const profiles = await this.prisma.companyWorkerContact.findMany({ where: { OR: [{ workerUserId: worker.id }, { workerUserId: null, email: worker.email }] }, select: { status: true } });
    return { isAvailable: profiles.every((profile) => profile.status !== 'UNAVAILABLE') };
  }

  async wallet(workerId: string) {
    const worker = await this.prisma.user.findFirst({ where: { id: workerId, role: 'WORKER' }, select: { id: true } });
    if (!worker) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    const movements = await this.prisma.walletMovement.findMany({
      where: { workerId }, orderBy: { createdAt: 'desc' },
      select: { id: true, description: true, amountCents: true, status: true, reference: true, createdAt: true },
    });
    const paymentModel = (this.prisma as PrismaClient & {
      payment?: PrismaClient['payment'];
    }).payment;
    const payments = paymentModel
      ? await paymentModel.findMany({
          where: { assignment: { workerId } },
          include: { shift: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const paymentMovements = payments.map((payment) => ({
      id: payment.id,
      description: payment.description,
      amountCents: payment.amountCents,
      status: payment.status === 'PROCESSED' ? 'RELEASED' : payment.status === 'CANCELLED' ? 'REVERSED' : 'PENDING',
      reference: payment.reference,
      createdAt: payment.createdAt,
      receiptConfirmed: payment.workerConfirmedAt !== null,
      source: 'PAYMENT',
    }));
    const allMovements = [...paymentMovements, ...movements].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const balanceCents = allMovements.filter((movement) => movement.status === 'RELEASED').reduce((total, movement) => total + movement.amountCents, 0);
    const pendingBalanceCents = allMovements.filter((movement) => movement.status === 'PENDING').reduce((total, movement) => total + movement.amountCents, 0);
    return { workerId, balanceCents, pendingBalanceCents, movements: allMovements };
  }

  async confirmPayment(workerId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, assignment: { workerId } },
      include: { assignment: true },
    });
    if (!payment) throw new MarketplaceError('PAYMENT_NOT_FOUND', 404);
    if (payment.status !== 'PROCESSED') throw new MarketplaceError('PAYMENT_NOT_REPORTABLE', 409);
    if (payment.workerConfirmedAt) return payment;
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { workerConfirmedAt: new Date() },
    });
    await this.prisma.shiftEvent.create({
      data: {
        shiftId: payment.assignment!.shiftId,
        actorId: workerId,
        actorRole: 'WORKER',
        type: 'PAYMENT_CONFIRMED',
        detail: payment.id,
      },
    });
    return updated;
  }

  async recordWalletMovement(workerId: string, movement: { amountCents: number; description: string; status?: 'PENDING' | 'RELEASED' | 'REVERSED'; reference?: string }) {
    const worker = await this.prisma.user.findFirst({ where: { id: workerId, role: 'WORKER' }, select: { id: true, role: true } });
    // Keep the role check defensive as well as in the query: mocked/adapted
    // persistence layers must never be able to write a BUSINESS ledger.
    if (!worker || worker.role !== 'WORKER') throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    const validStatuses = new Set(['PENDING', 'RELEASED', 'REVERSED']);
    if (!Number.isInteger(movement.amountCents) || movement.amountCents <= 0 || !movement.description.trim() || (movement.status !== undefined && !validStatuses.has(movement.status))) {
      throw new MarketplaceError('CANCELLATION_NOT_ALLOWED', 400);
    }
    return this.prisma.walletMovement.create({ data: {
      workerId, amountCents: movement.amountCents, description: movement.description.trim(),
      status: movement.status ?? 'PENDING', reference: movement.reference,
    } });
  }
}

function toMarketplaceShift(shift: PublishedShift): DemoShift {
  const now = Date.now();
  const startsSoon = shift.startsAt.getTime() > now && shift.startsAt.getTime() - now <= 24 * 60 * 60 * 1000;
  return {
    id: shift.id,
    role: shift.title,
    businessName: shift.company.name,
    dateLabel: formatSchedule(shift.startsAt, shift.endsAt),
    location: shift.location,
    rateCents: shift.payCents,
    feeCents: 0,
    workerPayCents: shift.payCents,
    status: shift.status,
    industry: industryFor(shift.company.industry),
    urgent: shift.rescueActive || startsSoon,
    description: shift.description,
    responsibilities: shift.responsibilities,
    requirements: shift.requirements,
    screeningQuestions: readStringList(shift.screeningQuestions),
    modality: shift.modality,
    companyVerified: false,
    paymentProtected: false,
  };
}

function toWorkerApplication(application: {
  id: string;
  shiftId: string;
  status: WorkerApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
  screeningAnswers?: unknown;
  shift: PublishedShift;
  assignment?: {
    id: string;
    status: 'ASSIGNED' | 'CANCELLED' | 'COMPLETED';
    checkInCredential: string | null;
    workerConfirmedAt: Date | null;
    checkedInAt: Date | null;
    checkedOutAt: Date | null;
  } | null;
}): WorkerApplication {
  return {
    id: application.id,
    shiftId: application.shiftId,
    status: application.status,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
    screeningAnswers: readScreeningAnswers(application.screeningAnswers),
    shift: toMarketplaceShift(application.shift),
    ...(application.assignment ? {
      assignment: {
        id: application.assignment.id,
        status: application.assignment.status,
        checkInCredential: application.assignment.checkInCredential,
        workerConfirmedAt: application.assignment.workerConfirmedAt?.toISOString() ?? null,
        checkedInAt: application.assignment.checkedInAt?.toISOString() ?? null,
        checkedOutAt: application.assignment.checkedOutAt?.toISOString() ?? null,
      },
    } : {}),
    nextAction: nextOperationalAction({
      shiftStatus: application.shift.status,
      applicationStatus: application.status,
      assignment: application.assignment,
    }),
  };
}

export function validateScreeningAnswers(questions: string[], answers: ScreeningAnswer[]) {
  if (questions.length !== answers.length) throw new MarketplaceError('INVALID_SCREENING_ANSWERS', 400);
  const byQuestion = new Map(answers.map((item) => [item.question.trim(), item.answer.trim()]));
  if (byQuestion.size !== answers.length) throw new MarketplaceError('INVALID_SCREENING_ANSWERS', 400);
  return questions.map((question) => {
    const answer = byQuestion.get(question);
    if (!answer || answer.length > 1000) throw new MarketplaceError('INVALID_SCREENING_ANSWERS', 400);
    return { question, answer };
  });
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readScreeningAnswers(value: unknown): ScreeningAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return typeof record.question === 'string' && typeof record.answer === 'string'
      ? [{ question: record.question, answer: record.answer }]
      : [];
  });
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
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

function industryFor(value: string | null): ShiftIndustry {
  const normalized = value?.toLocaleLowerCase() ?? '';
  if (normalized.includes('retail') || normalized.includes('venta')) return 'RETAIL';
  if (normalized.includes('evento')) return 'EVENTS';
  if (normalized.includes('rest') || normalized.includes('alimento') || normalized.includes('gastron')) return 'FOOD_SERVICE';
  return 'HOSPITALITY';
}

function formatSchedule(startsAt: Date, endsAt: Date) {
  const date = new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Lima',
  }).format(startsAt).replace('.', '');
  const time = new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Lima',
  });
  return `${date.charAt(0).toUpperCase()}${date.slice(1)} · ${time.format(startsAt)} – ${time.format(endsAt)}`;
}
