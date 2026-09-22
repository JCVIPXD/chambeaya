import 'package:flutter/foundation.dart' show listEquals;

enum ShiftState { published, assigned, checkedIn, completed }

enum ShiftIndustry { hospitality, foodService, retail, events }

enum ShiftDateScope { any, today, tomorrow, weekend }

enum ShiftSortOrder { recommended, highestPay }

class ShiftSearchFilter {
  const ShiftSearchFilter({
    this.query = '',
    this.industry,
    this.minimumPayCents = 0,
    this.urgentOnly = false,
    this.recommendedOnly = false,
    this.location,
    this.modality,
    this.dateScope = ShiftDateScope.any,
    this.sortOrder = ShiftSortOrder.recommended,
  });

  final String query;
  final ShiftIndustry? industry;
  final int minimumPayCents;
  final bool urgentOnly;
  final bool recommendedOnly;
  final String? location;
  final String? modality;
  final ShiftDateScope dateScope;
  final ShiftSortOrder sortOrder;

  bool get hasActiveFilters =>
      query.isNotEmpty ||
      industry != null ||
      minimumPayCents > 0 ||
      urgentOnly ||
      recommendedOnly ||
      location != null ||
      modality != null ||
      dateScope != ShiftDateScope.any ||
      sortOrder != ShiftSortOrder.recommended;

  int get activeFilterCount => [
    query.isNotEmpty,
    industry != null,
    minimumPayCents > 0,
    urgentOnly,
    recommendedOnly,
    location != null,
    modality != null,
    dateScope != ShiftDateScope.any,
    sortOrder != ShiftSortOrder.recommended,
  ].where((active) => active).length;
}

class Shift {
  const Shift({
    required this.id,
    required this.title,
    required this.company,
    required this.schedule,
    required this.workerPayCents,
    this.match,
    required this.urgent,
    required this.industry,
    required this.location,
    required this.dateScope,
    this.state = ShiftState.published,
    this.checkInCredential,
    this.assignmentConfirmed = false,
    this.checkedIn = false,
    this.checkedOut = false,
    this.description,
    this.responsibilities,
    this.requirements,
    this.screeningQuestions = const [],
    this.modality = 'PRESENCIAL',
    this.companyVerified = false,
    this.paymentProtected = false,
    this.endsAt,
  });
  final String id;
  final String title;
  final String company;
  final String schedule;
  final int workerPayCents;
  /// Only demo records currently have this value. Matching v1 will populate it
  /// from persisted profile and shift data.
  final int? match;
  final bool urgent;
  final ShiftIndustry industry;
  final String location;
  final ShiftDateScope dateScope;
  final ShiftState state;
  final String? checkInCredential;
  final bool assignmentConfirmed;
  final bool checkedIn;
  final bool checkedOut;
  final String? description;
  final String? responsibilities;
  final String? requirements;
  final List<String> screeningQuestions;
  final String modality;
  final bool companyVerified;
  final bool paymentProtected;
  /// Null for demo-only records (in-memory demo shifts never expire). The
  /// live API always sends it: it is the only real date the marketplace
  /// exposes to clients, and the sole authority for whether an accepted
  /// assignment is still actionable (there is no automatic time-based status
  /// transition on the server).
  final DateTime? endsAt;

  /// Whether the shift's `endsAt` has already passed. Does not by itself mean
  /// the card should stop being actionable: a worker who already checked in
  /// may still check out after the shift's nominal end time (the server does
  /// not gate `checkOut` on `endsAt`), so callers must combine this with
  /// [checkedIn] where that distinction matters.
  bool get isExpired => endsAt != null && !endsAt!.isAfter(DateTime.now());

  Shift copyWith({
    ShiftState? state,
    String? checkInCredential,
    bool? assignmentConfirmed,
    bool? checkedIn,
    bool? checkedOut,
  }) => Shift(
    id: id,
    title: title,
    company: company,
    schedule: schedule,
    workerPayCents: workerPayCents,
    match: match,
    urgent: urgent,
    industry: industry,
    location: location,
    dateScope: dateScope,
    state: state ?? this.state,
    checkInCredential: checkInCredential ?? this.checkInCredential,
    assignmentConfirmed: assignmentConfirmed ?? this.assignmentConfirmed,
    checkedIn: checkedIn ?? this.checkedIn,
    checkedOut: checkedOut ?? this.checkedOut,
    description: description,
    responsibilities: responsibilities,
    requirements: requirements,
    screeningQuestions: screeningQuestions,
    modality: modality,
    companyVerified: companyVerified,
    paymentProtected: paymentProtected,
    endsAt: endsAt,
  );

  /// Comparison by value (every field), so a screen that polls can tell "the
  /// server sent the same thing again" from a real change without rebuilding
  /// on each response. Nothing in the app keys a collection by `Shift` or
  /// relies on its identity (lookups go by [id]).
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Shift &&
          other.id == id &&
          other.title == title &&
          other.company == company &&
          other.schedule == schedule &&
          other.workerPayCents == workerPayCents &&
          other.match == match &&
          other.urgent == urgent &&
          other.industry == industry &&
          other.location == location &&
          other.dateScope == dateScope &&
          other.state == state &&
          other.checkInCredential == checkInCredential &&
          other.assignmentConfirmed == assignmentConfirmed &&
          other.checkedIn == checkedIn &&
          other.checkedOut == checkedOut &&
          other.description == description &&
          other.responsibilities == responsibilities &&
          other.requirements == requirements &&
          listEquals(other.screeningQuestions, screeningQuestions) &&
          other.modality == modality &&
          other.companyVerified == companyVerified &&
          other.paymentProtected == paymentProtected &&
          other.endsAt == endsAt;

