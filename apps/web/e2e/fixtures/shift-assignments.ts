import type { Page, Route } from '@playwright/test';
import type {
  AssignmentRecord,
  AssignmentStatus,
  PaymentRecord,
  ShiftApplicationRecord,
  ShiftRecord,
} from '../../lib/business-api';

// API simulada (con estado) de un turno con postulaciones y del cierre manual
// de asignaciones `NO_SHOW`/`ABANDONED`. Se instala encima del fixture base
// (`business-api.ts`) con `page.route`, que tiene prioridad sobre su
// `context.route`; todo lo que no se define aquí cae al fixture base.

export function buildShift(overrides: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id: 'shift-resolution-1',
    title: 'Mozo de salón',
    location: 'Miraflores',
    startsAt: '2026-09-18T15:00:00.000Z',
    endsAt: '2026-09-18T20:00:00.000Z',
    payCents: 12000,
    requiredWorkers: 1,
    confirmedWorkers: 0,
    description: null,
    responsibilities: null,
    requirements: null,
    screeningQuestions: null,
    modality: 'PRESENCIAL',
    notes: null,
    rescueActive: false,
    status: 'ASSIGNED',
    ...overrides,
  };
}

const nextActionByStatus: Record<AssignmentStatus, ShiftApplicationRecord['nextAction']> = {
  ASSIGNED: { actor: 'WORKER', code: 'CHECK_IN', label: 'Registra tu llegada en la sede' },
  // Lo que devuelve la API real: la etiqueta de `NO_SHOW`/`ABANDONED` la
  // sustituye "Proceso cerrado" cuando el turno ya quedó terminal.
  NO_SHOW: { actor: 'NONE', code: 'NONE', label: 'No se registró el check-in a tiempo' },
  ABANDONED: { actor: 'NONE', code: 'NONE', label: 'Pendiente de cierre por la empresa' },
  COMPLETED: { actor: 'NONE', code: 'NONE', label: 'Turno finalizado; revisa el pago reportado' },
  CANCELLED: { actor: 'NONE', code: 'NONE', label: 'Proceso cerrado' },
};

export function buildApplication(input: {
  id: string;
  workerName: string;
  assignmentStatus: AssignmentStatus;
  shiftId?: string;
}): ShiftApplicationRecord {
  const shiftId = input.shiftId ?? 'shift-resolution-1';
  const assignment: AssignmentRecord = {
    id: `assignment-${input.id}`,
    status: input.assignmentStatus,
    checkInCredential: null,
    workerConfirmedAt: '2026-09-18T14:00:00.000Z',
    checkedInAt: input.assignmentStatus === 'ABANDONED' || input.assignmentStatus === 'COMPLETED' ? '2026-09-18T15:05:00.000Z' : null,
    checkedOutAt: input.assignmentStatus === 'COMPLETED' ? '2026-09-18T20:00:00.000Z' : null,
  };
  return {
    id: input.id,
    shiftId,
    workerId: `worker-${input.id}`,
    status: 'ACCEPTED',
    createdAt: '2026-09-17T10:00:00.000Z',
    updatedAt: '2026-09-17T10:00:00.000Z',
    screeningAnswers: null,
    worker: { id: `worker-${input.id}`, name: input.workerName, email: `${input.id}@example.test`, identifier: '70000000' },
    assignment,
    nextAction: nextActionByStatus[input.assignmentStatus],
  };
}

type ResolveResponse = { status: number; json: unknown };
export type ResolveCall = { shiftId: string; assignmentId: string; body: { outcome: string; reason?: string } };

