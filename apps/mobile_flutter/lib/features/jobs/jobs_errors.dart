import 'api_client.dart';
import 'jobs_format.dart';

/// Familias de error con un camino siguiente distinto en la interfaz.
enum JobsErrorKind {
  /// 401: la sesión venció.
  session,

  /// 409 `INSUFFICIENT_CURRENCY`: falta saldo, no se cobró nada.
  insufficient,

  /// 409 `DAILY_SPEND_CAP_REACHED`: tope diario de gasto alcanzado.
  dailyCap,

  /// 503 `SERIALIZATION_RETRY_EXHAUSTED`: nada se aplicó, se puede repetir.
  retry,

  /// Sin conexión o tiempo agotado.
  network,

  /// Otro 409 de negocio: el estado cambió.
  conflict,
  validation,
  notFound,
  other,
}

/// Un error de la API traducido a un mensaje claro y un camino siguiente.
/// Nunca expone un código crudo (`INSUFFICIENT_CURRENCY`) al usuario.
class JobsErrorInfo {
  const JobsErrorInfo({
    required this.kind,
    required this.message,
    this.retryAfterSeconds,
    this.code,
  });

  final JobsErrorKind kind;
  final String message;

  /// Segundos que sugiere esperar el servidor (`Retry-After`) antes de repetir.
  final int? retryAfterSeconds;
  final String? code;

  /// Se puede repetir la misma petición sin riesgo (nada se aplicó).
  bool get canRetry => kind == JobsErrorKind.retry || kind == JobsErrorKind.network;
}

const _codeMessages = <String, String>{
  'JOB_POSTING_NOT_FOUND': 'Este puesto ya no está disponible.',
  'JOB_APPLICATION_NOT_FOUND': 'Esta postulación ya no existe.',
  'JOB_OFFER_NOT_FOUND': 'Esta oferta ya no existe.',
  'JOB_DOCUMENT_NOT_FOUND': 'Esta oferta no tiene un documento adjunto.',
  'POSTING_NOT_PUBLISHED': 'Este puesto ya no está recibiendo postulaciones.',
  'POSTING_NOT_OPEN': 'Este puesto ya no está abierto.',
  'POSTING_FILLED': 'Este puesto ya no tiene vacantes libres.',
  'INVALID_SCREENING_ANSWERS':
      'Responde todas las preguntas de la empresa antes de postular.',
  'APPLICATION_HAS_ACCEPTED_OFFER':
      'Ya aceptaste una oferta de este puesto. La constancia no se puede '
          'reabrir, así que no puedes volver a postular.',
  'INVALID_STATE_TRANSITION':
      'Tu postulación cambió de etapa mientras la revisabas. La actualizamos.',
  'OFFER_NOT_PENDING':
      'Esa oferta ya no está vigente: la empresa pudo reemplazarla. '
          'Actualizamos tu postulación.',
  'PRIORITY_NOT_AVAILABLE':
      'La empresa ya avanzó tu postulación: la prioridad ya no se puede comprar.',
  'PROFILE_NOT_VISIBLE':
      'Tu perfil está oculto. Hazlo visible desde "Editar perfil" para destacarlo.',
  'INVALID_PDF_RESPONSE': 'El servidor no devolvió un PDF válido.',
  'INVALID_CURSOR': 'La lista cambió. Vuelve a cargarla.',
  'RESOURCE_NO_LONGER_EXISTS': 'Este registro ya no existe.',
  'ACTION_NOT_QUOTABLE': 'No pudimos calcular el costo de esta acción.',
  'REQUEST_TIMEOUT':
      'La solicitud tardó demasiado. Revisa tu conexión e inténtalo de nuevo.',
};

int? _numberDetail(Map<String, dynamic> details, String key) {
  final value = details[key];
  return value is num ? value.toInt() : null;
}

/// Describe cualquier error lanzado por una llamada de puestos o billetera.
/// [currency] es el nombre que dio la API (nunca se fija en el código).
JobsErrorInfo describeJobsError(Object error, {String currency = 'monedas'}) {
  if (error is! ApiException) {
    return const JobsErrorInfo(
      kind: JobsErrorKind.network,
      message:
          'No pudimos completar la operación. Revisa tu conexión e inténtalo de nuevo.',
    );
  }
  final retryAfter = error.retryAfterSeconds;
  JobsErrorInfo build(JobsErrorKind kind, String message) => JobsErrorInfo(
    kind: kind,
    message: message,
    retryAfterSeconds: retryAfter,
    code: error.code,
  );

  if (error.isNetwork) {
    return build(
      JobsErrorKind.network,
      error.code == 'REQUEST_TIMEOUT'
          ? _codeMessages['REQUEST_TIMEOUT']!
          : 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    );
  }
  if (error.status == 401) {
    return build(JobsErrorKind.session, 'Tu sesión venció. Vuelve a ingresar.');
  }
  if (error.status == 503 && error.code == 'SERIALIZATION_RETRY_EXHAUSTED') {
    return build(
      JobsErrorKind.retry,
      'Hay muchas operaciones a la vez. No se aplicó ningún cambio ni se '
      'cobró nada: puedes volver a intentarlo.',
    );
  }
  if (error.code == 'INSUFFICIENT_CURRENCY') {
    final cost = _numberDetail(error.details, 'cost');
    final balance = _numberDetail(error.details, 'balance');
    final detail = cost != null && balance != null
        ? ' Esta acción cuesta ${formatCoins(cost, currency)} y tienes '
              '${formatCoins(balance, currency)}'
              '${cost > balance ? ' (te faltan ${formatCoins(cost - balance, currency)})' : ''}.'
        : '';
    return build(
      JobsErrorKind.insufficient,
      'No tienes saldo suficiente.$detail No se cobró nada. '
      'Puedes ganar más completando tu perfil o invitando a otras personas.',
    );
  }
  if (error.code == 'DAILY_SPEND_CAP_REACHED') {
    final cap = _numberDetail(error.details, 'dailyCap');
    final spent = _numberDetail(error.details, 'spentToday');
    final detail = cap != null && spent != null
        ? ' Hoy gastaste ${formatCoins(spent, currency)} de un tope de '
              '${formatCoins(cap, currency)}.'
        : '';
    return build(
      JobsErrorKind.dailyCap,
      'Alcanzaste el tope diario de gasto.$detail Podrás volver a gastar '
      'mañana (el día cambia a medianoche, hora de Lima). No se cobró nada.',
    );
  }
  if (error.code == 'ALREADY_APPLIED') {
    final status = error.details['status'];
    return build(
      JobsErrorKind.conflict,
      status == 'REJECTED'
          ? 'La empresa ya tomó una decisión sobre tu postulación a este puesto, '
                'por eso no puedes volver a postular.'
          : 'Ya tienes una postulación en curso para este puesto.',
    );
  }
  final known = _codeMessages[error.code];
  if (error.status == 404) {
    return build(
      JobsErrorKind.notFound,
      known ?? 'No encontramos lo que buscabas. Es posible que ya no exista.',
    );
  }
  if (error.status == 409) {
    return build(
      JobsErrorKind.conflict,
      known ?? 'La acción ya no es posible porque el estado cambió. Actualizamos la pantalla.',
    );
  }
  if (error.status == 400 || error.status == 413) {
    return build(
      JobsErrorKind.validation,
      known ?? 'Revisa los datos ingresados e inténtalo de nuevo.',
    );
  }
  return build(
    JobsErrorKind.other,
    known ?? 'Algo salió mal en el servidor. Inténtalo de nuevo en unos segundos.',
  );
}
