// Modelos tipados de los puestos fijos del trabajador (M3/M4 de la API).
//
// Los valores de los enums viajan en inglés como en la API; los textos en
// español salen de `jobs_labels.dart`. Un valor desconocido de un enum cae en
// `unknown` en lugar de lanzar, para que una versión futura de la API no
// rompa la pantalla. Nunca se modelan datos de otros candidatos: la API del
// trabajador tampoco los devuelve.

enum ApplicationStatus {
  applied,
  shortlisted,
  interview,
  offer,
  accepted,
  hired,
  rejected,
  withdrawn,
  unknown;

  static ApplicationStatus parse(Object? value) => switch (value) {
    'APPLIED' => applied,
    'SHORTLISTED' => shortlisted,
    'INTERVIEW' => interview,
    'OFFER' => offer,
    'ACCEPTED' => accepted,
    'HIRED' => hired,
    'REJECTED' => rejected,
    'WITHDRAWN' => withdrawn,
    _ => unknown,
  };

  String get apiValue => switch (this) {
    applied => 'APPLIED',
    shortlisted => 'SHORTLISTED',
    interview => 'INTERVIEW',
    offer => 'OFFER',
    accepted => 'ACCEPTED',
    hired => 'HIRED',
    rejected => 'REJECTED',
    withdrawn => 'WITHDRAWN',
    unknown => 'UNKNOWN',
  };

  /// Etapa abierta: el trabajador todavía puede retirarse.
  bool get isOpen => switch (this) {
    applied || shortlisted || interview || offer || accepted => true,
    _ => false,
  };
}

enum PostingStatus {
  draft,
  published,
  paused,
  closed,
  filled,
  unknown;

  static PostingStatus parse(Object? value) => switch (value) {
    'DRAFT' => draft,
    'PUBLISHED' => published,
    'PAUSED' => paused,
    'CLOSED' => closed,
    'FILLED' => filled,
    _ => unknown,
  };
}

enum Modality {
  onsite,
  remote,
  hybrid,
  unknown;

  static Modality parse(Object? value) => switch (value) {
    'ONSITE' => onsite,
    'REMOTE' => remote,
    'HYBRID' => hybrid,
    _ => unknown,
  };

  String get apiValue => switch (this) {
    onsite => 'ONSITE',
    remote => 'REMOTE',
    hybrid => 'HYBRID',
    unknown => 'UNKNOWN',
  };
}

enum Workload {
  fullTime,
  partTime,
  unknown;

  static Workload parse(Object? value) => switch (value) {
    'FULL_TIME' => fullTime,
    'PART_TIME' => partTime,
    _ => unknown,
  };

  String get apiValue => switch (this) {
    fullTime => 'FULL_TIME',
    partTime => 'PART_TIME',
    unknown => 'UNKNOWN',
  };
}

enum ContractType {
  indefinite,
  fixedTerm,
  internship,
  other,
  unknown;

  static ContractType parse(Object? value) => switch (value) {
    'INDEFINITE' => indefinite,
    'FIXED_TERM' => fixedTerm,
    'INTERNSHIP' => internship,
    'OTHER' => other,
    _ => unknown,
  };

  String get apiValue => switch (this) {
    indefinite => 'INDEFINITE',
    fixedTerm => 'FIXED_TERM',
    internship => 'INTERNSHIP',
    other => 'OTHER',
    unknown => 'UNKNOWN',
  };
}

enum OfferStatus {
  pending,
  accepted,
  declined,
  withdrawn,
  superseded,
  unknown;

  static OfferStatus parse(Object? value) => switch (value) {
    'PENDING' => pending,
    'ACCEPTED' => accepted,
    'DECLINED' => declined,
    'WITHDRAWN' => withdrawn,
    'SUPERSEDED' => superseded,
    _ => unknown,
  };
}

/// Una página de resultados con cursor opaco (`nextCursor == null` al final).
class PagedResult<T> {
  const PagedResult({required this.items, required this.nextCursor});

  final List<T> items;
  final String? nextCursor;

  bool get hasMore => nextCursor != null;
}

String _string(Object? value, [String fallback = '']) =>
    value is String ? value : fallback;

String? _optionalString(Object? value) => value is String ? value : null;

int _int(Object? value, [int fallback = 0]) =>
    value is num ? value.toInt() : fallback;