export type ShiftAssignmentsServer = {
  shift: ShiftRecord;
  applications: ShiftApplicationRecord[];
  payments: PaymentRecord[];
  /** Cuerpos recibidos por `POST .../resolve`, en orden. */
  resolveCalls: ResolveCall[];
  /** Todas las peticiones simuladas aquí, en orden ("GET /api/...", ...). */
  log: string[];
  /**
   * Respuestas forzadas para las próximas llamadas a `resolve` (una por
   * llamada, en orden). Sin entradas pendientes, `resolve` se comporta como la
   * API real ante una asignación `NO_SHOW`/`ABANDONED`.
   */
  resolveResponses: ResolveResponse[];
  /**
   * Retiene la próxima lectura `GET` del tipo indicado: el cuerpo se fija al
   * llegar la petición (es lo que el servidor "leyó" en ese instante) pero la
   * respuesta no se entrega hasta `release()`. Permite reproducir una lectura
   * emitida antes de una escritura que llega después del refresco posterior.
   */
  holdNext: (kind: HoldableRead) => HeldRead;
};

export type HoldableRead = 'shift' | 'applications' | 'payments';
export type HeldRead = {
  /** Se resuelve cuando la lectura retenida ya llegó al servidor simulado. */
  reached: Promise<void>;
  /** Se resuelve cuando la respuesta retenida ya se entregó al navegador. */
  delivered: Promise<void>;
  release: () => void;
};

type Hold = {
  markReached: () => void;
  markDelivered: () => void;
  released: Promise<void>;
};

function paymentFor(shift: ShiftRecord, application: ShiftApplicationRecord): PaymentRecord {
  return {
    id: `payment-${application.id}`,
    reference: `CN-TEST-${application.id.toUpperCase()}`,
    description: `${shift.title} · Empresa de pruebas UI`,
    amountCents: shift.payCents,
    workerCount: 1,
    status: 'PENDING',
    dueAt: '2026-09-18T20:00:00.000Z',
    processedAt: null,
    createdAt: '2026-09-18T20:00:00.000Z',
    shift: { id: shift.id, title: shift.title, startsAt: shift.startsAt, endsAt: shift.endsAt },
    assignment: { id: application.assignment!.id, status: 'COMPLETED', worker: { id: application.workerId, name: application.worker.name, email: application.worker.email } },
    workerConfirmedAt: null,
  };
}

