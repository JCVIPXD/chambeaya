import type { Page, Route } from '@playwright/test';
import type {
  AssignmentRecord,
  AssignmentStatus,
  PaymentRecord,
  ShiftApplicationRecord,
  ShiftRecord,
} from '../../lib/business-api';
import { DAY_MS, HOUR_MS, isoFromNow } from './dates';

// API simulada (con estado) de un turno con postulaciones y del cierre manual
// de asignaciones `NO_SHOW`/`ABANDONED`. Se instala encima del fixture base
// (`business-api.ts`) con `page.route`, que tiene prioridad sobre su
// `context.route`; todo lo que no se define aquí cae al fixture base.
//
// Todas las fechas son relativas a "ahora" (`./dates`): el turno terminó hace
// ~25 h, dentro de la ventana "Esta semana" del filtro de pagos y siempre en el
// pasado (un turno vencido, que es el escenario de estas pruebas). Con fechas
// fijas la prueba caducaba cuando el pago salía de esa ventana (BAJO-1 de
// CN-20260923-017). Se evalúan en cada llamada, no al cargar el módulo.
const SHIFT_STARTS_MS = -30 * HOUR_MS;
const SHIFT_ENDS_MS = -25 * HOUR_MS;

export function buildShift(overrides: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id: 'shift-resolution-1',
    title: 'Mozo de salón',
    location: 'Miraflores',
    startsAt: isoFromNow(SHIFT_STARTS_MS),
    endsAt: isoFromNow(SHIFT_ENDS_MS),
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
  hasCv?: boolean;
  /** `PENDING` deja la postulación sin asignación (aceptar/rechazar). Por defecto `ACCEPTED`. */
  applicationStatus?: ShiftApplicationRecord['status'];
}): ShiftApplicationRecord {
  const shiftId = input.shiftId ?? 'shift-resolution-1';
  const pendingReview = input.applicationStatus === 'PENDING';
  const assignment: AssignmentRecord = {
    id: `assignment-${input.id}`,
    status: input.assignmentStatus,
    checkInCredential: null,
    workerConfirmedAt: isoFromNow(SHIFT_STARTS_MS - HOUR_MS),
    checkedInAt: input.assignmentStatus === 'ABANDONED' || input.assignmentStatus === 'COMPLETED' ? isoFromNow(SHIFT_STARTS_MS + 5 * 60_000) : null,
    checkedOutAt: input.assignmentStatus === 'COMPLETED' ? isoFromNow(SHIFT_ENDS_MS) : null,
  };
  return {
    id: input.id,
    shiftId,
    workerId: `worker-${input.id}`,
    status: input.applicationStatus ?? 'ACCEPTED',
    createdAt: isoFromNow(-2 * DAY_MS),
    updatedAt: isoFromNow(-2 * DAY_MS),
    screeningAnswers: null,
    worker: { id: `worker-${input.id}`, name: input.workerName, email: `${input.id}@example.test`, identifier: '70000000', hasCv: input.hasCv ?? false },
    assignment: pendingReview ? null : assignment,
    nextAction: pendingReview
      ? { actor: 'BUSINESS', code: 'REVIEW_APPLICATION', label: 'Revisa la postulación' }
      : nextActionByStatus[input.assignmentStatus],
  };
}

// `hang`: la petición nunca se responde (hasta que se cierra la página); sirve
// para probar el timeout de `request()`.
type ResolveResponse = { status: number; json: unknown } | { hang: true };
export type DecideCall = { shiftId: string; applicationId: string; body: { decision: string; reason?: string } };
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
  /** Cuerpos recibidos por `PATCH .../applications/:id` (aceptar/rechazar), en orden. */
  decideCalls: DecideCall[];
  /**
   * Cantidad de próximas lecturas `GET .../applications` del turno principal
   * que responden `500` (el sondeo de 4 s también cuenta). Se decrementa en
   * cada lectura fallida; `Infinity` mantiene la falla hasta que se ponga en 0.
   */
  failApplications: number;
  /**
   * Retiene la próxima respuesta del tipo indicado (lectura `GET`, o la decisión
   * `PATCH` de aceptar/rechazar con `'decide'`): el cuerpo se fija al
   * llegar la petición (es lo que el servidor "leyó" en ese instante) pero la
   * respuesta no se entrega hasta `release()`. Permite reproducir una lectura
   * emitida antes de una escritura que llega después del refresco posterior.
   */
  holdNext: (kind: HoldableRead) => HeldRead;
};

