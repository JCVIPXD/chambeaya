import 'dart:async';

import '../wallet/wallet_models.dart';
import '../wallet/wallet_repository.dart';
import 'api_client.dart';
import 'job_events_source.dart';
import 'jobs_models.dart';
import 'jobs_repository.dart';

/// "Servidor" en memoria de puestos fijos y moneda: lo usa el modo demostración
/// (`CHAMBEAYA_DEMO_MODE`, sin API) y las pruebas de widgets. Reproduce las
/// reglas del servidor que importan a la interfaz: cuota gratuita, costo,
/// saldo, tope diario, idempotencia de la postulación, re-postulación,
/// ofertas y constancia. No guarda nada fuera de la memoria.
///
/// Para las pruebas, [scriptError] encola errores de la API para la próxima
/// llamada de una operación, y [issueOffer], [advance] y [emit] simulan lo
/// que haría la empresa.
class DemoJobsBackend
    implements JobsRepository, WalletRepository, JobEventsSource {
  DemoJobsBackend({
    this.currencyName = 'Chambitas',
    int balance = 50,
    this.freeQuotaPerMonth = 10,
    this.extraCost = 5,
    this.priorityCost = 10,
    this.highlightCost = 10,
    this.dailyCap = 200,
    List<JobPosting>? postings,
    this.pageSize = 20,
  }) : _balance = balance,
       _postings = postings ?? List.of(demoPostings) {
    _movements.add(
      Movement(
        id: 'mov-0',
        quantity: balance,
        balanceAfter: balance,
        action: MovementAction.reward,
        actionKey: ActionKeys.welcomeBonus,
        reason: 'Bono de bienvenida',
        createdAt: DateTime.now(),
      ),
    );
  }

  String currencyName;
  int freeQuotaPerMonth;
  int extraCost;
  int priorityCost;
  int highlightCost;
  int dailyCap;
  int pageSize;

  /// Secciones del perfil que faltan para el premio `PROFILE_COMPLETE`.
  List<String> missingProfileSections = [
    'headline',
    'bio',
    'district',
    'availability',
    'specialties',
    'experience',
    'cv',
    'photo',
  ];
  bool profileCompleteEarned = false;
  DateTime? highlightedUntil;

  int _balance;
  int _freeUsed = 0;
  int _spentToday = 0;
  int _sequence = 0;
  final List<JobPosting> _postings;
  final Map<String, JobApplication> _applications = {};
  final List<Movement> _movements = [];
  final Map<String, List<Object>> _scripted = {};
  final List<String> calls = [];
  final StreamController<JobEventNotification> _events =
      StreamController<JobEventNotification>.broadcast();

  int get currentBalance => _balance;

  /// Cuántas veces se llamó una operación (`apply`, `quote`, ...).
  int callCount(String operation) =>
      calls.where((call) => call == operation).length;

  /// Encola un error que lanzará la próxima llamada a [operation].
  void scriptError(String operation, Object error) =>
      _scripted.putIfAbsent(operation, () => []).add(error);

  void _enter(String operation) {
    calls.add(operation);
    final queue = _scripted[operation];
    if (queue != null && queue.isNotEmpty) throw queue.removeAt(0);
  }

  // ---- Simulación de la empresa -------------------------------------------

  void emit(JobEventNotification notification) => _events.add(notification);

  /// La empresa mueve la postulación a otra etapa.
  void advance(String applicationId, ApplicationStatus to, {String? eventType}) {
    final current = _applications[applicationId]!;
    _applications[applicationId] = current.copyWith(
      status: to,
      updatedAt: DateTime.now(),
      events: [
        ...current.events,
        _event(eventType ?? _eventTypeFor(to), 'COMPANY', current.status, to),
      ],
    );
    emit(
      JobEventNotification(
        type: eventType ?? _eventTypeFor(to),
        applicationId: applicationId,
        postingId: current.posting.id,
        status: to,
      ),
    );
  }

  /// La empresa emite una oferta (pasa a la etapa `OFFER`).
  JobOffer issueOffer(
    String applicationId, {
    int salaryCents = 250000,
    ContractType contractType = ContractType.indefinite,
    String startDate = '2026-11-02',
    String? note = 'Bienvenido al equipo.',
    bool withDocument = false,
  }) {
    final current = _applications[applicationId]!;
    final version = current.offers.length + 1;
    final offer = JobOffer(
      id: 'offer-${++_sequence}',
      version: version,
      status: OfferStatus.pending,
      salaryCents: salaryCents,
      currency: 'PEN',
      contractType: contractType,
      startDate: startDate,
      note: note,
      document: withDocument
          ? const OfferDocumentInfo(
              name: 'oferta.pdf',
              mediaType: 'application/pdf',
              sizeBytes: 1024,
              sha256: 'abc123',
            )
          : null,
      createdAt: DateTime.now(),
      respondedAt: null,
      receipt: null,
    );
    final superseded = [
      for (final previous in current.offers)
        if (previous.status == OfferStatus.pending)
          _copyOffer(previous, status: OfferStatus.superseded)
        else
          previous,
    ];
    _applications[applicationId] = current.copyWith(
      status: ApplicationStatus.offer,
      updatedAt: DateTime.now(),
      currentOfferId: offer.id,
      offers: [...superseded, offer],
      events: [
        ...current.events,
        _event('OFFER_ISSUED', 'COMPANY', current.status, ApplicationStatus.offer),
      ],
    );
    emit(
      JobEventNotification(
        type: 'OFFER_ISSUED',
        applicationId: applicationId,
        postingId: current.posting.id,
        status: ApplicationStatus.offer,
      ),
    );
    return offer;
  }

  /// La empresa rechaza la postulación (decisión suya, sin motivo visible).
  void reject(String applicationId) =>
      advance(applicationId, ApplicationStatus.rejected, eventType: 'REJECTED');

  /// El puesto se cierra o se cubre: la postulación se resuelve sola.
  void autoClose(String applicationId, {String reason = 'POSTING_CLOSED'}) {
    final current = _applications[applicationId]!;
    _applications[applicationId] = current.copyWith(
      status: ApplicationStatus.rejected,
      autoClosedReason: reason,
      updatedAt: DateTime.now(),
      events: [
        ...current.events,
        JobEvent(
          id: 'evt-${++_sequence}',
          type: 'REJECTED',
          actorRole: 'SYSTEM',
          fromStatus: current.status,
          toStatus: ApplicationStatus.rejected,
          detail: reason,
          createdAt: DateTime.now(),
        ),
      ],
    );
  }

  JobOffer _copyOffer(JobOffer offer, {OfferStatus? status, AcceptanceReceipt? receipt, DateTime? respondedAt}) =>
      JobOffer(
        id: offer.id,
        version: offer.version,
        status: status ?? offer.status,
        salaryCents: offer.salaryCents,
        currency: offer.currency,
        contractType: offer.contractType,
        startDate: offer.startDate,
        note: offer.note,
        document: offer.document,
        createdAt: offer.createdAt,
        respondedAt: respondedAt ?? offer.respondedAt,
        receipt: receipt ?? offer.receipt,
      );

  String _eventTypeFor(ApplicationStatus status) => switch (status) {
    ApplicationStatus.shortlisted => 'SHORTLISTED',
    ApplicationStatus.interview => 'INTERVIEW_SCHEDULED',
    ApplicationStatus.offer => 'OFFER_ISSUED',
    ApplicationStatus.hired => 'HIRED',
    ApplicationStatus.rejected => 'REJECTED',
    _ => 'APPLIED',
  };

  JobEvent _event(String type, String role, ApplicationStatus? from, ApplicationStatus to) =>
      JobEvent(
        id: 'evt-${++_sequence}',
        type: type,
        actorRole: role,
        fromStatus: from,
        toStatus: to,
        detail: null,
        createdAt: DateTime.now(),
      );

  // ---- JobsRepository -----------------------------------------------------

  @override
  Future<PagedResult<JobPosting>> searchPostings(
    JobSearchFilter filter, {
    String? cursor,
    int limit = 20,
  }) async {
    _enter('searchPostings');
    final query = filter.query.trim().toLowerCase();
    final location = filter.location.trim().toLowerCase();
    final matches = _postings.where((posting) {
      if (query.isNotEmpty &&
          !posting.title.toLowerCase().contains(query) &&
          !posting.description.toLowerCase().contains(query) &&
          !posting.companyName.toLowerCase().contains(query)) {
        return false;
      }
      if (filter.modality != null && posting.modality != filter.modality) return false;
      if (filter.workload != null && posting.workload != filter.workload) return false;
      if (filter.contractType != null && posting.contractType != filter.contractType) return false;
      if (filter.minSalarySoles != null && posting.salary.maxCents < filter.minSalarySoles! * 100) return false;
      if (location.isNotEmpty && !posting.location.toLowerCase().contains(location)) return false;
      return true;
    }).toList();
    // Destacados primero, como el servidor.
    matches.sort((a, b) {
      if (a.isHighlighted != b.isHighlighted) return a.isHighlighted ? -1 : 1;
      return 0;
    });
    final start = int.tryParse(cursor ?? '') ?? 0;
    final size = limit < pageSize ? limit : pageSize;
    final end = (start + size).clamp(0, matches.length);
    final items = [
      for (final posting in matches.sublist(start.clamp(0, matches.length), end))
        _withMine(posting),
    ];
    return PagedResult(
      items: items,
      nextCursor: end < matches.length ? '$end' : null,
    );
  }

  JobPosting _withMine(JobPosting posting) {
    JobApplication? mine;
    for (final application in _applications.values) {
      if (application.posting.id == posting.id) mine = application;
    }
    return JobPosting(
      id: posting.id,
      title: posting.title,
      description: posting.description,
      responsibilities: posting.responsibilities,
      requirements: posting.requirements,
      benefits: posting.benefits,
      modality: posting.modality,
      workload: posting.workload,
      salary: posting.salary,
      location: posting.location,
      contractType: posting.contractType,
      expectedStartDate: posting.expectedStartDate,
      vacanciesRemaining: posting.vacanciesRemaining,
      screeningQuestions: posting.screeningQuestions,
      publishedAt: posting.publishedAt,
      isHighlighted: posting.isHighlighted,
      companyName: posting.companyName,
      myApplication: mine == null
          ? null
          : MyApplicationRef(id: mine.id, status: mine.status),
    );
  }

  @override
  Future<JobPosting> posting(String id) async {
    _enter('posting');
    for (final posting in _postings) {
      if (posting.id == id) return _withMine(posting);
    }
    throw const ApiException(404, 'JOB_POSTING_NOT_FOUND');
  }

  JobApplication? _existingFor(String postingId) {
    for (final application in _applications.values) {
      if (application.posting.id == postingId) return application;
    }
    return null;
  }

  @override
  Future<ApplyResult> apply(
    String postingId, {
    List<ScreeningAnswer> answers = const [],
    bool priority = false,
  }) async {
    _enter('apply');
    final posting = _postings.firstWhere(
      (candidate) => candidate.id == postingId,
      orElse: () => throw const ApiException(404, 'JOB_POSTING_NOT_FOUND'),
    );
    final existing = _existingFor(postingId);
    if (existing != null) {
      if (existing.status == ApplicationStatus.rejected) {
        throw const ApiException(409, 'ALREADY_APPLIED', details: {'status': 'REJECTED'});
      }
      if (existing.status != ApplicationStatus.withdrawn) {
        return ApplyResult(
          application: existing,
          created: false,
          reopened: false,
          idempotent: true,
          chargedAmount: 0,
        );
      }
      if (existing.hasAcceptedOffer) {
        throw const ApiException(409, 'APPLICATION_HAS_ACCEPTED_OFFER');
      }
    }
    if (answers.length != posting.screeningQuestions.length ||
        answers.any((answer) => answer.answer.trim().isEmpty)) {
      throw const ApiException(400, 'INVALID_SCREENING_ANSWERS');
    }
    // Re-postular no cobra de nuevo: la clave de cobro es por puesto.
    final cost = (existing != null ? 0 : _applyCost()) + (priority ? priorityCost : 0);
    _charge(cost, ActionKeys.applicationExtra, 'Postulación a ${posting.title}');
    if (existing == null && cost - (priority ? priorityCost : 0) == 0) _freeUsed += 1;
    final now = DateTime.now();
    final id = existing?.id ?? 'app-${++_sequence}';
    final application = JobApplication(
      id: id,
      status: ApplicationStatus.applied,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      isPriority: priority || (existing?.isPriority ?? false),
      autoClosedReason: null,
      posting: ApplicationPosting(
        id: posting.id,
        title: posting.title,
        companyName: posting.companyName,
        modality: posting.modality,
        workload: posting.workload,
        location: posting.location,
        status: PostingStatus.published,
        salary: posting.salary,
      ),
      screeningAnswers: answers,
      interview: null,
      currentOfferId: existing?.currentOfferId,
      offers: existing?.offers ?? const [],
      events: [
        ...?existing?.events,
        _event(
          existing == null ? 'APPLIED' : 'APPLICATION_REOPENED',
          'WORKER',
          existing?.status,
          ApplicationStatus.applied,
        ),
      ],
    );
    _applications[id] = application;
    return ApplyResult(
      application: application,
      created: existing == null,
      reopened: existing != null,
      idempotent: false,
      chargedAmount: cost,
    );
  }

  int _applyCost() => _freeUsed < freeQuotaPerMonth ? 0 : extraCost;

  void _charge(int cost, String actionKey, String reason) {
    if (cost <= 0) return;
    if (_balance < cost) {
      throw ApiException(
        409,
        'INSUFFICIENT_CURRENCY',
        details: {'cost': cost, 'balance': _balance},
      );
    }
    if (_spentToday + cost > dailyCap) {
      throw ApiException(
        409,
        'DAILY_SPEND_CAP_REACHED',
        details: {'cost': cost, 'dailyCap': dailyCap, 'spentToday': _spentToday},
      );
    }
    _balance -= cost;
    _spentToday += cost;
    _movements.insert(
      0,
      Movement(
        id: 'mov-${++_sequence}',
        quantity: -cost,
        balanceAfter: _balance,
        action: MovementAction.charge,
        actionKey: actionKey,
        reason: reason,
        createdAt: DateTime.now(),
      ),
    );
  }

  @override
  Future<PagedResult<JobApplication>> myApplications({
    bool history = false,
    ApplicationStatus? status,
    String? cursor,
    int limit = 20,
  }) async {
    _enter('myApplications');
    final all = _applications.values.where((application) {
      if (!history && application.isAutoClosed) return false;
      if (status != null && application.status != status) return false;
      return true;
    }).toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    final start = int.tryParse(cursor ?? '') ?? 0;
    final size = limit < pageSize ? limit : pageSize;
    final end = (start + size).clamp(0, all.length);
    return PagedResult(
      items: all.sublist(start.clamp(0, all.length), end),
      nextCursor: end < all.length ? '$end' : null,
    );
  }

  JobApplication _mine(String id) =>
      _applications[id] ??
      (throw const ApiException(404, 'JOB_APPLICATION_NOT_FOUND'));

  @override
  Future<JobApplication> application(String id) async {
    _enter('application');
    return _mine(id);
  }

  @override
  Future<JobApplication> withdraw(String applicationId) async {
    _enter('withdraw');
    final current = _mine(applicationId);
    if (current.status == ApplicationStatus.withdrawn) return current;
    if (!current.status.isOpen) {
      throw ApiException(
        409,
        'INVALID_STATE_TRANSITION',
        details: {'status': current.status.apiValue},
      );
    }
    final updated = current.copyWith(
      status: ApplicationStatus.withdrawn,
      updatedAt: DateTime.now(),
      offers: [
        for (final offer in current.offers)
          if (offer.status == OfferStatus.pending)
            _copyOffer(offer, status: OfferStatus.withdrawn)
          else
            offer,
      ],
      events: [
        ...current.events,
        _event('WITHDRAWN', 'WORKER', current.status, ApplicationStatus.withdrawn),
      ],
    );
    _applications[applicationId] = updated;
    return updated;
  }

  @override
  Future<JobApplication> prioritize(String applicationId) async {
    _enter('prioritize');
    final current = _mine(applicationId);
    if (current.isPriority) return current;
    if (current.status != ApplicationStatus.applied) {
      throw const ApiException(409, 'PRIORITY_NOT_AVAILABLE');
    }
    _charge(priorityCost, ActionKeys.applicationPriority, 'Postulación con prioridad');
    final updated = current.copyWith(isPriority: true, updatedAt: DateTime.now());
    _applications[applicationId] = updated;
    return updated;
  }

  @override
  Future<JobApplication> acceptOffer(String applicationId, String offerId) async {
    _enter('acceptOffer');
    final current = _mine(applicationId);
    final offer = current.offers.firstWhere(
      (candidate) => candidate.id == offerId,
      orElse: () => throw const ApiException(404, 'JOB_OFFER_NOT_FOUND'),
    );
    if (current.status == ApplicationStatus.accepted && offer.status == OfferStatus.accepted) {
      return current;
    }
    if (current.status != ApplicationStatus.offer) {
      throw ApiException(409, 'INVALID_STATE_TRANSITION', details: {'status': current.status.apiValue});
    }
    if (offer.status != OfferStatus.pending) {
      throw const ApiException(409, 'OFFER_NOT_PENDING');
    }
    final now = DateTime.now();
    final accepted = _copyOffer(
      offer,
      status: OfferStatus.accepted,
      respondedAt: now,
      receipt: AcceptanceReceipt(
        acceptedAt: now,
        offerVersion: offer.version,
        companyName: current.posting.companyName,
        companyLegalName: '${current.posting.companyName} S.A.C.',
        companyRuc: '20123456789',
        postingTitle: current.posting.title,
        postingLocation: current.posting.location,
        salaryCents: offer.salaryCents,
        currency: offer.currency,
        contractType: offer.contractType,
        startDate: offer.startDate,
        note: offer.note,
        document: offer.document,
      ),
    );
    final updated = current.copyWith(
      status: ApplicationStatus.accepted,
      updatedAt: now,
      offers: [for (final item in current.offers) item.id == offerId ? accepted : item],
      events: [
        ...current.events,
        _event('OFFER_ACCEPTED', 'WORKER', current.status, ApplicationStatus.accepted),
      ],
    );
    _applications[applicationId] = updated;
    return updated;
  }

  @override
  Future<JobApplication> declineOffer(String applicationId, String offerId) async {
    _enter('declineOffer');
    final current = _mine(applicationId);
    final offer = current.offers.firstWhere(
      (candidate) => candidate.id == offerId,
      orElse: () => throw const ApiException(404, 'JOB_OFFER_NOT_FOUND'),
    );
    if (current.status != ApplicationStatus.offer) {
      throw ApiException(409, 'INVALID_STATE_TRANSITION', details: {'status': current.status.apiValue});
    }
    if (offer.status != OfferStatus.pending) {
      throw const ApiException(409, 'OFFER_NOT_PENDING');
    }
    final updated = current.copyWith(
      status: ApplicationStatus.withdrawn,
      updatedAt: DateTime.now(),
      offers: [
        for (final item in current.offers)
          item.id == offerId ? _copyOffer(item, status: OfferStatus.declined, respondedAt: DateTime.now()) : item,
      ],
      events: [
        ...current.events,
        _event('OFFER_DECLINED', 'WORKER', current.status, ApplicationStatus.withdrawn),
      ],
    );
    _applications[applicationId] = updated;
    return updated;
  }

  @override
  Future<OfferPdf> offerDocument(
    String applicationId,
    String offerId, {
    required String fallbackName,
  }) async {
    _enter('offerDocument');
    final current = _mine(applicationId);
    final offer = current.offers.where((item) => item.id == offerId).firstOrNull;
    if (offer == null || offer.document == null) {
      throw const ApiException(404, 'JOB_DOCUMENT_NOT_FOUND');
    }
    return OfferPdf(
      fileName: fallbackName,
      bytes: '%PDF-1.4\n% demo\n'.codeUnits,
    );
  }

  // ---- WalletRepository ---------------------------------------------------

  @override
  Future<Balance> balance() async {
    _enter('balance');
    return Balance(currency: currencyName, balance: _balance);
  }

  @override
  Future<MovementPage> movements({String? cursor, int limit = 20}) async {
    _enter('movements');
    final start = int.tryParse(cursor ?? '') ?? 0;
    final size = limit < pageSize ? limit : pageSize;
    final end = (start + size).clamp(0, _movements.length);
    return MovementPage(
      currency: currencyName,
      items: _movements.sublist(start.clamp(0, _movements.length), end),
      nextCursor: end < _movements.length ? '$end' : null,
    );
  }

  @override
  Future<Catalog> catalog() async {
    _enter('catalog');
    return Catalog(
      currency: currencyName,
      items: [
        CatalogItem(
          actionKey: ActionKeys.applicationExtra,
          isCost: true,
          amount: extraCost,
          freeMonthlyQuota: freeQuotaPerMonth,
          freeRemaining: (freeQuotaPerMonth - _freeUsed).clamp(0, freeQuotaPerMonth),
          refundWindowHours: 72,
        ),
        CatalogItem(
          actionKey: ActionKeys.applicationPriority,
          isCost: true,
          amount: priorityCost,
          freeMonthlyQuota: 0,
          freeRemaining: 0,
          refundWindowHours: 72,
        ),
        CatalogItem(
          actionKey: ActionKeys.profileHighlight,
          isCost: true,
          amount: highlightCost,
          freeMonthlyQuota: 0,
          freeRemaining: 0,
          refundWindowHours: null,
        ),
      ],
    );
  }

  @override
  Future<Rewards> rewards() async {
    _enter('rewards');
    return Rewards(
      currency: currencyName,
      items: [
        RewardItem(
          actionKey: ActionKeys.welcomeBonus,
          amount: 50,
          repeatable: false,
          earnedCount: 1,
          earnedAmount: 50,
          earned: true,
          requiredSections: const [],
          missingSections: const [],
          documents: const [],
          monthly: null,
        ),
        RewardItem(
          actionKey: ActionKeys.profileComplete,
          amount: 20,
          repeatable: false,
          earnedCount: profileCompleteEarned ? 1 : 0,
          earnedAmount: profileCompleteEarned ? 20 : 0,
          earned: profileCompleteEarned,
          requiredSections: const [
            'headline',
            'bio',
            'district',
            'availability',
            'specialties',
            'experience',
            'cv',
            'photo',
          ],
          missingSections: missingProfileSections,
          documents: const [],
          monthly: null,
        ),
        const RewardItem(
          actionKey: ActionKeys.documentVerified,
          amount: 10,
          repeatable: true,
          earnedCount: 0,
          earnedAmount: 0,
          earned: false,
          requiredSections: [],
          missingSections: [],
          documents: [
            DocumentReward(kind: 'CV', uploaded: true, verified: false, rewarded: false),
            DocumentReward(kind: 'PROFILE_PHOTO', uploaded: false, verified: false, rewarded: false),
          ],
          monthly: null,
        ),
        const RewardItem(
          actionKey: ActionKeys.invitationResponded,
          amount: 5,
          repeatable: true,
          earnedCount: 0,
          earnedAmount: 0,
          earned: false,
          requiredSections: [],
          missingSections: [],
          documents: [],
          monthly: null,
        ),
        const RewardItem(
          actionKey: ActionKeys.referral,
          amount: 20,
          repeatable: true,
          earnedCount: 0,
          earnedAmount: 0,
          earned: false,
          requiredSections: [],
          missingSections: [],
          documents: [],
          monthly: MonthlyLimit(limit: 5, used: 0, remaining: 5),
        ),
      ],
      dailyCap: const RewardCapUsage(limit: 100, earned: 0, remaining: 100),
      monthlyCap: const RewardCapUsage(limit: 600, earned: 50, remaining: 550),
    );
  }

  @override
  Future<Quote> quote(String actionKey, {String? targetId}) async {
    _enter('quote');
    var cost = 0;
    var reason = QuoteReason.freeAction;
    FreeQuota? quota;
    switch (actionKey) {
      case ActionKeys.applicationExtra:
        quota = FreeQuota(
          monthlyLimit: freeQuotaPerMonth,
          used: _freeUsed,
          remaining: (freeQuotaPerMonth - _freeUsed).clamp(0, freeQuotaPerMonth),
        );
        if (targetId != null && _existingFor(targetId) != null) {
          reason = QuoteReason.alreadyRegistered;
        } else if (_freeUsed < freeQuotaPerMonth) {
          reason = QuoteReason.freeQuota;
        } else {
          cost = extraCost;
          reason = QuoteReason.charge;
        }
      case ActionKeys.applicationPriority:
        final already = targetId != null && _applications[targetId]?.isPriority == true;
        cost = already ? 0 : priorityCost;
        reason = already ? QuoteReason.alreadyRegistered : QuoteReason.charge;
      case ActionKeys.profileHighlight:
        final active = highlightedUntil != null && highlightedUntil!.isAfter(DateTime.now());
        cost = active ? 0 : highlightCost;
        reason = active ? QuoteReason.alreadyRegistered : QuoteReason.charge;
      default:
        throw const ApiException(404, 'ACTION_NOT_QUOTABLE');
    }
    return Quote(
      currency: currencyName,
      actionKey: actionKey,
      cost: cost,
      reason: reason,
      freeQuota: quota,
      balance: _balance,
      sufficientBalance: _balance >= cost,
      dailyCap: DailyCap(
        limit: dailyCap,
        spentToday: _spentToday,
        remaining: (dailyCap - _spentToday).clamp(0, dailyCap),
      ),
      withinDailyCap: _spentToday + cost <= dailyCap,
      canExecute: _balance >= cost && _spentToday + cost <= dailyCap,
      refundWindowHours: actionKey == ActionKeys.profileHighlight ? null : 72,
    );
  }

  @override
  Future<Referral> referral() async {
    _enter('referral');
    return const Referral(
      code: 'DEMO2345',
      referred: 2,
      rewarded: 1,
      monthly: MonthlyLimit(limit: 5, used: 1, remaining: 4),
    );
  }

  @override
  Future<HighlightResult> highlightProfile() async {
    _enter('highlightProfile');
    if (highlightedUntil != null && highlightedUntil!.isAfter(DateTime.now())) {
      return HighlightResult(
        highlightedUntil: highlightedUntil,
        idempotent: true,
        chargedAmount: 0,
      );
    }
    _charge(highlightCost, ActionKeys.profileHighlight, 'Perfil destacado');
    highlightedUntil = DateTime.now().add(const Duration(hours: 168));
    return HighlightResult(
      highlightedUntil: highlightedUntil,
      idempotent: false,
      chargedAmount: highlightCost,
    );
  }

  // ---- JobEventsSource ----------------------------------------------------

  @override
  Stream<JobEventNotification> watch() => _events.stream;

  Future<void> dispose() => _events.close();
}

