import { randomBytes } from 'node:crypto';

import {
  ConversationStatus,
  MessageSender,
  PaymentStatus,
  PrismaClient,
  WorkerStatus,
} from '@prisma/client';

import type { AuthSession } from '../auth/auth.service.js';
import { companyCanViewApplicantCv } from '../talent/cv_access.js';
import { deriveShiftStatus, isTerminalShift, nextOperationalAction, resolveAssignmentLifecycle } from '../operations/shift-state.js';
import { withSerializableRetry } from '../operations/serializable-retry.js';
import { buildPaymentAmounts, getPlatformSettings } from '../payments/payment-amounts.js';
import {
  checkoutPayment as checkoutPaymentWithProvider,
  expireStaleScheduledPayments,
  PaymentNotFoundError,
  PaymentNotPayableError as PaymentGatewayNotPayableError,
  ProviderManualError,
  ProviderUnavailableError,
  activePaymentProviderName,
  resolvePaymentProvider,
  type CheckoutResponse,
} from '../payments/payments.service.js';

// Se reexportan para que `business.routes.ts` pueda distinguirlos en
// `sendError` sin importar directamente del módulo `payments` (mismo
// patrón que el resto de errores de dominio de este archivo).
export { PaymentNotFoundError, ProviderManualError, ProviderUnavailableError };

// Se reexporta para no romper a quien ya lo importaba desde este módulo.
export { withSerializableRetry };

/**
 * Antes se derivaba solo de `shiftId` (`CUMPLE-${shift.id.slice(-8)}`), así
 * que todas las asignaciones de un turno multi-cupo (`requiredWorkers > 1`)
 * compartían literalmente la misma credencial de check-in: cualquier
 * trabajador asignado a ese turno podía hacer check-in por otro. Ahora es
 * aleatoria por asignación (no derivada de ningún dato del turno ni del
 * trabajador), generada con `crypto.randomBytes` (no `Math.random`).
 */
function generateCheckInCredential() {
  return `CUMPLE-${randomBytes(4).toString('hex').toUpperCase()}`;
}

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
  /**
   * Los bps que el panel mostró en la vista previa al momento de enviar el
   * formulario (`GET /business/payment-settings`). Si no coinciden con el
   * ajuste global vigente al crear el turno, `createShift` lanza
   * `CommissionChangedError` (409 `COMMISSION_CHANGED`) en vez de publicar
   * con un % que la empresa nunca vio. Ignorados por `updateShift`: editar
   * un turno ya publicado nunca toca su comisión (queda congelada desde que
   * se creó).
   */
  expectedCommissionBps?: number;
  expectedTaxBps?: number;
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

export type ApplicationDecision = 'ACCEPTED' | 'REJECTED';
export type PendingApplicationsSummary = { count: number; shiftIds: string[] };
export type AssignmentResolutionOutcome = 'COMPLETED' | 'CANCELLED';

export class BusinessRecordNotFoundError extends Error {}
export class BusinessValidationError extends Error {}
export class BusinessForbiddenError extends Error {}

/**
 * `POST /business/payments/:id/mark-paid` (Alcance D) contra un pago que
 * existe y es de la empresa, pero no está en condición de marcarse pagado:
 * ya no es `PENDING` (otra llamada ganó la carrera, o está `PROCESSED`/
 * `CANCELLED`), o su `provider` no es `'manual'`/`'legacy'` (una pasarela,
 * Alcance E, tiene su propio flujo de confirmación vía webhook, nunca este
 * endpoint manual). 409, nunca 400: el `id` es válido y de esta empresa,
 * solo que la transición pedida ya no aplica.
 */
export class PaymentNotPayableError extends Error {}

/**
 * "Cerrada sin pago" (Alcance D; corrección de MEDIO-1 de `CN-20260926-020`):
 * una asignación que llegó a `NO_SHOW` o `ABANDONED` (el trabajador se
 * presentó o no) y que una decisión de la empresa cerró sin generar
 * `Payment`. Nunca se detecta por texto libre (`ShiftEvent.detail`): un
 * motivo de `cancelShift` que casualmente empezara con cierto prefijo podía
 * falsear el conteo, y una `NO_SHOW`/`ABANDONED` nunca resuelta lo evadía
 * sin dejar ningún rastro. La señal es estructurada, en `ShiftAssignment`:
 * `closedWithoutPayment`/`closedWithoutPaymentAt`/`closedWithoutPaymentById`,
 * escritos en los dos únicos caminos que la producen -`resolveAssignment`
 * con `outcome: 'CANCELLED'` (abajo) y `cancelShift` arrastrando una
 * asignación `NO_SHOW` (más abajo)-, nunca en una `ASSIGNED` simple (jamás
 * llegó a "presentarse o no", cancelar un turno futuro no es evasión) ni en
 * una ya `CANCELLED`/`COMPLETED`. `GET /api/admin/commissions` los cuenta
 * por empresa junto con `pendingResolution` (`NO_SHOW`/`ABANDONED` que la
 * empresa todavía no resolvió), para que dejarlas sin resolver no las
 * esconda del reporte.
 */

