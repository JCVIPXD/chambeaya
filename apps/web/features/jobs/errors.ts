import { ApiError } from '../../lib/business-api';
import { formatCoins } from './format';

// Traducción de los errores de la API a mensajes claros con un camino siguiente. Nunca se muestra un
// código crudo (`INSUFFICIENT_CURRENCY`) al usuario.

export type ErrorKind =
  | 'session'        // 401: la sesión venció
  | 'insufficient'   // 409 INSUFFICIENT_CURRENCY: falta saldo
  | 'daily-cap'      // 409 DAILY_SPEND_CAP_REACHED: tope diario de gasto
  | 'retry'          // 503 SERIALIZATION_RETRY_EXHAUSTED: nada se aplicó, se puede repetir
  | 'network'        // sin conexión o tiempo agotado
  | 'conflict'       // otro 409 de negocio
  | 'validation'     // 400
  | 'not-found'      // 404
  | 'other';

export type DescribedError = {
  kind: ErrorKind;
  message: string;
  /** Segundos que sugiere esperar el servidor (`Retry-After`) antes de repetir. */
  retryAfterSeconds: number | null;
  code: string | null;
  /** Detalles numéricos del 409 de moneda (`cost`, `balance`, `dailyCap`, `spentToday`). */
  details: Record<string, unknown>;
};

const CODE_MESSAGE: Record<string, string> = {
  JOB_POSTING_NOT_FOUND: 'El puesto ya no existe o no pertenece a tu empresa.',
  JOB_APPLICATION_NOT_FOUND: 'La postulación ya no existe.',
  JOB_OFFER_NOT_FOUND: 'La oferta ya no existe.',
  JOB_DOCUMENT_NOT_FOUND: 'No hay un documento disponible para esta postulación.',
  TALENT_PROFILE_NOT_AVAILABLE: 'Este perfil ya no está disponible.',
  CONTACT_NOT_UNLOCKED: 'Todavía no desbloqueaste el contacto de este candidato.',
  CV_NOT_AVAILABLE: 'Este candidato no tiene un CV disponible.',
  INVITATION_ALREADY_ACTIVE: 'Ya invitaste a este candidato y su invitación sigue vigente.',
  POSTING_NOT_EDITABLE: 'Solo puedes editar un borrador o un puesto en pausa. Pausa el puesto para editarlo.',
  POSTING_HAS_APPLICATIONS: 'Ya hay postulaciones: las preguntas de filtro no se pueden cambiar.',
  POSTING_NOT_PUBLISHED: 'El puesto no está publicado.',
  POSTING_NOT_OPEN: 'El puesto ya no está abierto: no se puede avanzar la postulación.',
  POSTING_FILLED: 'El puesto ya no tiene vacantes libres.',
  VACANCIES_BELOW_FILLED: 'El total de vacantes debe ser mayor que las ya cubiertas.',
  INVALID_SALARY_RANGE: 'El sueldo máximo no puede ser menor que el mínimo.',
  INVALID_START_DATE: 'La fecha de ingreso no puede estar en el pasado.',
  INVALID_INTERVIEW_DATE: 'La fecha de la entrevista debe ser futura y dentro del próximo año.',
  INVALID_STATE_TRANSITION: 'La postulación cambió de etapa mientras la revisabas. Actualizamos la lista.',
  APPLICATION_HAS_ACCEPTED_OFFER: 'Esta postulación ya tiene una oferta aceptada: la constancia no se puede modificar.',
  OFFER_DOCUMENT_NOT_AVAILABLE: 'El PDF de la oferta ya no está disponible. Adjúntalo de nuevo.',
  TOO_MANY_PENDING_UPLOADS: 'Ya subiste varios PDF sin usar para esta postulación. Emite la oferta con uno de ellos.',
  INVALID_OFFER_DOCUMENT: 'El documento debe ser un PDF válido de hasta 5 MB.',
  OFFER_DOCUMENT_TOO_LARGE: 'El PDF supera los 5 MB permitidos.',
  INVALID_CURSOR: 'La lista cambió. Vuelve a cargarla.',
  RESOURCE_NO_LONGER_EXISTS: 'Este registro ya no existe.',
  INVALID_PDF_RESPONSE: 'El servidor no devolvió un PDF válido.',
  REQUEST_TIMEOUT: 'La solicitud tardó demasiado. Revisa tu conexión e inténtalo de nuevo.',
};