DateTime? _dateTime(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;

DateTime _requiredDateTime(Object? value) =>
    _dateTime(value) ?? DateTime.fromMillisecondsSinceEpoch(0);

Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : const {};

List<dynamic> _list(Object? value) => value is List ? value : const [];

/// Rango salarial en céntimos de sol (`PEN`).
class SalaryRange {
  const SalaryRange({
    required this.minCents,
    required this.maxCents,
    required this.currency,
  });

  final int minCents;
  final int maxCents;
  final String currency;

  factory SalaryRange.fromJson(Object? json) {
    final map = _map(json);
    return SalaryRange(
      minCents: _int(map['minCents']),
      maxCents: _int(map['maxCents']),
      currency: _string(map['currency'], 'PEN'),
    );
  }
}

/// La postulación propia del trabajador a un puesto, tal como la lista el
/// buscador (`myApplication`).
class MyApplicationRef {
  const MyApplicationRef({required this.id, required this.status});

  final String id;
  final ApplicationStatus status;

  static MyApplicationRef? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);
    final id = map['id'];
    if (id is! String) return null;
    return MyApplicationRef(
      id: id,
      status: ApplicationStatus.parse(map['status']),
    );
  }
}

/// Un puesto fijo publicado, visto por el trabajador.
class JobPosting {
  const JobPosting({
    required this.id,
    required this.title,
    required this.description,
    required this.responsibilities,
    required this.requirements,
    required this.benefits,
    required this.modality,
    required this.workload,
    required this.salary,
    required this.location,
    required this.contractType,
    required this.expectedStartDate,
    required this.vacanciesRemaining,
    required this.screeningQuestions,
    required this.publishedAt,
    required this.isHighlighted,
    required this.companyName,
    required this.myApplication,
  });

  final String id;
  final String title;
  final String description;
  final String? responsibilities;
  final String? requirements;
  final String? benefits;
  final Modality modality;
  final Workload workload;
  final SalaryRange salary;
  final String location;
  final ContractType contractType;

  /// Fecha de ingreso esperada (`YYYY-MM-DD`), si la empresa la indicó.
  final String? expectedStartDate;
  final int vacanciesRemaining;
  final List<String> screeningQuestions;
  final DateTime? publishedAt;
  final bool isHighlighted;
  final String companyName;
  final MyApplicationRef? myApplication;

  factory JobPosting.fromJson(Map<String, dynamic> json) => JobPosting(
    id: _string(json['id']),
    title: _string(json['title']),
    description: _string(json['description']),
    responsibilities: _optionalString(json['responsibilities']),
    requirements: _optionalString(json['requirements']),
    benefits: _optionalString(json['benefits']),
    modality: Modality.parse(json['modality']),
    workload: Workload.parse(json['workload']),
    salary: SalaryRange.fromJson(json['salary']),
    location: _string(json['location']),
    contractType: ContractType.parse(json['contractType']),
    expectedStartDate: _optionalString(json['expectedStartDate']),
    vacanciesRemaining: _int(json['vacanciesRemaining']),
    screeningQuestions: _list(
      json['screeningQuestions'],
    ).whereType<String>().toList(growable: false),
    publishedAt: _dateTime(json['publishedAt']),
    isHighlighted: json['isHighlighted'] == true,
    companyName: _string(_map(json['company'])['name']),
    myApplication: MyApplicationRef.tryParse(json['myApplication']),
  );
}

class OfferDocumentInfo {
  const OfferDocumentInfo({
    required this.name,
    required this.mediaType,
    required this.sizeBytes,
    required this.sha256,
  });

  /// Nombre que puso la empresa: siempre se muestra como texto.
  final String name;
  final String? mediaType;
  final int? sizeBytes;
  final String? sha256;

  static OfferDocumentInfo? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);
    final name = map['name'];
    if (name is! String) return null;
    return OfferDocumentInfo(
      name: name,
      mediaType: _optionalString(map['mediaType']),
      sizeBytes: map['sizeBytes'] is num
          ? (map['sizeBytes'] as num).toInt()
          : null,
      sha256: _optionalString(map['sha256']),
    );
  }
}