/// Puestos de ejemplo del modo demostración (uno destacado).
final List<JobPosting> demoPostings = [
  JobPosting(
    id: 'demo-job-1',
    title: 'Asistente administrativo',
    description:
        'Apoyo en gestión documental, atención de llamadas y coordinación de agenda de la oficina.',
    responsibilities: 'Archivar documentos\nAtender llamadas y correos',
    requirements: 'Secundaria completa\nManejo básico de Excel',
    benefits: 'Seguro de salud\nCapacitación pagada',
    modality: Modality.onsite,
    workload: Workload.fullTime,
    salary: const SalaryRange(minCents: 150000, maxCents: 180000, currency: 'PEN'),
    location: 'Miraflores, Lima',
    contractType: ContractType.indefinite,
    expectedStartDate: '2026-11-02',
    vacanciesRemaining: 2,
    screeningQuestions: const ['¿Cuánta experiencia tienes en oficinas?'],
    publishedAt: DateTime.utc(2026, 10, 10),
    isHighlighted: true,
    companyName: 'Estudio Rivera',
    myApplication: null,
  ),
  JobPosting(
    id: 'demo-job-2',
    title: 'Cajero de tienda',
    description:
        'Atención en caja, cobro y cuadre diario en una tienda de conveniencia con horario rotativo.',
    responsibilities: null,
    requirements: 'Experiencia previa deseable',
    benefits: null,
    modality: Modality.onsite,
    workload: Workload.partTime,
    salary: const SalaryRange(minCents: 90000, maxCents: 110000, currency: 'PEN'),
    location: 'San Isidro, Lima',
    contractType: ContractType.fixedTerm,
    expectedStartDate: null,
    vacanciesRemaining: 1,
    screeningQuestions: const [],
    publishedAt: DateTime.utc(2026, 10, 8),
    isHighlighted: false,
    companyName: 'Tienda Central',
    myApplication: null,
  ),
  JobPosting(
    id: 'demo-job-3',
    title: 'Soporte técnico remoto',
    description:
        'Atención de tickets de clientes por chat y correo, con guías y herramientas de la empresa.',
    responsibilities: null,
    requirements: null,
    benefits: 'Trabajo desde casa',
    modality: Modality.remote,
    workload: Workload.fullTime,
    salary: const SalaryRange(minCents: 220000, maxCents: 280000, currency: 'PEN'),
    location: 'Remoto (Perú)',
    contractType: ContractType.indefinite,
    expectedStartDate: '2026-12-01',
    vacanciesRemaining: 3,
    screeningQuestions: const [],
    publishedAt: DateTime.utc(2026, 10, 5),
    isHighlighted: false,
    companyName: 'Soporte Andino',
    myApplication: null,
  ),
];
