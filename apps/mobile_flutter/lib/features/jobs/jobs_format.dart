import 'jobs_models.dart';

// Textos y formatos en español de los puestos fijos y la billetera.

/// `50` y `Chambitas` -> `50 Chambitas`. El nombre lo da siempre la API.
String formatCoins(int amount, String currencyName) {
  final name = currencyName.trim().isEmpty ? 'monedas' : currencyName.trim();
  return '${_thousands(amount)} $name';
}

String _thousands(int value) {
  final digits = value.abs().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return value < 0 ? '-$buffer' : buffer.toString();
}

/// Céntimos de sol -> `S/ 1.500` (sin decimales cuando son exactos).
String formatSoles(int cents) {
  final soles = cents ~/ 100;
  final rest = cents % 100;
  return rest == 0
      ? 'S/ ${_thousands(soles)}'
      : 'S/ ${_thousands(soles)},${rest.toString().padLeft(2, '0')}';
}

String formatSalaryRange(SalaryRange range) => range.minCents == range.maxCents
    ? formatSoles(range.minCents)
    : '${formatSoles(range.minCents)} - ${formatSoles(range.maxCents)}';

const _months = [
  'ene.',
  'feb.',
  'mar.',
  'abr.',
  'may.',
  'jun.',
  'jul.',
  'ago.',
  'sept.',
  'oct.',
  'nov.',
  'dic.',
];

/// `13 oct. 2026`, en la hora local del dispositivo.
String formatDate(DateTime value) {
  final local = value.toLocal();
  return '${local.day} ${_months[local.month - 1]} ${local.year}';
}

String formatDateTime(DateTime value) {
  final local = value.toLocal();
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '${formatDate(value)}, $hour:$minute';
}

/// Fecha de calendario sin zona horaria (`2026-10-20` o con hora): se toma la
/// parte de fecha tal cual, sin convertirla a hora local.
String formatCalendarDate(String? value) {
  if (value == null || value.length < 10) return 'Por definir';
  final parts = value.substring(0, 10).split('-');
  if (parts.length != 3) return 'Por definir';
  final year = int.tryParse(parts[0]);
  final month = int.tryParse(parts[1]);
  final day = int.tryParse(parts[2]);
  if (year == null || month == null || day == null || month < 1 || month > 12) {
    return 'Por definir';
  }
  return '$day ${_months[month - 1]} $year';
}

String modalityLabel(Modality value) => switch (value) {
  Modality.onsite => 'Presencial',
  Modality.remote => 'Remoto',
  Modality.hybrid => 'Híbrido',
  Modality.unknown => 'Modalidad por definir',
};

String workloadLabel(Workload value) => switch (value) {
  Workload.fullTime => 'Tiempo completo',
  Workload.partTime => 'Tiempo parcial',
  Workload.unknown => 'Jornada por definir',
};

String contractTypeLabel(ContractType value) => switch (value) {
  ContractType.indefinite => 'Plazo indefinido',
  ContractType.fixedTerm => 'Plazo fijo',
  ContractType.internship => 'Prácticas',
  ContractType.other => 'Otro tipo de contrato',
  ContractType.unknown => 'Contrato por definir',
};

String applicationStatusLabel(ApplicationStatus value) => switch (value) {
  ApplicationStatus.applied => 'Postulado',
  ApplicationStatus.shortlisted => 'Preseleccionado',
  ApplicationStatus.interview => 'Entrevista',
  ApplicationStatus.offer => 'Oferta',
  ApplicationStatus.accepted => 'Aceptada',
  ApplicationStatus.hired => 'Contratado',
  ApplicationStatus.rejected => 'Rechazada',
  ApplicationStatus.withdrawn => 'Retirada',
  ApplicationStatus.unknown => 'En proceso',
};

String offerStatusLabel(OfferStatus value) => switch (value) {
  OfferStatus.pending => 'Pendiente de tu respuesta',
  OfferStatus.accepted => 'Aceptada',
  OfferStatus.declined => 'Rechazada por ti',
  OfferStatus.withdrawn => 'Retirada por la empresa',
  OfferStatus.superseded => 'Reemplazada por una versión nueva',
  OfferStatus.unknown => 'Sin estado',
};

String interviewModeLabel(String? mode) => switch (mode) {
  'ONSITE' => 'Presencial',
  'VIDEO' => 'Videollamada',
  'PHONE' => 'Llamada telefónica',
  _ => 'Modalidad por confirmar',
};