/// Constancia inmutable de la aceptación de una oferta. No incluye el DNI del
/// trabajador aunque la API lo guarde: esta pantalla no lo necesita.
class AcceptanceReceipt {
  const AcceptanceReceipt({
    required this.acceptedAt,
    required this.offerVersion,
    required this.companyName,
    required this.companyLegalName,
    required this.companyRuc,
    required this.postingTitle,
    required this.postingLocation,
    required this.salaryCents,
    required this.currency,
    required this.contractType,
    required this.startDate,
    required this.note,
    required this.document,
  });

  final DateTime acceptedAt;
  final int offerVersion;
  final String companyName;
  final String? companyLegalName;
  final String companyRuc;
  final String postingTitle;
  final String postingLocation;
  final int salaryCents;
  final String currency;
  final ContractType contractType;
  final String startDate;
  final String? note;
  final OfferDocumentInfo? document;

  static AcceptanceReceipt? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);
    final company = _map(map['company']);
    final posting = _map(map['posting']);
    final conditions = _map(map['conditions']);
    return AcceptanceReceipt(
      acceptedAt: _requiredDateTime(map['acceptedAt']),
      offerVersion: _int(map['offerVersion'], 1),
      companyName: _string(company['name']),
      companyLegalName: _optionalString(company['legalName']),
      companyRuc: _string(company['ruc']),
      postingTitle: _string(posting['title']),
      postingLocation: _string(posting['location']),
      salaryCents: _int(conditions['salaryCents']),
      currency: _string(conditions['currency'], 'PEN'),
      contractType: ContractType.parse(conditions['contractType']),
      startDate: _string(conditions['startDate']),
      note: _optionalString(conditions['note']),
      document: OfferDocumentInfo.tryParse(map['document']),
    );
  }
}

class JobOffer {
  const JobOffer({
    required this.id,
    required this.version,
    required this.status,
    required this.salaryCents,
    required this.currency,
    required this.contractType,
    required this.startDate,
    required this.note,
    required this.document,
    required this.createdAt,
    required this.respondedAt,
    required this.receipt,
  });

  final String id;
  final int version;
  final OfferStatus status;
  final int salaryCents;
  final String currency;
  final ContractType contractType;

  /// `YYYY-MM-DD` (puede venir con hora si la API serializa una fecha).
  final String startDate;
  final String? note;
  final OfferDocumentInfo? document;
  final DateTime createdAt;
  final DateTime? respondedAt;
  final AcceptanceReceipt? receipt;

  factory JobOffer.fromJson(Map<String, dynamic> json) => JobOffer(
    id: _string(json['id']),
    version: _int(json['version'], 1),
    status: OfferStatus.parse(json['status']),
    salaryCents: _int(json['salaryCents']),
    currency: _string(json['currency'], 'PEN'),
    contractType: ContractType.parse(json['contractType']),
    startDate: _string(json['startDate']),
    note: _optionalString(json['note']),
    document: OfferDocumentInfo.tryParse(json['document']),
    createdAt: _requiredDateTime(json['createdAt']),
    respondedAt: _dateTime(json['respondedAt']),
    receipt: AcceptanceReceipt.tryParse(json['acceptanceSnapshot']),
  );
}

class JobEvent {
  const JobEvent({
    required this.id,
    required this.type,
    required this.actorRole,
    required this.fromStatus,
    required this.toStatus,
    required this.detail,
    required this.createdAt,
  });

  final String id;

  /// `APPLIED`, `SHORTLISTED`, `INTERVIEW_SCHEDULED`, `OFFER_ISSUED`,
  /// `OFFER_ACCEPTED`, `OFFER_DECLINED`, `HIRED`, `REJECTED`, `WITHDRAWN`,
  /// `APPLICATION_REOPENED`.
  final String type;
  final String actorRole;
  final ApplicationStatus? fromStatus;
  final ApplicationStatus? toStatus;
  final String? detail;
  final DateTime createdAt;

  factory JobEvent.fromJson(Map<String, dynamic> json) => JobEvent(
    id: _string(json['id']),
    type: _string(json['type']),
    actorRole: _string(json['actorRole']),
    fromStatus: json['fromStatus'] == null
        ? null
        : ApplicationStatus.parse(json['fromStatus']),
    toStatus: json['toStatus'] == null
        ? null
        : ApplicationStatus.parse(json['toStatus']),
    detail: _optionalString(json['detail']),
    createdAt: _requiredDateTime(json['createdAt']),
  );
}