/**
 * BAJO-4 de CN-20260926-012: la vista previa que la empresa vio antes de
 * enviar el formulario (`GET /business/payment-settings`) puede haber
 * quedado obsoleta si el admin cambió el ajuste global mientras la empresa
 * completaba los demás campos. `createShift` la lanza cuando el
 * `expectedCommissionBps`/`expectedTaxBps` que el formulario envía no
 * coincide con el ajuste vigente AHORA MISMO, en vez de fijar en el turno
 * un % que la empresa nunca llegó a ver. Lleva los valores vigentes para
 * que el panel pueda refrescar su vista previa sin una segunda petición.
 */
export class CommissionChangedError extends Error {
  constructor(public readonly commissionBps: number, public readonly taxBps: number) {
    super('COMMISSION_CHANGED');
  }
}

export interface BusinessOperations {
  getCompany(session: AuthSession): Promise<unknown>;
  updateCompany(session: AuthSession, input: CompanyUpdate): Promise<unknown>;
  paymentSettings(session: AuthSession): Promise<unknown>;
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
  resolveAssignment(session: AuthSession, shiftId: string, assignmentId: string, outcome: AssignmentResolutionOutcome, reason?: string): Promise<unknown>;
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
  /**
   * Único endpoint de escritura que le queda al CRUD de pagos (Alcance D
   * retira `POST`/`PATCH`/`DELETE`: la empresa ya no puede inventar,
   * alterar montos ni borrar pagos). Solo transiciona un pago `PENDING` con
   * `provider` `'manual'` o `'legacy'` a `PROCESSED`; nunca toca ningún
   * monto.
   */
  markPaymentPaid(session: AuthSession, id: string): Promise<unknown>;
  /**
   * `POST /business/payments/:id/checkout` (Alcance E). Delega en
   * `payments.service.ts#checkoutPayment` tras resolver la empresa dueña de
   * la sesión; solo aplica si el proveedor activo no es `'manual'`.
   */
  checkoutPayment(session: AuthSession, id: string): Promise<CheckoutResponse>;
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

  /**
   * Ajuste global vigente que se congelaría en un turno nuevo, para la
   * vista previa del formulario de publicación. `mode: 'manual'` queda fijo
   * en este alcance; el Alcance E lo leerá de `PAYMENT_PROVIDER`.
   */
  async paymentSettings(session: AuthSession) {
    void session; // No depende de la empresa: el ajuste es global.
    const { commissionBps, taxBps } = await getPlatformSettings(this.prisma);
    // Alcance E: `mode` ya no queda fijo en `'manual'`; es el nombre del
    // adaptador activo (`PAYMENT_PROVIDER`, ver `payments.service.ts`).
    return { commissionBps, taxBps, currency: 'PEN', mode: resolvePaymentProvider().name };
  }

  async listShifts(session: AuthSession) {
    const company = await this.companyFor(session);
    return this.prisma.shift.findMany({ where: { companyId: company.id }, orderBy: { startsAt: 'asc' } });
  }

  async getShift(session: AuthSession, id: string) {
    const shift = await this.ownedShift(session, id);
    const { shift: resolved } = await this.resolveShiftAssignmentsLifecycle(shift);
    return resolved;
  }

  async createShift(session: AuthSession, input: ShiftInput) {
    const company = await this.companyFor(session);
    const { expectedCommissionBps, expectedTaxBps, ...shiftData } = input;
    // La comisión y el IGV vigentes quedan fijados en el turno al publicarlo
    // (decisión del plan de pagos): un cambio posterior del ajuste global
    // (`PlatformSettings`, `PATCH /api/admin/settings`) nunca altera turnos
    // ya publicados, editados o no. No hay ciclo de "borrador" para un turno
    // (`createShift` siempre lo deja en `PUBLISHED`, ver `ShiftInput`), así
    // que no existe un estado previo a la publicación donde fijar esto antes
    // valdría la pena.
    const { commissionBps, taxBps } = await getPlatformSettings(this.prisma);
    // BAJO-4 de CN-20260926-012: si el formulario indica qué % mostró y ya
    // no coincide con el vigente, se rechaza en vez de publicar con un %
    // que la empresa no vio. Sin `expectedCommissionBps`/`expectedTaxBps`
    // (llamadas que no los envían) no se exige nada, para no romper otros
    // clientes de esta API.
    if (
      (expectedCommissionBps !== undefined && expectedCommissionBps !== commissionBps) ||
      (expectedTaxBps !== undefined && expectedTaxBps !== taxBps)
    ) {
      throw new CommissionChangedError(commissionBps, taxBps);
    }
    const shift = await this.prisma.shift.create({
      data: { ...shiftData, companyId: company.id, confirmedWorkers: 0, commissionBps, taxBps },
    });
    await this.prisma.shiftEvent.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', type: 'PUBLISHED', detail: 'Turno publicado' } });
    return shift;
  }

