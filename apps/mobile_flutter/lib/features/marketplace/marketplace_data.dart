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
    required this.match,
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
  });
  final String id;
  final String title;
  final String company;
  final String schedule;
  final int workerPayCents;
  final int match;
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
  );
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
        (!filter.recommendedOnly || shift.match >= 80) &&
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
          : right.match.compareTo(left.match),
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