class JobInterview {
  const JobInterview({
    required this.scheduledAt,
    required this.mode,
    required this.note,
  });

  final DateTime scheduledAt;

  /// `ONSITE`, `VIDEO` o `PHONE`.
  final String? mode;
  final String? note;

  static JobInterview? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);
    final at = _dateTime(map['scheduledAt']);
    if (at == null) return null;
    return JobInterview(
      scheduledAt: at,
      mode: _optionalString(map['mode']),
      note: _optionalString(map['note']),
    );
  }
}

/// Resumen del puesto dentro de una postulación propia.
class ApplicationPosting {
  const ApplicationPosting({
    required this.id,
    required this.title,
    required this.companyName,
    required this.modality,
    required this.workload,
    required this.location,
    required this.status,
    required this.salary,
  });

  final String id;
  final String title;
  final String companyName;
  final Modality modality;
  final Workload workload;
  final String location;
  final PostingStatus status;
  final SalaryRange salary;

  factory ApplicationPosting.fromJson(Object? json) {
    final map = _map(json);
    return ApplicationPosting(
      id: _string(map['id']),
      title: _string(map['title']),
      companyName: _string(map['companyName']),
      modality: Modality.parse(map['modality']),
      workload: Workload.parse(map['workload']),
      location: _string(map['location']),
      status: PostingStatus.parse(map['status']),
      salary: SalaryRange.fromJson(map['salary']),
    );
  }
}

class ScreeningAnswer {
  const ScreeningAnswer({required this.question, required this.answer});

  final String question;
  final String answer;

  Map<String, String> toJson() => {'question': question, 'answer': answer};
}

/// Postulación propia a un puesto fijo.
class JobApplication {
  const JobApplication({
    required this.id,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    required this.isPriority,
    required this.autoClosedReason,
    required this.posting,
    required this.screeningAnswers,
    required this.interview,
    required this.currentOfferId,
    required this.offers,
    required this.events,
  });

  final String id;
  final ApplicationStatus status;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool isPriority;

  /// `POSTING_CLOSED` o `POSTING_FILLED` si el sistema la resolvió al cerrarse
  /// o cubrirse el puesto.
  final String? autoClosedReason;
  final ApplicationPosting posting;
  final List<ScreeningAnswer> screeningAnswers;
  final JobInterview? interview;
  final String? currentOfferId;
  final List<JobOffer> offers;
  final List<JobEvent> events;

  bool get isAutoClosed => autoClosedReason != null;

  /// La oferta vigente (`PENDING` o ya `ACCEPTED`), si la hay.
  JobOffer? get currentOffer {
    final id = currentOfferId;
    if (id == null) return null;
    for (final offer in offers) {
      if (offer.id == id) return offer;
    }
    return null;
  }

  bool get hasAcceptedOffer =>
      offers.any((offer) => offer.status == OfferStatus.accepted);

  /// Solo una oferta pendiente se puede aceptar o rechazar, y únicamente en la
  /// etapa de oferta.
  bool get canRespondToOffer =>
      status == ApplicationStatus.offer &&
      currentOffer?.status == OfferStatus.pending;

  JobApplication copyWith({
    ApplicationStatus? status,
    DateTime? updatedAt,
    bool? isPriority,
    String? autoClosedReason,
    JobInterview? interview,
    String? currentOfferId,
    bool clearCurrentOffer = false,
    List<JobOffer>? offers,
    List<JobEvent>? events,
  }) => JobApplication(
    id: id,
    status: status ?? this.status,
    createdAt: createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
    isPriority: isPriority ?? this.isPriority,
    autoClosedReason: autoClosedReason ?? this.autoClosedReason,
    posting: posting,
    screeningAnswers: screeningAnswers,
    interview: interview ?? this.interview,
    currentOfferId: clearCurrentOffer
        ? null
        : (currentOfferId ?? this.currentOfferId),
    offers: offers ?? this.offers,
    events: events ?? this.events,
  );