/// Orden de las etapas del embudo que sigue una postulación abierta.
const funnelStages = <ApplicationStatus>[
  ApplicationStatus.applied,
  ApplicationStatus.shortlisted,
  ApplicationStatus.interview,
  ApplicationStatus.offer,
  ApplicationStatus.accepted,
  ApplicationStatus.hired,
];

/// Texto de un evento de la línea de tiempo vista por el trabajador. El
/// detalle de un rechazo nunca llega al trabajador (nota interna).
String eventLabel(JobEvent event) => switch (event.type) {
  'APPLIED' => 'Enviaste tu postulación',
  'APPLICATION_REOPENED' => 'Volviste a postular',
  'SHORTLISTED' => 'La empresa te preseleccionó',
  'INTERVIEW_SCHEDULED' => 'La empresa programó una entrevista',
  'OFFER_ISSUED' => 'La empresa te envió una oferta',
  'OFFER_ACCEPTED' => 'Aceptaste la oferta',
  'OFFER_DECLINED' => 'Rechazaste la oferta',
  'HIRED' => 'La empresa confirmó tu contratación',
  'REJECTED' => switch (event.detail) {
    'POSTING_CLOSED' => 'El puesto se cerró y tu postulación terminó',
    'POSTING_FILLED' => 'El puesto se cubrió y tu postulación terminó',
    _ => 'La empresa decidió no continuar con tu postulación',
  },
  'WITHDRAWN' => 'Retiraste tu postulación',
  _ => 'Tu postulación cambió de estado',
};

String autoClosedLabel(String reason) => switch (reason) {
  'POSTING_CLOSED' => 'La empresa cerró este puesto',
  'POSTING_FILLED' => 'El puesto ya se cubrió',
  _ => 'Cerrada automáticamente',
};

/// Nombre de archivo seguro para guardar un PDF: solo el nombre (sin rutas ni
/// caracteres de control o reservados), con extensión `.pdf` y longitud
/// acotada. El nombre original lo puso la empresa: no es de confianza.
String safePdfFileName(String? original, {String fallback = 'oferta'}) {
  var name = (original ?? '').split(RegExp(r'[\\/]')).last;
  name = name.replaceAll(RegExp(r'[\u0000-\u001f\u007f<>:"|?*]'), '').trim();
  name = name.replaceAll(RegExp(r'^\.+'), '');
  if (name.toLowerCase().endsWith('.pdf')) {
    name = name.substring(0, name.length - 4);
  }
  name = name.trim();
  if (name.isEmpty) name = fallback;
  if (name.length > 80) name = name.substring(0, 80);
  return '$name.pdf';
}

/// Nombres amigables de las acciones del catálogo del trabajador.
String actionLabel(String? actionKey) => switch (actionKey) {
  'APPLICATION_EXTRA' => 'Postular más allá de la cuota gratuita',
  'APPLICATION_PRIORITY' => 'Postulación con prioridad',
  'PROFILE_HIGHLIGHT' => 'Destacar tu perfil',
  'PROFILE_COMPLETE' => 'Completar tu perfil',
  'DOCUMENT_VERIFIED' => 'Documento verificado',
  'INVITATION_RESPONDED' => 'Responder una invitación a tiempo',
  'REFERRAL' => 'Referir a otra persona',
  'WELCOME_BONUS' => 'Bono de bienvenida',
  null => 'Movimiento',
  _ => 'Otra acción',
};

/// Una frase corta de qué hace cada acción del catálogo.
String actionHint(String actionKey) => switch (actionKey) {
  'APPLICATION_EXTRA' =>
    'Solo cuesta cuando ya usaste tus postulaciones gratuitas del mes.',
  'APPLICATION_PRIORITY' =>
    'Tu postulación aparece primero para la empresa. Opcional.',
  'PROFILE_HIGHLIGHT' =>
    'Tu perfil aparece primero en la búsqueda de talento durante unos días.',
  _ => '',
};

String profileSectionLabel(String section) => switch (section) {
  'headline' => 'Titular (al menos 10 caracteres)',
  'bio' => 'Presentación (al menos 40 caracteres)',
  'district' => 'Distrito',
  'availability' => 'Disponibilidad (al menos un día y un periodo)',
  'specialties' => 'Al menos una especialidad',
  'experience' => 'Al menos una experiencia laboral',
  'cv' => 'CV en PDF',
  'photo' => 'Foto de perfil',
  _ => 'Otra sección',
};

String documentKindLabel(String kind) => switch (kind) {
  'CV' => 'CV',
  'PROFILE_PHOTO' => 'Foto de perfil',
  _ => 'Documento',
};
