import type { Page } from '@playwright/test';
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
  },
): Promise<ShiftAssignmentsServer> {
  const server: ShiftAssignmentsServer = {
    shift: input.shift,
    applications: input.applications,
    payments: [],
    resolveCalls: [],
    log: [],
    resolveResponses: [],
  };
  const shiftPath = `/api/business/shifts/${input.shift.id}`;

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
      await route.fulfill({ json: server.shift });
    } else if (method === 'GET' && pathname === `${shiftPath}/applications`) {
      server.log.push(`${method} ${pathname}`);
      await route.fulfill({ json: server.applications });
    } else if (method === 'GET' && pathname === '/api/business/payments') {
      server.log.push(`${method} ${pathname}`);
      await route.fulfill({ json: server.payments });
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