export async function installShiftAssignmentsApi(
  page: Page,
  input: {
    shift: ShiftRecord;
    applications: ShiftApplicationRecord[];
    /**
     * Estado con que el listado `GET /business/shifts` devuelve el turno,
     * cuando es distinto del real. La API detecta `NO_SHOW`/`ABANDONED` (y
     * puede cerrar el turno como `CANCELLED`) solo al abrir el turno; un
     * listado cargado antes sigue mostrando el estado anterior.
     */
    listedStatus?: ShiftRecord['status'];
    /**
     * Simula un turno `CANCELLED` que la propia empresa canceló (`cancelShift`).
     * Por defecto el `CANCELLED` del fixture es el cierre automático por
     * vencimiento sin asignaciones viables, que la API reabre al confirmar
     * `COMPLETED`; el cancelado por la empresa nunca se reabre.
     */
    cancelledByCompany?: boolean;
  },
): Promise<ShiftAssignmentsServer> {
  const server: ShiftAssignmentsServer = {
    shift: input.shift,
    applications: input.applications,
    payments: [],
    resolveCalls: [],
    log: [],
    resolveResponses: [],
    holdNext: (kind) => {
      let markReached!: () => void;
      let markDelivered!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => (markReached = resolve));
      const delivered = new Promise<void>((resolve) => (markDelivered = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      holds[kind].push({ markReached, markDelivered, released });
      return { reached, delivered, release };
    },
  };
  const holds: Record<HoldableRead, Hold[]> = { shift: [], applications: [], payments: [] };
  const shiftPath = `/api/business/shifts/${input.shift.id}`;

  // Responde una lectura; si hay una retención armada para ese tipo, la
  // respuesta lleva el cuerpo de este instante pero se entrega solo al liberarla.
  const answerRead = async (route: Route, kind: HoldableRead, body: unknown) => {
    const hold = holds[kind].shift();
    if (!hold) {
      await route.fulfill({ json: body });
      return;
    }
    const snapshot: unknown = JSON.parse(JSON.stringify(body));
    hold.markReached();
    await hold.released;
    await route.fulfill({ json: snapshot });
    hold.markDelivered();
  };

  await page.route((url) => url.pathname.startsWith('/api/business/'), async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const resolveMatch = pathname.match(new RegExp(`^${shiftPath}/assignments/([^/]+)/resolve$`));

    if (method === 'GET' && pathname === '/api/business/shifts') {
      server.log.push(`${method} ${pathname}`);
      await route.fulfill({ json: [{ ...server.shift, status: input.listedStatus ?? server.shift.status }] });
    } else if (method === 'GET' && pathname === shiftPath) {
      server.log.push(`${method} ${pathname}`);
      await answerRead(route, 'shift', server.shift);
    } else if (method === 'GET' && pathname === `${shiftPath}/applications`) {
      server.log.push(`${method} ${pathname}`);
      await answerRead(route, 'applications', server.applications);
    } else if (method === 'GET' && pathname === '/api/business/payments') {
      server.log.push(`${method} ${pathname}`);
      await answerRead(route, 'payments', server.payments);
    } else if (method === 'POST' && resolveMatch) {
      server.log.push(`${method} ${pathname}`);
      const assignmentId = resolveMatch[1];
      const body = request.postDataJSON() as ResolveCall['body'];
      server.resolveCalls.push({ shiftId: input.shift.id, assignmentId, body });
      const forced = server.resolveResponses.shift();
      if (forced) {
        await route.fulfill({ status: forced.status, json: forced.json });
        return;
      }
      const application = server.applications.find((item) => item.assignment?.id === assignmentId);
      if (!application?.assignment) {
        await route.fulfill({ status: 404, json: { error: 'ASSIGNMENT_NOT_FOUND' } });
        return;
      }
      if (application.assignment.status !== 'NO_SHOW' && application.assignment.status !== 'ABANDONED') {
        await route.fulfill({ status: 400, json: { error: 'ASSIGNMENT_NOT_RESOLVABLE' } });
        return;
      }
      application.assignment.status = body.outcome as AssignmentStatus;
      application.nextAction = nextActionByStatus[application.assignment.status];
      if (body.outcome === 'COMPLETED') server.payments.push(paymentFor(server.shift, application));
      // Regla de la API (`resolveAssignment`, BAJO-5 de CN-20260918-004 y
      // MEDIO-2 de CN-20260920-004): al confirmar `COMPLETED`, un turno que el
      // ciclo de vencimiento cerró como `CANCELLED` pasa a `COMPLETED` solo si
      // todos sus cupos quedan confirmados como trabajados; con algún cupo sin
      // cerrar sigue `CANCELLED` (nunca `CHECKED_IN`: quedaría inalcanzable).
      // Un turno cancelado por la empresa no se reabre; `CANCELLED` (cerrar sin
      // pago) tampoco toca el turno.
      if (body.outcome === 'COMPLETED' && !input.cancelledByCompany && server.shift.status === 'CANCELLED') {
        const live = server.applications
          .map((item) => item.assignment?.status)
          .filter((status) => status && !['CANCELLED', 'NO_SHOW', 'ABANDONED'].includes(status));
        if (live.length >= server.shift.requiredWorkers && live.every((status) => status === 'COMPLETED')) server.shift.status = 'COMPLETED';
      }
      await route.fulfill({
        json: { ...application.assignment, shiftId: input.shift.id, workerId: application.workerId, applicationId: application.id, assignedAt: '2026-09-17T10:00:00.000Z', completedAt: null },
      });
    } else {
      // Cualquier otra ruta de negocio (empresa, pendientes, mensajes, ...)
      // sigue con las respuestas del fixture base.
      await route.fallback();
    }
  });

  return server;
}