export type HoldableRead = 'shift' | 'applications' | 'payments' | 'decide';
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
    // Vence al terminar el turno: cae dentro de "Esta semana" (`app/page.tsx`).
    dueAt: shift.endsAt,
    processedAt: null,
    createdAt: shift.endsAt,
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
    /**
     * Otros turnos de la empresa (aparecen en el listado y responden su propia
     * lectura y sus postulaciones) para probar el cambio de turno.
     */
    otherShifts?: { shift: ShiftRecord; applications: ShiftApplicationRecord[] }[];
  },
): Promise<ShiftAssignmentsServer> {
  const server: ShiftAssignmentsServer = {
    shift: input.shift,
    applications: input.applications,
    payments: [],
    resolveCalls: [],
    log: [],
    resolveResponses: [],
    decideCalls: [],
    failApplications: 0,
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
  const holds: Record<HoldableRead, Hold[]> = { shift: [], applications: [], payments: [], decide: [] };
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

  const otherShiftFor = (pathname: string) =>
    (input.otherShifts ?? []).find(
      (other) => pathname === `/api/business/shifts/${other.shift.id}` || pathname === `/api/business/shifts/${other.shift.id}/applications`,
    );

  await page.route((url) => url.pathname.startsWith('/api/business/'), async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const decideMatch = pathname.match(new RegExp(`^${shiftPath}/applications/([^/]+)$`));
    const resolveMatch = pathname.match(new RegExp(`^${shiftPath}/assignments/([^/]+)/resolve$`));

    if (method === 'GET' && pathname === '/api/business/shifts') {
      server.log.push(`${method} ${pathname}`);
      await route.fulfill({
        json: [
          { ...server.shift, status: input.listedStatus ?? server.shift.status },
          ...(input.otherShifts ?? []).map((other) => other.shift),
        ],
      });
    } else if (method === 'GET' && otherShiftFor(pathname)) {
      server.log.push(`${method} ${pathname}`);
      const other = otherShiftFor(pathname)!;
      await route.fulfill({ json: pathname.endsWith('/applications') ? other.applications : other.shift });
    } else if (method === 'PATCH' && decideMatch) {
      server.log.push(`${method} ${pathname}`);
      const body = request.postDataJSON() as DecideCall['body'];
      server.decideCalls.push({ shiftId: input.shift.id, applicationId: decideMatch[1], body });
      const application = server.applications.find((item) => item.id === decideMatch[1]);
      if (!application) {
        await route.fulfill({ status: 404, json: { error: 'APPLICATION_NOT_FOUND' } });
        return;
      }
      application.status = body.decision as ShiftApplicationRecord['status'];
      await answerRead(route, 'decide', application);
    } else if (method === 'GET' && pathname === shiftPath) {
      server.log.push(`${method} ${pathname}`);
      await answerRead(route, 'shift', server.shift);
    } else if (method === 'GET' && pathname === `${shiftPath}/applications`) {
      server.log.push(`${method} ${pathname}`);
      if (server.failApplications > 0) {
        server.failApplications -= 1;
        await route.fulfill({ status: 500, json: { error: 'INTERNAL_ERROR' } });
        return;
      }
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
      if (forced && 'hang' in forced) {
        await new Promise<void>((resolve) => page.once('close', () => resolve()));
        return;
      }
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
      // Regla de la API (`resolveAssignment`/`deriveShiftStatus`, BAJO-5 de
      // CN-20260918-004 y CN-20260922-013): al resolver un cupo -con
      // cualquiera de los dos `outcome`, no solo `COMPLETED`, porque el cupo
      // que faltaba puede ser justo el que se cierra sin pago mientras otro
      // ya había completado antes-, un turno que el ciclo de vencimiento
      // cerró como `CANCELLED` pasa a `COMPLETED` en cuanto ya no queda
      // ningún cupo pendiente de decisión (ninguna asignación
      // `ASSIGNED`/`NO_SHOW`/`ABANDONED` sin resolver) y al menos uno terminó
      // `COMPLETED`; los demás pueden haber cerrado `CANCELLED` sin pago, eso
      // ya no bloquea la reapertura. Un turno cancelado por la empresa no se
      // reabre; si ningún cupo completó, sigue `CANCELLED`.
      if (!input.cancelledByCompany && server.shift.status === 'CANCELLED') {
        const statuses = server.applications
          .map((item) => item.assignment?.status)
          .filter((status): status is AssignmentStatus => Boolean(status));
        const pending = statuses.some((status) => status === 'ASSIGNED' || status === 'NO_SHOW' || status === 'ABANDONED');
        const completedCount = statuses.filter((status) => status === 'COMPLETED').length;
        if (!pending && completedCount > 0) server.shift.status = 'COMPLETED';
      }
      await route.fulfill({
        json: { ...application.assignment, shiftId: input.shift.id, workerId: application.workerId, applicationId: application.id, assignedAt: isoFromNow(-2 * DAY_MS), completedAt: null },
      });
    } else {
      // Cualquier otra ruta de negocio (empresa, pendientes, mensajes, ...)
      // sigue con las respuestas del fixture base.
      await route.fallback();
    }
  });

  return server;
}
