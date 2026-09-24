import { PrismaClient, type Company, type Prisma, type Shift } from '@prisma/client';

import { filterShifts, type ShiftIndustry, type ShiftSearchFilter } from './shift_search.js';
import {
  checkInWindowViolation,
  deriveShiftStatus,
  nextOperationalAction,
  resolveAssignmentLifecycle,
  type OperationalAction,
  type OperationalAssignmentStatus,
} from '../operations/shift-state.js';
import { withSerializableRetry } from '../operations/serializable-retry.js';

export type DemoShiftStatus = 'PUBLISHED' | 'ASSIGNED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';

export interface DemoShift {
  id: string;
  role: string;
  businessName: string;
  dateLabel: string;
  /**
   * ISO 8601. Único campo de fecha real expuesto a los clientes del
   * marketplace (`dateLabel` es solo texto). Sin `endsAt` el cliente no puede
   * distinguir una asignación aceptada que sigue vigente de una cuyo turno ya
   * venció -no existe transición automática por tiempo en `ShiftStatus`-, lo
   * que permitía que `HttpWorkerMarketplaceRepository` reofreciera
   * indefinidamente acciones (confirmar/check-in) sobre turnos que el
   * servidor ya rechazaba siempre (ver CN-20260916-099 ALTO-1).
   */
  endsAt: string;
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
    status: OperationalAssignmentStatus;
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
    public readonly code:
      | 'SHIFT_NOT_FOUND'
      | 'SHIFT_UNAVAILABLE'
      | 'ASSIGNMENT_NOT_FOUND'
      | 'INVALID_CHECK_IN'
      | 'CHECK_IN_TOO_EARLY'
      | 'ASSIGNMENT_NOT_ACTIONABLE'
      | 'CANCELLATION_NOT_ALLOWED'
      | 'INVALID_SCREENING_ANSWERS'
      | 'DIRECT_ASSIGNMENT_DISABLED'
      | 'PAYMENT_NOT_FOUND'
      | 'PAYMENT_NOT_REPORTABLE',
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
    // Este servicio en memoria no tiene un reloj de demostración propio: se
    // usa una fecha muy alejada en el futuro para que `endsAt` nunca se
    // considere vencido mientras dure el proceso, ya que ninguna de las dos
    // demos simuladas necesita ejercer esa regla.
    const farFutureEndsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    this.shifts = [
      {
        id: 'shift-la-mar', role: 'Mozo de Salón', businessName: 'Restaurante La Mar',
        dateLabel: 'Hoy · 18:00 – 00:00', endsAt: farFutureEndsAt, location: 'Miraflores, Lima', rateCents: 10000,
        ...firstPayment, status: 'PUBLISHED', industry: 'HOSPITALITY', urgent: true, matchScore: 98,
        description: 'Apoya al equipo de salón durante un turno de alta demanda.',
        responsibilities: 'Preparar el salón\nAtender mesas\nCoordinar con cocina',
        requirements: 'Experiencia en atención al cliente y disponibilidad completa.',
        screeningQuestions: [],
        modality: 'PRESENCIAL',
      },
      {
        id: 'shift-eventos-peru', role: 'Ayudante de Cocina', businessName: 'Eventos Perú',
        dateLabel: 'Sábado · 10:00 – 18:00', endsAt: farFutureEndsAt, location: 'San Isidro, Lima', rateCents: 12000,
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

  /**
   * Transacción de una operación del trabajador sobre SU asignación
   * (`confirmAssignment`, `checkIn`, `checkOut`, `cancelAssignment` y la
   * persistencia del ciclo de vida). Bloquea primero las filas de la
   * postulación (solo si `application`), de la asignación y del turno (salvo
   * `shift: false`), siempre en ese orden, y recién después lee y escribe:
   * dos llamadas sobre la misma asignación (o sobre el mismo turno) se
   * serializan y la que llega segunda relee el estado que dejó la primera,
   * mientras que trabajadores en turnos distintos no se esperan.
   *
   * Se usa `READ COMMITTED` a propósito. El aislamiento `Serializable` de
   * CN-20260923-010 lograba lo mismo por detección de conflictos, pero con 4 o
   * más trabajadores simultáneos (aunque cada uno actuara sobre su propia
   * asignación) agotaba los 3 reintentos de `P2034` y la ráfaga respondía
   * `401` a casi todos (CN-20260923-011, ALTO-1).
   *
   * ORDEN DE BLOQUEO GLOBAL (CN-20260923-013, MEDIO-1): postulación ->
   * asignación -> turno. Es el orden que también siguen las operaciones de la
   * empresa que bloquean varias de estas filas (`cancelShift`: postulaciones,
   * luego asignaciones, luego el turno; `decideShiftApplication`: postulación,
   * luego la asignación nueva, luego el turno; `resolveAssignment` y la
   * persistencia del ciclo de vida: asignación y luego turno, un subconjunto
   * del mismo orden). Una transacción que respeta ese orden nunca espera una
   * fila que otra tenga mientras esta tenga una anterior en el orden, así que
   * no se forman ciclos entre el trabajador y la empresa. Antes `cancelShift`
   * tomaba asignaciones y luego postulaciones (orden inverso a
   * `cancelAssignment`) y el cruce daba un interbloqueo real (`40P01`) que
   * terminaba en `500`, ver `docs/reference/api.md` ("Orden de bloqueo").
   *
   * Cualquier cambio de esas operaciones tiene que conservar el orden. Aun así,
   * `withSerializableRetry` reintenta `40P01` (medido: P2010 con `meta.code`
   * `40P01` en estas consultas crudas) como red de seguridad para un cruce que
   * este orden no prevea, p. ej. una transacción ajena a esta API. Una
   * transacción `READ COMMITTED` no produce fallos de serialización (`40001`),
   * solo interbloqueos. Cuando es la transacción `Serializable` de la EMPRESA
   * la que choca con una escritura confirmada de una operación del trabajador,
   * el que recibe `P2034` y reintenta es la empresa, no el trabajador.
   *
   * Cada bloqueo es `FOR NO KEY UPDATE`: excluye a otros escritores de la
   * misma fila pero no bloquea a quien solo inserta filas que la referencian
   * (p. ej. `ShiftEvent`).
   */
  private lockedTransaction<T>(
    workerId: string,
    shiftId: string,
    locks: { application?: boolean; shift?: boolean },
    body: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      if (locks.application) {
        await tx.$queryRaw`SELECT "id" FROM "ShiftApplication" WHERE "workerId" = ${workerId} AND "shiftId" = ${shiftId} FOR NO KEY UPDATE`;
      }
      await tx.$queryRaw`SELECT "id" FROM "ShiftAssignment" WHERE "workerId" = ${workerId} AND "shiftId" = ${shiftId} FOR NO KEY UPDATE`;
      if (locks.shift !== false) {
        await tx.$queryRaw`SELECT "id" FROM "Shift" WHERE "id" = ${shiftId} FOR NO KEY UPDATE`;
      }
      return body(tx);
    }, { isolationLevel: 'ReadCommitted' }));
  }

  async confirmAssignment(workerId: string, shiftId: string) {
    // La asignación se bloquea y se lee DENTRO de la transacción (ver
    // `lockedTransaction`): confirmar contra una cancelación simultánea tiene un
    // único ganador coherente (si cancela primero, la confirmación responde
    // `404` y no escribe ni evento ni `workerConfirmedAt`). Antes la lectura y
    // el `update` iban sin transacción y sin guarda de estado, y una
    // confirmación podía aplicarse sobre una asignación ya `CANCELLED`
    // (CN-20260923-010).
    return this.lockedTransaction(workerId, shiftId, { shift: false }, async (tx) => {
      const assignment = await tx.shiftAssignment.findFirst({
        where: {
          workerId,
          shiftId,
          status: 'ASSIGNED',
          // La confirmación depende de la asignación propia, no del estado
          // agregado del turno: en un turno multi-cupo, cuando otro trabajador
          // ya hizo check-in el turno está `CHECKED_IN` y los demás asignados
          // deben poder confirmar (y luego hacer su check-in) igual. Solo los
          // turnos terminales (`COMPLETED`/`CANCELLED`) quedan excluidos
          // (CN-20260923-006).
          shift: { status: { notIn: ['COMPLETED', 'CANCELLED'] }, endsAt: { gt: new Date() } },
        },
        include: { shift: { include: { company: true } }, application: true },
      });
      if (!assignment) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
      if (assignment.workerConfirmedAt) return toWorkerApplication({ ...assignment.application, shiftId, shift: assignment.shift, assignment });
      const updated = await tx.shiftAssignment.update({
        where: { id: assignment.id },
        data: { workerConfirmedAt: new Date() },
        include: { shift: { include: { company: true } } },
      });
      await tx.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'WORKER', type: 'ASSIGNMENT_CONFIRMED' } });
      return toWorkerApplication({
        id: assignment.applicationId,
        shiftId,
        status: 'ACCEPTED',
        createdAt: assignment.assignedAt,
        updatedAt: updated.updatedAt,
        shift: updated.shift,
        assignment: updated,
      });
    });
  }

  /**
   * Resuelve el ciclo de vida de una asignación puntual (`NO_SHOW`/`ABANDONED`,
   * ver `shift-state.ts`) y, si cambió, lo persiste junto con el estado
   * agregado del turno para que ese cupo quede libre para reasignación. Se
   * invoca solo desde puntos que ya tocan una asignación individual
   * (`checkIn`, `checkOut`) — nunca desde listados/polling masivo.
   */
  private async resolveAndPersistLifecycle(assignment: {
    id: string;
    workerId: string;
    shiftId: string;
    status: string;
    assignedAt?: Date | null;
    checkedInAt: Date | null;
    checkedOutAt: Date | null;
    shift: { status: string; startsAt: Date; endsAt: Date; requiredWorkers: number };
  }) {
    const lifecycle = resolveAssignmentLifecycle(assignment as never, assignment.shift);
    if (!lifecycle.changed) return lifecycle.status;
    return this.lockedTransaction(assignment.workerId, assignment.shiftId, {}, async (tx) => {
      // La asignación y el turno se releen en cada intento: la decisión de
      // `lifecycle` se calculó con una lectura previa que puede haber quedado
      // obsoleta (p. ej. otro check-out la completó mientras tanto) y no debe
      // sobrescribir un estado más reciente (CN-20260923-010).
      const fresh = await tx.shiftAssignment.findFirst({ where: { id: assignment.id }, include: { shift: true } });
      if (!fresh || ['CANCELLED', 'COMPLETED'].includes(fresh.status)) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
      const current = resolveAssignmentLifecycle(fresh as never, fresh.shift);
      if (!current.changed) return current.status;
      await tx.shiftAssignment.update({ where: { id: fresh.id }, data: { status: current.status as never } });
      // Rastro de auditoría de la transición automática (ver MEDIO-1 de
      // CN-20260918-002). No existe un `ShiftEventType` dedicado a
      // `NO_SHOW`/`ABANDONED`; se reutiliza `CANCELLED` (el precedente más
      // cercano) con actor `SYSTEM`, igual que en `business.service.ts`.
      await tx.shiftEvent.create({
        data: {
          shiftId: fresh.shiftId,
          actorId: null,
          actorRole: 'SYSTEM',
          type: 'CANCELLED',
          detail: current.status === 'NO_SHOW'
            ? `Asignación ${fresh.id} marcada NO_SHOW automáticamente: sin check-in dentro de la ventana`
            : `Asignación ${fresh.id} marcada ABANDONED automáticamente: check-in sin check-out tras el margen de tolerancia`,
        },
      });
      const assignments = await tx.shiftAssignment.findMany({ where: { shiftId: fresh.shiftId } });
      const nextShiftStatus = deriveShiftStatus(fresh.shift.status as never, fresh.shift.requiredWorkers, assignments as never, fresh.shift);
      const confirmedWorkers = assignments.filter((candidate) => candidate.status === 'ASSIGNED').length;
      await tx.shift.update({ where: { id: fresh.shiftId }, data: { status: nextShiftStatus as never, confirmedWorkers } });
      return current.status;
    });
  }

  /**
   * Comprobaciones de `checkIn` posteriores al ciclo de vida, sobre una
   * lectura de la asignación y su turno. Se ejecutan dos veces: sobre la
   * lectura previa (respuesta rápida y misma cascada de errores de siempre) y
   * de nuevo sobre la relectura dentro de la transacción reintentable, que es
   * la que decide. Devuelve la respuesta idempotente si el check-in ya
   * estaba registrado.
   */
  private assertCanCheckIn(
    assignment: {
      assignedAt: Date | null;
      workerConfirmedAt: Date | null;
      checkedInAt: Date | null;
      checkInCredential: string | null;
      shift: { status: string; startsAt: Date; endsAt: Date };
    },
    shiftId: string,
    credential: string,
  ) {
    // Guard directo contra `endsAt`, independiente de la ventana relativa a
    // `startsAt` (`checkInWindowViolation`/`resolveAndPersistLifecycle`): en
    // un turno más corto que `CHECK_IN_LATE_LIMIT_MS` la ventana por tardanza
    // puede seguir "abierta" después de que el turno ya terminó, porque
    // `shiftSchema` no impone una duración mínima. Sin este guard se podía
    // aceptar un check-in después de `endsAt` (ver MEDIO-3 de
    // CN-20260918-002); es el mismo guard que existía antes de introducir la
    // ventana de tiempo, restaurado para que ambos sean consistentes entre sí.
    if (!assignment.workerConfirmedAt || assignment.shift.endsAt <= new Date() || ['COMPLETED', 'CANCELLED'].includes(assignment.shift.status)) {
      throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    }
    if (assignment.checkedInAt) return { shiftId, checkedInAt: assignment.checkedInAt.toISOString() };
    // La tardanza más allá de la ventana ya la captura `resolveAndPersistLifecycle`
    // (la asignación pasa a `NO_SHOW` y `checkIn` ya retornó
    // `ASSIGNMENT_NOT_ACTIONABLE`): a este punto solo puede quedar la
    // violación por llegar demasiado temprano.
    if (checkInWindowViolation(assignment.shift, new Date(), assignment.assignedAt) === 'TOO_EARLY') throw new MarketplaceError('CHECK_IN_TOO_EARLY', 409);
    if (!assignment.checkInCredential || credential.trim() !== assignment.checkInCredential) throw new MarketplaceError('INVALID_CHECK_IN', 400);
    return null;
  }

  async checkIn(workerId: string, shiftId: string, credential: string) {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { workerId, shiftId },
      include: { shift: true },
    });
    if (!assignment || ['CANCELLED', 'COMPLETED'].includes(assignment.status)) {
      throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    }
    const lifecycleStatus = await this.resolveAndPersistLifecycle(assignment);
    if (lifecycleStatus !== 'ASSIGNED') throw new MarketplaceError('ASSIGNMENT_NOT_ACTIONABLE', 409);
    const alreadyCheckedIn = this.assertCanCheckIn(assignment, shiftId, credential);
    if (alreadyCheckedIn) return alreadyCheckedIn;
    return this.lockedTransaction(workerId, shiftId, {}, async (tx) => {
      // La asignación y el turno se releen ya bloqueados y se revalidan: la
      // lectura de arriba puede estar obsoleta (otro check-in, una
      // cancelación, un `NO_SHOW`) y no debe aplicarse tal cual. Un segundo check-in simultáneo responde igual que uno
      // secuencial (`200` con el `checkedInAt` original) y solo hay un
      // `CHECKED_IN` (CN-20260923-010).
      const current = await tx.shiftAssignment.findFirst({ where: { workerId, shiftId }, include: { shift: true } });
      if (!current || ['CANCELLED', 'COMPLETED'].includes(current.status)) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
      if (resolveAssignmentLifecycle(current as never, current.shift).status !== 'ASSIGNED') throw new MarketplaceError('ASSIGNMENT_NOT_ACTIONABLE', 409);
      const settled = this.assertCanCheckIn(current, shiftId, credential);
      if (settled) return settled;
      const checkedInAt = new Date();
      await tx.shiftAssignment.update({ where: { id: current.id }, data: { checkedInAt } });
      const assignments = await tx.shiftAssignment.findMany({ where: { shiftId } });
      const status = deriveShiftStatus(current.shift.status as never, current.shift.requiredWorkers, assignments as never, current.shift);
      await tx.shift.update({ where: { id: shiftId }, data: { status } });
      await tx.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'WORKER', type: 'CHECKED_IN' } });
      return { shiftId, checkedInAt: checkedInAt.toISOString() };
    });
  }

  async checkOut(workerId: string, shiftId: string) {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { workerId, shiftId },
      include: { shift: { include: { company: true } } },
    });
    if (!assignment || ['CANCELLED', 'COMPLETED'].includes(assignment.status)) {
      throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
    }
    const lifecycleStatus = await this.resolveAndPersistLifecycle(assignment);
    if (lifecycleStatus !== 'ASSIGNED') throw new MarketplaceError('ASSIGNMENT_NOT_ACTIONABLE', 409);
    if (!assignment.checkedInAt) throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    return this.lockedTransaction(workerId, shiftId, {}, async (tx) => {
      // Relectura y revalidación en cada intento (ver `checkIn`): un segundo
      // check-out simultáneo encuentra la asignación ya `COMPLETED` y responde
      // `404 ASSIGNMENT_NOT_FOUND`, igual que una llamada secuencial repetida,
      // sin sobrescribir `completedAt` ni duplicar el `CHECKED_OUT`, el
      // `COMPLETED` ni el pago (CN-20260923-010).
      const current = await tx.shiftAssignment.findFirst({ where: { workerId, shiftId }, include: { shift: { include: { company: true } } } });
      if (!current || ['CANCELLED', 'COMPLETED'].includes(current.status)) throw new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404);
      if (resolveAssignmentLifecycle(current as never, current.shift).status !== 'ASSIGNED') throw new MarketplaceError('ASSIGNMENT_NOT_ACTIONABLE', 409);
      if (!current.checkedInAt) throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
      const checkedOutAt = new Date();
      await tx.shiftAssignment.update({
        where: { id: current.id },
        data: { checkedOutAt, completedAt: checkedOutAt, status: 'COMPLETED' },
      });
      const assignments = await tx.shiftAssignment.findMany({ where: { shiftId } });
      const status = deriveShiftStatus(current.shift.status as never, current.shift.requiredWorkers, assignments as never, current.shift);
      await tx.shift.update({ where: { id: shiftId }, data: { status } });
      await tx.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'WORKER', type: 'CHECKED_OUT' } });
      await tx.payment.upsert({
        where: { assignmentId: current.id },
        update: {},
        create: {
          companyId: current.shift.companyId,
          shiftId,
          assignmentId: current.id,
          reference: `CN-${shiftId.slice(-8).toUpperCase()}-${current.id.slice(-8).toUpperCase()}`,
          description: `${current.shift.title} · ${current.shift.company.name}`,
          amountCents: current.shift.payCents,
          workerCount: 1,
          status: 'PENDING',
          dueAt: checkedOutAt,
        },
      });
      if (status === 'COMPLETED') {
        await tx.shiftEvent.create({ data: { shiftId, actorId: workerId, actorRole: 'SYSTEM', type: 'COMPLETED' } });
      }
      return { shiftId, checkedOutAt: checkedOutAt.toISOString() };
    });
  }

  async cancelAssignment(workerId: string, shiftId: string, reason: string) {
    if (reason.trim().length < 3) throw new MarketplaceError('CANCELLATION_NOT_ALLOWED', 400);
    // Con bloqueo de filas: cancelar contra un check-in (o contra otra
    // cancelación) simultáneo tiene un único ganador. La postulación y su
    // asignación se leen ya bloqueadas; si el check-in gana, la
    // cancelación responde `409 CANCELLATION_NOT_ALLOWED`, y si gana la
    // cancelación, el check-in responde `404` (CN-20260923-010).
    return this.lockedTransaction(workerId, shiftId, { application: true }, async (tx) => {
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
        const status = deriveShiftStatus(application.shift.status, application.shift.requiredWorkers, assignments, application.shift);
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
    endsAt: shift.endsAt.toISOString(),
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
    status: OperationalAssignmentStatus;
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