function numberDetail(details: Record<string, unknown>, key: string): number | null {
  const value = details[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Describe cualquier error lanzado por una llamada del panel. `currency` es el nombre que dio la API. */
export function describeError(error: unknown, currency = 'monedas'): DescribedError {
  if (!(error instanceof ApiError)) {
    return { kind: 'network', message: 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.', retryAfterSeconds: null, code: null, details: {} };
  }
  const base = { retryAfterSeconds: error.retryAfterSeconds, code: error.code, details: error.details };
  if (error.status === 0 || error.code === 'REQUEST_TIMEOUT') {
    return { kind: 'network', message: CODE_MESSAGE.REQUEST_TIMEOUT!, ...base };
  }
  if (error.status === 401) return { kind: 'session', message: 'Tu sesión venció. Vuelve a ingresar.', ...base };
  if (error.status === 503 && error.code === 'SERIALIZATION_RETRY_EXHAUSTED') {
    return {
      kind: 'retry',
      message: 'El sistema está atendiendo muchas operaciones a la vez. No se aplicó ningún cambio: puedes volver a intentarlo.',
      ...base,
    };
  }
  if (error.code === 'INSUFFICIENT_CURRENCY') {
    const cost = numberDetail(error.details, 'cost');
    const balance = numberDetail(error.details, 'balance');
    const missing = cost !== null && balance !== null ? Math.max(0, cost - balance) : null;
    const detail = cost !== null && balance !== null
      ? ` Esta acción cuesta ${formatCoins(cost, currency)} y tienes ${formatCoins(balance, currency)}${missing ? ` (te faltan ${formatCoins(missing, currency)})` : ''}.`
      : '';
    return { kind: 'insufficient', message: `No tienes saldo suficiente.${detail} No se cobró nada.`, ...base };
  }
  if (error.code === 'DAILY_SPEND_CAP_REACHED') {
    const cap = numberDetail(error.details, 'dailyCap');
    const spent = numberDetail(error.details, 'spentToday');
    const detail = cap !== null && spent !== null ? ` Hoy gastaste ${formatCoins(spent, currency)} de un tope de ${formatCoins(cap, currency)}.` : '';
    return { kind: 'daily-cap', message: `Alcanzaste el tope diario de gasto.${detail} Podrás volver a gastar mañana (el día cambia a medianoche, hora de Lima). No se cobró nada.`, ...base };
  }
  const known = CODE_MESSAGE[error.code];
  if (error.status === 404) return { kind: 'not-found', message: known ?? 'No encontramos lo que buscabas. Es posible que ya no exista.', ...base };
  if (error.status === 409) return { kind: 'conflict', message: known ?? 'La acción ya no es posible porque el estado cambió. Actualizamos la pantalla.', ...base };
  if (error.status === 400 || error.status === 413) return { kind: 'validation', message: known ?? 'Revisa los datos ingresados e inténtalo de nuevo.', ...base };
  return { kind: 'other', message: known ?? 'Algo salió mal en el servidor. Inténtalo de nuevo en unos segundos.', ...base };
}

/** Errores `400 INVALID_INPUT` de la API: `{path, message}` por campo (zod). */
export function fieldIssues(error: unknown): Array<{ path: string; message: string }> {
  if (!(error instanceof ApiError) || error.code !== 'INVALID_INPUT') return [];
  const issues = error.details.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null) return [];
    const { path, message } = issue as { path?: unknown; message?: unknown };
    return [{ path: Array.isArray(path) ? String(path[0] ?? '') : '', message: typeof message === 'string' ? message : '' }];
  });
}