  @override
  int get hashCode => Object.hashAll([
    id,
    title,
    company,
    schedule,
    workerPayCents,
    match,
    urgent,
    industry,
    location,
    dateScope,
    state,
    checkInCredential,
    assignmentConfirmed,
    checkedIn,
    checkedOut,
    description,
    responsibilities,
    requirements,
    Object.hashAll(screeningQuestions),
    modality,
    companyVerified,
    paymentProtected,
    endsAt,
  ]);
}

class PaymentRecord {
  const PaymentRecord({
    required this.company,
    required this.role,
    required this.amount,
    required this.status,
    this.id,
    this.reference,
    this.receiptConfirmed = false,
  });
  final String? id;
  final String company;
  final String role;
  final String amount;
  final String status;
  final String? reference;
  final bool receiptConfirmed;
}

class CompanyMetrics {
  const CompanyMetrics({
    required this.activeShifts,
    required this.coverage,
    required this.onTime,
  });
  final int activeShifts;
  final int coverage;
  final int onTime;
}

const availableShifts = [
  Shift(
    id: 'shift-la-mar',
    title: 'Mozo de Salón',
    company: 'Restaurante La Mar',
    schedule: 'Hoy · 18:00 – 00:00',
    workerPayCents: 9000,
    match: 98,
    urgent: true,
    industry: ShiftIndustry.hospitality,
    location: 'Miraflores',
    dateScope: ShiftDateScope.today,
  ),
  Shift(
    id: 'shift-cafe-cielo',
    title: 'Bartender',
    company: 'Café del Cielo',
    schedule: 'Mañana · 20:00 – 02:00',
    workerPayCents: 11000,
    match: 95,
    urgent: false,
    industry: ShiftIndustry.foodService,
    location: 'Barranco',
    dateScope: ShiftDateScope.tomorrow,
  ),
  Shift(
    id: 'shift-eventos-peru',
    title: 'Ayudante de Cocina',
    company: 'Eventos Perú',
    schedule: 'Sábado · 10:00 – 18:00',
    workerPayCents: 12000,
    match: 88,
    urgent: false,
    industry: ShiftIndustry.events,
    location: 'San Isidro',
    dateScope: ShiftDateScope.weekend,
    screeningQuestions: [
      '¿Tienes disponibilidad durante todo el horario indicado?',
    ],
  ),
];

List<Shift> filterDemoShifts(List<Shift> shifts, ShiftSearchFilter filter) {
  final query = filter.query.trim().toLowerCase();
  final matchingAvailable = shifts.any((shift) => shift.match != null);
  final results = shifts.where((shift) {
    final industrySearchLabel = switch (shift.industry) {
      ShiftIndustry.hospitality => 'hotel hospitalidad',
      ShiftIndustry.foodService => 'restaurante alimentos bebidas',
      ShiftIndustry.retail => 'tienda ventas',
      ShiftIndustry.events => 'eventos',
    };
    final matchesQuery =
        query.isEmpty ||
        '${shift.title} ${shift.company} ${shift.location} $industrySearchLabel'
            .toLowerCase()
            .contains(query);
    return matchesQuery &&
        (filter.industry == null || shift.industry == filter.industry) &&
        shift.workerPayCents >= filter.minimumPayCents &&
        (!filter.urgentOnly || shift.urgent) &&
        (!filter.recommendedOnly || !matchingAvailable || (shift.match ?? -1) >= 80) &&
        (filter.location == null || shift.location == filter.location) &&
        (filter.modality == null || shift.modality == filter.modality) &&
        (filter.dateScope == ShiftDateScope.any ||
            shift.dateScope == filter.dateScope);
  }).toList();
  if (filter.sortOrder == ShiftSortOrder.highestPay) {
    results.sort(
      (left, right) => right.workerPayCents.compareTo(left.workerPayCents),
    );
  } else {
    results.sort(
      (left, right) =>
          (right.urgent ? 1 : 0).compareTo(left.urgent ? 1 : 0) != 0
          ? (right.urgent ? 1 : 0).compareTo(left.urgent ? 1 : 0)
          : (right.match ?? -1).compareTo(left.match ?? -1),
    );
  }
  return results;
}

const paymentHistory = [
  PaymentRecord(
    company: 'Restaurante La Mar',
    role: 'Atención al Cliente',
    amount: 'S/ 90.00',
    status: 'Liberado',
    reference: 'LA-MAR-001',
  ),
  PaymentRecord(
    company: 'Café del Cielo',
    role: 'Barista',
    amount: 'S/ 110.00',
    status: 'Liberado',
    reference: 'CC-2026-014',
  ),
  PaymentRecord(
    company: 'Eventos Perú',
    role: 'Azafata de Eventos',
    amount: 'S/ 130.00',
    status: 'Pendiente',
    reference: 'EP-2026-022',
  ),
];

const companyMetrics = CompanyMetrics(
  activeShifts: 18,
  coverage: 93,
  onTime: 16,
);