  async updateShift(session: AuthSession, id: string, input: Partial<ShiftInput>) {
    const shift = await this.ownedShift(session, id);
    // Un turno cuyo `endsAt` ya pasó queda cerrado para edición aunque el
    // estado persistido siga en 'PUBLISHED'/'ASSIGNED' (no hay transición
    // automática por tiempo). Sin este chequeo, una empresa podía seguir
    // editando -e incluso re-publicando con fechas nuevas- un turno que el
    // resto del sistema ya trata como vencido.
    if (isTerminalShift(shift.status) || shift.status === 'CHECKED_IN' || shift.endsAt <= new Date()) {
      throw new BusinessValidationError('SHIFT_NOT_EDITABLE');
    }
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
    // Solo comprueba la propiedad (404 si el turno no es de la empresa); el
    // estado y las asignaciones se leen DENTRO de la transacción reintentable.
    const owned = await this.ownedShift(session, id);
    // Corrección de MEDIO-1 (nuevo) de CN-20260926-022: sin esto, una
    // asignación que ya venció su ventana de check-in pero seguía `ASSIGNED`
    // en la base (nadie había abierto las postulaciones ni `resolve` para
    // persistir el `NO_SHOW`) pasaba a `CANCELLED` por el `updateMany` de
    // `ASSIGNED` de abajo, SIN la señal `closedWithoutPayment` -era otra vía
    // para ocultar un cierre sin pago con solo no abrir el panel-. Mismo
    // patrón que ya usa `resolveAssignment` (ver esa función): se persiste el
    // ciclo de vida en su propia transacción, ANTES de la de `cancelShift`,
    // para que la transacción de abajo relea el estado ya correcto
    // (`NO_SHOW`/`ABANDONED`) y aplique el `updateMany` que corresponde. Su
    // resultado no se usa como base de nada: `owned` sigue siendo solo una
    // lectura previa de propiedad.
    await this.resolveShiftAssignmentsLifecycle(owned);
    // `Serializable` + reintento (BAJO-1 y BAJO-2 de CN-20260920-004): antes esta
    // transacción no tenía aislamiento y los guards se evaluaban fuera de ella,
    // así que un `resolveAssignment` concurrente (que también es Serializable)
    // podía leer un estado que la cancelación estaba a punto de cambiar. Con el
    // mismo aislamiento el motor detecta el conflicto (`P2034`) y el reintento
    // vuelve a leer el turno y las asignaciones, no reutiliza una lectura previa.
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findUnique({ where: { id: owned.id } });
      if (!shift) throw new BusinessRecordNotFoundError('SHIFT_NOT_FOUND');
      if (isTerminalShift(shift.status) || shift.status === 'CHECKED_IN') throw new BusinessValidationError('SHIFT_NOT_CANCELLABLE');
      const checkedIn = await tx.shiftAssignment.count({ where: { shiftId: shift.id, checkedInAt: { not: null } } });
      if (checkedIn > 0) throw new BusinessValidationError('SHIFT_NOT_CANCELLABLE');
      // Incluye `NO_SHOW` junto con `ASSIGNED` (punto 3 de CN-20260922-013):
      // una asignación `NO_SHOW` sin resolver sobrevivía intacta a la
      // cancelación del turno completo (el guard de `checkedInAt` de arriba
      // no la bloquea, porque `NO_SHOW` nunca hizo check-in) y seguía siendo
      // resoluble vía `resolveAssignment` después, generando un `Payment`
      // sobre un turno ya `CANCELLED`. `ABANDONED` no hace falta: exige
      // `checkedInAt` no nulo, y ese mismo guard ya rechaza cancelar el
      // turno si existe algún `checkedInAt` no nulo.
      // ORDEN DE BLOQUEO GLOBAL (CN-20260923-013, MEDIO-1): postulación ->
      // asignación -> turno, el mismo con que las operaciones del trabajador
      // (`lockedTransaction` en `marketplace.service.ts`) bloquean sus filas. Antes
      // esto actualizaba primero las asignaciones y luego las postulaciones: si
      // el trabajador cancelaba a la vez (postulación y luego asignación),
      // PostgreSQL detectaba un interbloqueo (`40P01`) tras 1 s y una de las dos
      // llamadas respondía `500`. Ver `docs/reference/api.md`, "Orden de bloqueo".
      await tx.shiftApplication.updateMany({ where: { shiftId: shift.id, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'CANCELLED' } });
      // Separado en dos `updateMany` (antes uno solo): una `NO_SHOW` sí
      // "se presentó o no" (llegó a vencer su ventana de check-in) y esta
      // cancelación la cierra sin pago por decisión de la empresa, así que
      // cuenta como `closedWithoutPayment` (corrección de MEDIO-1 de
      // CN-20260926-020, "ocultar, segunda vía"). Una `ASSIGNED` simple
      // nunca llegó a ese punto -cancelar un turno futuro no es evasión- y
      // no lleva la señal.
      const cancelledAt = new Date();
      await tx.shiftAssignment.updateMany({ where: { shiftId: shift.id, status: 'ASSIGNED' }, data: { status: 'CANCELLED' } });
      await tx.shiftAssignment.updateMany({
        where: { shiftId: shift.id, status: 'NO_SHOW' },
        data: { status: 'CANCELLED', closedWithoutPayment: true, closedWithoutPaymentAt: cancelledAt, closedWithoutPaymentById: session.userId },
      });
      await tx.shiftCancellation.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', reason: reason.trim() } });
      await tx.shiftEvent.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', type: 'CANCELLED', detail: reason.trim() } });
      return tx.shift.update({ where: { id: shift.id }, data: { status: 'CANCELLED', confirmedWorkers: 0 }, include: { company: true } });
    }, { isolationLevel: 'Serializable' }));
  }

  async getSubscription(session: AuthSession) {
    const company = await this.companyFor(session);
    const subscription = await this.prisma.companySubscription.findUnique({ where: { companyId: company.id } });
    if (subscription) return subscription;
    // Antes, este `GET` hacía un `upsert` que dejaba una fila TRIAL real
    // persistida en la primera consulta, aunque nadie hubiera activado nada:
    // sentía a "Chambeaya ya te inscribió en algo". Sin fila real, devolvemos
    // un objeto sintético -nunca persistido- que declara explícitamente que
    // no hay plan activo. Solo una activación explícita (hoy no existe ese
    // endpoint) debe crear la fila real de `CompanySubscription`.
    return { companyId: company.id, plan: 'PILOT', status: 'INACTIVE', startsAt: null, endsAt: null, trialEndsAt: null };
  }

  async listShiftEvents(session: AuthSession, shiftId: string) {
    const shift = await this.ownedShift(session, shiftId);
    return this.prisma.shiftEvent.findMany({
      where: { shiftId: shift.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listShiftApplications(session: AuthSession, shiftId: string) {
    const owned = await this.ownedShift(session, shiftId);
    const { shift } = await this.resolveShiftAssignmentsLifecycle(owned);
    const applications = await this.prisma.shiftApplication.findMany({
      where: { shiftId: shift.id },
      include: {
        worker: {
          select: {
            id: true, name: true, email: true, identifier: true,
            // Solo para calcular `hasCv`; ni la visibilidad ni el documento
            // salen en la respuesta (el CV se pide bajo demanda aparte).
            talentProfile: { select: { isVisible: true } },
            documents: { where: { kind: 'CV' }, select: { id: true } },
          },
        },
        assignment: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return applications.map(({ worker: { talentProfile, documents, ...worker }, ...application }) => ({
      ...application,
      worker: {
        ...worker,
        hasCv: documents.length > 0 && companyCanViewApplicantCv({ applicationStatus: application.status, profileIsVisible: talentProfile?.isVisible }),
      },
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
      await tx.shiftAssignment.create({ data: { shiftId: shift.id, workerId: application.workerId, applicationId: application.id, checkInCredential: generateCheckInCredential() } });
      await tx.shiftEvent.create({ data: { shiftId: shift.id, actorId: session.userId, actorRole: 'BUSINESS', type: 'APPLICATION_ACCEPTED', detail: application.id } });
      const nextCount = assignedCount + 1;
      await tx.shift.update({ where: { id: shift.id }, data: { confirmedWorkers: nextCount, status: nextCount >= shift.requiredWorkers ? 'ASSIGNED' : 'PUBLISHED' } });
      return updated;
    }, { isolationLevel: 'Serializable' }));
  }

  /**
   * Resuelve el ciclo de vida (`NO_SHOW`/`ABANDONED`, ver `shift-state.ts`) de
   * cada asignación puntual de un turno y, si alguna cambió, persiste el
   * nuevo estado de esas asignaciones junto con el estado agregado del turno.
   * Se invoca solo desde puntos que ya abren un turno individual (`getShift`,
   * `listShiftApplications`, `resolveAssignment`) — nunca desde `listShifts`
   * ni desde ningún endpoint de listado/polling masivo, para no agregar una
   * escritura en cada refresco.
   */
  private async resolveShiftAssignmentsLifecycle(shift: {
    id: string;
    status: 'PUBLISHED' | 'ASSIGNED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
    startsAt: Date;
    endsAt: Date;
    requiredWorkers: number;
  }) {
    // Lectura previa SIN escritura (BAJO-3 de CN-20260918-002): solo decide si hay
    // algo que persistir, para que abrir un turno (`getShift`, `listShiftApplications`)
    // no abra una transacción `Serializable` cuando nada cambia. Nunca sirve de
    // base para escribir: puede quedar obsoleta en cualquier momento.
    // Orden por `id`: la transacción de abajo actualiza las asignaciones en este
    // orden, y dos lecturas concurrentes del mismo turno tienen que tomar las
    // filas en el mismo orden para no bloquearse en círculo (CN-20260923-013).
    const preview = await this.prisma.shiftAssignment.findMany({ where: { shiftId: shift.id }, orderBy: { id: 'asc' } });
    const previewNow = new Date();
    const previewResolved = preview.map((assignment) => ({ ...assignment, status: resolveAssignmentLifecycle(assignment, shift, previewNow).status }));
    if (!preview.some((assignment, index) => previewResolved[index]?.status !== assignment.status)) {
      return { shift, assignments: previewResolved };
    }
    // Todo lo que decide y escribe ocurre DENTRO de la transacción reintentable: el
    // turno y las asignaciones se releen en cada intento, la decisión se recalcula
    // sobre esa lectura y la asignación que dejó de ser `ASSIGNED` (una cancelación
    // del trabajador o de la empresa confirmada entre la lectura previa y esta
    // escritura, o la misma transición ya registrada por otra apertura simultánea)
    // no se pisa ni se duplica. Antes se escribía la decisión de la lectura previa,
    // también en cada reintento, y una asignación `CANCELLED` volvía a `NO_SHOW`
    // (resoluble con pago) y un turno `CANCELLED` a `PUBLISHED`. Orden de bloqueo
    // global postulación -> asignación -> turno (`docs/reference/api.md`): esta
    // transacción solo escribe asignaciones (por `id`) y después el turno.
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const current = await tx.shift.findUnique({ where: { id: shift.id } });
      if (!current) throw new BusinessRecordNotFoundError('SHIFT_NOT_FOUND');
      const assignments = await tx.shiftAssignment.findMany({ where: { shiftId: current.id }, orderBy: { id: 'asc' } });
      const now = new Date();
      const updates: { id: string; status: 'NO_SHOW' | 'ABANDONED' }[] = [];
      const resolved = assignments.map((assignment) => {
        const lifecycle = resolveAssignmentLifecycle(assignment, current, now);
        if (lifecycle.changed) updates.push({ id: assignment.id, status: lifecycle.status as 'NO_SHOW' | 'ABANDONED' });
        return { ...assignment, status: lifecycle.status };
      });
      if (updates.length === 0) return { shift: current, assignments: resolved };
      const nextStatus = deriveShiftStatus(current.status, current.requiredWorkers, resolved, current);
      const confirmedWorkers = resolved.filter((assignment) => assignment.status === 'ASSIGNED').length;
      for (const update of updates) {
        await tx.shiftAssignment.update({ where: { id: update.id }, data: { status: update.status } });
        // Rastro de auditoría de la transición automática (ver MEDIO-1 de
        // CN-20260918-002). No existe un `ShiftEventType` dedicado a
        // `NO_SHOW`/`ABANDONED`; se reutiliza `CANCELLED` (el precedente más
        // cercano: la asignación no va a completarse por sí sola) con actor
        // `SYSTEM` y el detalle deja constancia de cuál de los dos ocurrió.
        await tx.shiftEvent.create({
          data: {
            shiftId: current.id,
            actorId: null,
            actorRole: 'SYSTEM',
            type: 'CANCELLED',
            detail: update.status === 'NO_SHOW'
              ? `Asignación ${update.id} marcada NO_SHOW automáticamente: sin check-in dentro de la ventana`
              : `Asignación ${update.id} marcada ABANDONED automáticamente: check-in sin check-out tras el margen de tolerancia`,
          },
        });
      }
      const updatedShift = await tx.shift.update({ where: { id: current.id }, data: { status: nextStatus, confirmedWorkers } });
      return { shift: updatedShift, assignments: resolved };
    }, { isolationLevel: 'Serializable' }));
  }

  async resolveAssignment(session: AuthSession, shiftId: string, assignmentId: string, outcome: AssignmentResolutionOutcome, reason?: string) {
    const owned = await this.ownedShift(session, shiftId);
    // Pone al día el ciclo de vida (`NO_SHOW`/`ABANDONED`, y el cierre del turno
    // como `CANCELLED` si corresponde) en su propia transacción. Su resultado
    // NO se usa como base del cálculo: `owned` y ese resultado son lecturas
    // previas que pueden quedar obsoletas (BAJO-5 de CN-20260918-004) y, sobre
    // todo, un reintento de la transacción de abajo (`P2034`) las reutilizaría
    // tal cual (BAJO-2 de CN-20260920-004). La asignación y el turno (`current`)
    // se leen dentro de la transacción reintentable.
    await this.resolveShiftAssignmentsLifecycle(owned);
    // Una asignación `ABANDONED` (hizo check-in, nunca hizo check-out, ya
    // pasó el margen) o `NO_SHOW` (nunca hizo check-in, ventana cerrada)
    // admite este cierre manual: son las dos situaciones donde el sistema
    // deliberadamente no decide nada por su cuenta (para no generar ni
    // destruir un pago sin una decisión humana, ver ALTO-1 de
    // CN-20260918-002). `CANCELLED` siempre está disponible para ambas
    // (nunca se generó ni corresponde generar un pago); `COMPLETED` también
    // está disponible para `NO_SHOW` cuando la empresa confirma que el
    // trabajador sí llegó y trabajó el turno completo pese a no haber hecho
    // check-in a tiempo (por ejemplo, un problema con la app o la señal).
    // `ASSIGNED` sigue su curso normal; `COMPLETED`/`CANCELLED` ya están
    // cerradas.
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      // Lectura DENTRO de la transacción (y por tanto en cada reintento): si una
      // cancelación del turno (`cancelShift`) o otra resolución concurrente
      // cambió la asignación, el reintento la ve y responde
      // `ASSIGNMENT_NOT_RESOLVABLE` en vez de pisarla (y generar un pago sobre un
      // turno ya cancelado).
      const assignment = await tx.shiftAssignment.findFirst({
        where: { id: assignmentId, shiftId: owned.id },
        include: { shift: { include: { company: true } } },
      });
      if (!assignment) throw new BusinessRecordNotFoundError('ASSIGNMENT_NOT_FOUND');
      const sourceStatus = assignment.status;
      if (!['ABANDONED', 'NO_SHOW'].includes(sourceStatus)) throw new BusinessValidationError('ASSIGNMENT_NOT_RESOLVABLE');
      // `current`: el turno ya puesto al día por el ciclo de vida (si marcó
      // `NO_SHOW`/`ABANDONED` y cerró el turno como `CANCELLED`, aquí ya figura
      // `CANCELLED`), releído en cada intento.
      const current = assignment.shift;
      const completedAt = new Date();
      const updated = await tx.shiftAssignment.update({
        where: { id: assignment.id },
        data: {
          status: outcome,
          completedAt: outcome === 'COMPLETED' ? completedAt : assignment.completedAt,
          // Señal estructurada de "cerrada sin pago" (ver el comentario
          // arriba de este archivo): nunca se lee para nada más que este
          // `if`, y nunca depende de `reason` ni de ningún texto.
          ...(outcome === 'CANCELLED'
            ? { closedWithoutPayment: true, closedWithoutPaymentAt: completedAt, closedWithoutPaymentById: session.userId }
            : {}),
        },
      });
      const sourceLabel = sourceStatus === 'ABANDONED' ? 'abandonada (check-in sin check-out)' : 'no-show (sin check-in a tiempo)';
      await tx.shiftEvent.create({
        data: {
          shiftId: owned.id,
          actorId: session.userId,
          actorRole: 'BUSINESS',
          type: outcome === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
          detail: reason?.trim() || (outcome === 'COMPLETED'
            ? `Cierre manual de una asignación ${sourceLabel}: turno completado`
            : `Cierre manual de una asignación ${sourceLabel}: turno cancelado`),
        },
      });
      if (outcome === 'COMPLETED') {
        // `Shift.commissionBps`/`taxBps` siempre tienen un valor (`NOT NULL`
        // desde la migración que los introdujo: los turnos anteriores a ella
        // quedaron en 0/0, decisión del usuario en MEDIO-2 de
        // CN-20260926-012). Nunca se lee el ajuste global aquí: cada turno
        // ya trae el suyo, fijado para siempre al publicarse.
        const amounts = buildPaymentAmounts(assignment.shift.payCents, assignment.shift.commissionBps, assignment.shift.taxBps);
        // Misma forma de `Payment` que crea `checkOut` en
        // `marketplace.service.ts`: un reporte manual, nunca una pasarela ni
        // custodia de fondos. `upsert` es defensivo (idempotente si esta
        // asignación ya tuviera un pago por alguna otra vía).
        await tx.payment.upsert({
          where: { assignmentId: assignment.id },
          update: {},
          create: {
            companyId: assignment.shift.companyId,
            shiftId: owned.id,
            assignmentId: assignment.id,
            reference: `CN-${owned.id.slice(-8).toUpperCase()}-${assignment.id.slice(-8).toUpperCase()}`,
            description: `${assignment.shift.title} · ${assignment.shift.company.name}`,
            amountCents: amounts.amountCents,
            commissionBps: amounts.commissionBps,
            commissionCents: amounts.commissionCents,
            taxBps: amounts.taxBps,
            taxCents: amounts.taxCents,
            totalCents: amounts.totalCents,
            // Alcance E: el pago nace con el proveedor ACTIVO en este
            // instante (no fijo en `'manual'`), para que el reporte de
            // comisiones (`GET /api/admin/commissions`) lo clasifique bien
            // como "por facturar" (manual) o de pasarela.
            provider: resolvePaymentProvider().name,
            workerCount: 1,
            status: 'PENDING',
            dueAt: completedAt,
          },
        });
      }
      const assignments = await tx.shiftAssignment.findMany({ where: { shiftId: owned.id } });
      // Base del cálculo: el turno ya puesto al día (`current`), no `owned`.
      // `deriveShiftStatus` devuelve siempre `CANCELLED` si la base ya lo es,
      // así que un turno que el ciclo de vencimiento cerró "sin asignaciones
      // viables" (ALTO-2 de CN-20260918-002) quedaba `CANCELLED` aunque la
      // empresa confirmara con `COMPLETED` que el trabajo sí ocurrió y ya
      // existiera un `Payment`. Solo en ese caso se reabre el turno, y solo si
      // el recálculo lo deja `COMPLETED`:
      //  - si daría `CHECKED_IN` (multi-cupo con cupos sin cerrar) se mantiene
      //    `CANCELLED`: un turno vencido en `CHECKED_IN` y sin asignación
      //    `ASSIGNED` que resolver ya no lo mueve ningún endpoint (`cancelShift`,
      //    `updateShift` y `deleteShift` lo rechazan): quedaría "fantasma"
      //    (ALTO-2 de CN-20260918-002, MEDIO-2 de CN-20260920-004). El pago
      //    pendiente se registra igual;
      //  - NO se reabre si la empresa canceló el turno ella misma: `cancelShift`
      //    es la única ruta que escribe un `ShiftCancellation` con
      //    `actorRole: 'BUSINESS'`. La cancelación de un trabajador
      //    (`actorRole: 'WORKER'`, `marketplace.cancelAssignment`) nunca cancela
      //    el turno por sí sola y su `assignmentId` puede ser nulo (postulación
      //    aún `PENDING`, o asignación borrada, `onDelete: SetNull`), así que
      //    `assignmentId` no distingue a la empresa; `actorRole` sí (MEDIO-1 de
      //    CN-20260920-004). Si algún día la empresa cancelara una sola
      //    asignación con este rol, este criterio debe revisarse;
      //  - NO se reabre si el turno aún no venció (un cierre por vencimiento
      //    exige `endsAt <= ahora`);
      //  - `CANCELLED` (cerrar sin pago) nunca reabre nada por sí solo, pero
      //    si YA no queda ninguna asignación pendiente de decisión y otro
      //    cupo se había completado en una llamada anterior, el recálculo
      //    puede dar `COMPLETED` igual (punto 2 de CN-20260922-013): antes,
      //    esta rama exigía `outcome === 'COMPLETED'` de ESTA llamada en
      //    particular, así que resolver el último cupo pendiente como
      //    `CANCELLED` nunca intentaba el recálculo y el turno se quedaba
      //    `CANCELLED` para siempre pese a que ya no había nada pendiente y
      //    otro cupo sí había completado. Quitar esa condición es seguro: el
      //    único requisito real para reabrir sigue siendo que `recalculated`
      //    dé `COMPLETED` (ver el `if` de abajo), algo que con el cupo que
      //    ESTA llamada resuelve a `CANCELLED` nunca puede ocurrir por sí
      //    solo (haría falta otro cupo ya `COMPLETED`).
      let nextShiftStatus = deriveShiftStatus(current.status, current.requiredWorkers, assignments, current);
      if (current.status === 'CANCELLED' && current.endsAt <= completedAt) {
        // `deriveShiftStatus` solo distingue `CANCELLED` de cualquier otra
        // base: `PUBLISHED` es el valor neutro para que recalcule desde las
        // asignaciones.
        const recalculated = deriveShiftStatus('PUBLISHED', current.requiredWorkers, assignments, current);
        if (recalculated === 'COMPLETED') {
          const cancelledByCompany = await tx.shiftCancellation.findFirst({
            where: { shiftId: owned.id, actorRole: 'BUSINESS' },
            select: { id: true },
          });
          if (!cancelledByCompany) nextShiftStatus = recalculated;
        }
      }
      const confirmedWorkers = assignments.filter((candidate) => candidate.status === 'ASSIGNED').length;
      await tx.shift.update({ where: { id: owned.id }, data: { status: nextShiftStatus, confirmedWorkers } });
      if (current.status === 'CANCELLED' && nextShiftStatus !== 'CANCELLED') {
        // Rastro de la única transición que saca a un turno de `CANCELLED`
        // (solo hacia `COMPLETED`).
        // El texto depende de qué resolvió ESTA llamada: la reapertura la
        // puede disparar un "Cerrar sin pago" cuando otro cupo ya había
        // completado antes (BAJO-2 de CN-20260923-001).
        const trigger = outcome === 'COMPLETED'
          ? `al confirmar la empresa el trabajo de la asignación ${assignment.id} (${sourceLabel})`
          : `al cerrar la empresa sin pago la asignación ${assignment.id} (${sourceLabel}), sin quedar ninguna asignación pendiente de decisión y con otro cupo ya completado`;
        await tx.shiftEvent.create({
          data: {
            shiftId: owned.id,
            actorId: session.userId,
            actorRole: 'BUSINESS',
            type: 'UPDATED',
            detail: `El turno pasó de CANCELLED a ${nextShiftStatus} ${trigger}; el cierre por vencimiento no era una cancelación de la empresa`,
          },
        });
      }
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
    // Expiración perezosa (Alcance E): antes de listar, cualquier pago
    // `SCHEDULED` de esta empresa cuyo intento vigente ya venció vuelve a
    // `PENDING`. Nunca hay un cron: se resuelve al leer.
    await expireStaleScheduledPayments(this.prisma, { companyId: company.id });
    return this.prisma.payment.findMany({
      where: { companyId: company.id },
      include: { shift: { select: { id: true, title: true, startsAt: true, endsAt: true } }, assignment: { include: { worker: { select: { id: true, name: true, email: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPayment(session: AuthSession, id: string) {
    const company = await this.companyFor(session);
    await expireStaleScheduledPayments(this.prisma, { id, companyId: company.id });
    const payment = await this.prisma.payment.findFirst({ where: { id, companyId: company.id } });
    if (!payment) throw new BusinessRecordNotFoundError('PAYMENT_NOT_FOUND');
    return payment;
  }

  /**
   * Alcance D: único escritor de `Payment` que le queda a la empresa (el
   * CRUD manual -crear/editar/borrar- se retira: inflaba montos y falseaba
   * el registro de comisión). Solo transiciona `PENDING` -> `PROCESSED`
   * para `provider` `'manual'` (nacido de `checkOut`/`resolveAssignment`) o
   * `'legacy'` (creado con el CRUD antes de este cierre, o backfill de un
   * pago sin `assignmentId`). También resuelve un pago de pasarela que quedó
   * pendiente tras cambiar `PAYMENT_PROVIDER`: si su proveedor ya no es el
   * activo, la empresa puede cerrarlo por esta vía aunque el checkout haya
   * quedado `SCHEDULED`; en ese caso expira el intento abierto dentro de la
   * misma transacción. Nunca permite marcar manualmente un pago del proveedor
   * de pasarela que sigue activo.
   *
   * Atómico: el `updateMany` de abajo es el único guardián de la carrera
   * (dos llamadas simultáneas, o esta contra un cambio de estado
   * concurrente). Bajo `READ COMMITTED` (el nivel por defecto, sin falta de
   * `Serializable`), Postgres serializa las dos escrituras sobre la misma
   * fila: la segunda relee el `WHERE` tras el commit de la primera y afecta
   * 0 filas, así que a lo sumo una transacción ve `count === 1` y crea el
   * `ShiftEvent`. Nunca se lee el estado fuera de la transacción para
   * decidir: eso dejaría una ventana donde dos lecturas "PENDING"
   * simultáneas pasan el guard.
   */
  async markPaymentPaid(session: AuthSession, id: string) {
    const company = await this.companyFor(session);
    const activeProvider = activePaymentProviderName();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: {
          id,
          companyId: company.id,
          OR: [
            { status: PaymentStatus.PENDING, provider: { in: ['manual', 'legacy'] } },
            { status: PaymentStatus.PENDING, provider: { not: activeProvider } },
            { status: PaymentStatus.SCHEDULED, provider: { not: activeProvider } },
          ],
        },
        data: { status: PaymentStatus.PROCESSED, processedAt: new Date() },
      });
      if (updated.count === 0) {
        // Distingue 404 (no existe o es de otra empresa) de 409 (existe,
        // pero ya no es marcable: perdió la carrera, ya está
        // PROCESSED/CANCELLED, o es de una pasarela). La misma transacción
        // ve un estado consistente con el `updateMany` que acaba de fallar.
        const existing = await tx.payment.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
        if (!existing) throw new BusinessRecordNotFoundError('PAYMENT_NOT_FOUND');
        throw new PaymentNotPayableError('PAYMENT_NOT_PAYABLE');
      }
      // Si el proveedor fue desactivado mientras había un checkout abierto,
      // esta resolución manual deja constancia de que el intento ya no puede
      // completar el pago. La transición del Payment anterior toma el lock
      // de fila primero, por lo que una aprobación concurrente gana una sola
      // de las dos transiciones y la otra ve count = 0.
      await tx.paymentAttempt.updateMany({
        where: { paymentId: id, status: 'CREATED' },
        data: { status: 'EXPIRED', failureReason: 'PROVIDER_DEACTIVATED' },
      });
      const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (payment.shiftId) {
        await tx.shiftEvent.create({ data: { shiftId: payment.shiftId, actorId: session.userId, actorRole: 'BUSINESS', type: 'PAYMENT_REPORTED', detail: payment.id } });
      }
      return payment;
    });
  }

  /**
   * Traduce los errores del módulo `payments` (genéricos, sin depender de
   * `business.service.ts`) a los propios de este archivo cuando aplica
   * (`PaymentNotFoundError`/`PaymentNotPayableError` ya existían aquí para
   * `mark-paid`); `ProviderManualError`/`ProviderUnavailableError` se
   * reexportan tal cual (ver arriba) porque son nuevos en este alcance.
   */
  async checkoutPayment(session: AuthSession, id: string) {
    const company = await this.companyFor(session);
    try {
      return await checkoutPaymentWithProvider(this.prisma, company.id, id);
    } catch (error) {
      if (error instanceof PaymentGatewayNotPayableError) {
        throw new PaymentNotPayableError(error.message);
      }
      throw error;
    }
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