  factory JobApplication.fromJson(Map<String, dynamic> json) => JobApplication(
    id: _string(json['id']),
    status: ApplicationStatus.parse(json['status']),
    createdAt: _requiredDateTime(json['createdAt']),
    updatedAt: _requiredDateTime(json['updatedAt']),
    isPriority: json['isPriority'] == true,
    autoClosedReason: _optionalString(json['autoClosedReason']),
    posting: ApplicationPosting.fromJson(json['posting']),
    screeningAnswers: _list(json['screeningAnswers'])
        .whereType<Map>()
        .map(
          (value) => ScreeningAnswer(
            question: _string(value['question']),
            answer: _string(value['answer']),
          ),
        )
        .toList(growable: false),
    interview: JobInterview.tryParse(json['interview']),
    currentOfferId: _optionalString(json['currentOfferId']),
    offers: _list(json['offers'])
        .whereType<Map>()
        .map((value) => JobOffer.fromJson(Map<String, dynamic>.from(value)))
        .toList(growable: false),
    events: _list(json['events'])
        .whereType<Map>()
        .map((value) => JobEvent.fromJson(Map<String, dynamic>.from(value)))
        .toList(growable: false),
  );
}

/// Respuesta de `POST /job-postings/:id/applications`.
class ApplyResult {
  const ApplyResult({
    required this.application,
    required this.created,
    required this.reopened,
    required this.idempotent,
    required this.chargedAmount,
  });

  final JobApplication application;
  final bool created;
  final bool reopened;
  final bool idempotent;
  final int chargedAmount;

  factory ApplyResult.fromJson(Map<String, dynamic> json) => ApplyResult(
    application: JobApplication.fromJson(json),
    created: json['created'] == true,
    reopened: json['reopened'] == true,
    idempotent: json['idempotent'] == true,
    chargedAmount: _int(json['chargedAmount']),
  );
}

/// Filtros de la búsqueda de puestos (todos opcionales).
class JobSearchFilter {
  const JobSearchFilter({
    this.query = '',
    this.modality,
    this.workload,
    this.contractType,
    this.minSalarySoles,
    this.location = '',
  });

  final String query;
  final Modality? modality;
  final Workload? workload;
  final ContractType? contractType;

  /// Sueldo mínimo buscado, en soles enteros (la API lo recibe en céntimos).
  final int? minSalarySoles;
  final String location;

  bool get hasActiveFilters =>
      modality != null ||
      workload != null ||
      contractType != null ||
      minSalarySoles != null ||
      location.trim().isNotEmpty;

  JobSearchFilter copyWith({
    String? query,
    Modality? modality,
    bool clearModality = false,
    Workload? workload,
    bool clearWorkload = false,
    ContractType? contractType,
    bool clearContractType = false,
    int? minSalarySoles,
    bool clearMinSalary = false,
    String? location,
  }) => JobSearchFilter(
    query: query ?? this.query,
    modality: clearModality ? null : (modality ?? this.modality),
    workload: clearWorkload ? null : (workload ?? this.workload),
    contractType: clearContractType
        ? null
        : (contractType ?? this.contractType),
    minSalarySoles: clearMinSalary
        ? null
        : (minSalarySoles ?? this.minSalarySoles),
    location: location ?? this.location,
  );

  /// Parámetros de consulta de la API (solo los que tienen valor).
  Map<String, String> toQuery() => {
    if (query.trim().isNotEmpty) 'query': query.trim(),
    if (modality != null) 'modality': modality!.apiValue,
    if (workload != null) 'workload': workload!.apiValue,
    if (contractType != null) 'contractType': contractType!.apiValue,
    if (minSalarySoles != null) 'minSalaryCents': '${minSalarySoles! * 100}',
    if (location.trim().isNotEmpty) 'location': location.trim(),
  };
}

/// Aviso en vivo (`event: job`) del flujo SSE `GET /api/job-events`.
class JobEventNotification {
  const JobEventNotification({
    required this.type,
    required this.applicationId,
    required this.postingId,
    required this.status,
  });

  final String type;
  final String applicationId;
  final String postingId;
  final ApplicationStatus status;

  static JobEventNotification? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);
    final applicationId = map['applicationId'];
    if (applicationId is! String) return null;
    return JobEventNotification(
      type: _string(map['type']),
      applicationId: applicationId,
      postingId: _string(map['postingId']),
      status: ApplicationStatus.parse(map['status']),
    );
  }
}

/// PDF de una oferta ya validado (firma `%PDF-` y tamaño acotado).
class OfferPdf {
  const OfferPdf({required this.fileName, required this.bytes});

  final String fileName;
  final List<int> bytes;
}
