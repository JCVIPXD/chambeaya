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
    this.dateScope = ShiftDateScope.any,
    this.sortOrder = ShiftSortOrder.recommended,
  });

  final String query;
  final ShiftIndustry? industry;
  final int minimumPayCents;
  final bool urgentOnly;
  final bool recommendedOnly;
  final String? location;
  final ShiftDateScope dateScope;
  final ShiftSortOrder sortOrder;

  bool get hasActiveFilters =>
      query.isNotEmpty ||
      industry != null ||
      minimumPayCents > 0 ||
      urgentOnly ||
      recommendedOnly ||
      location != null ||
      dateScope != ShiftDateScope.any ||
      sortOrder != ShiftSortOrder.recommended;

  int get activeFilterCount => [
    query.isNotEmpty,
    industry != null,
    minimumPayCents > 0,
    urgentOnly,
    recommendedOnly,
    location != null,
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

  Shift copyWith({ShiftState? state, String? checkInCredential}) => Shift(
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
  );
}

class PaymentRecord {
  const PaymentRecord({
    required this.company,
    required this.role,
    required this.amount,
    required this.status,
  });
  final String company;
  final String role;
  final String amount;
  final String status;
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
  ),
  PaymentRecord(
    company: 'Café del Cielo',
    role: 'Barista',
    amount: 'S/ 110.00',
    status: 'Liberado',
  ),
  PaymentRecord(
    company: 'Eventos Perú',
    role: 'Azafata de Eventos',
    amount: 'S/ 130.00',
    status: 'Pendiente',
  ),
];

const companyMetrics = CompanyMetrics(
  activeShifts: 18,
  coverage: 93,
  onTime: 16,
);
