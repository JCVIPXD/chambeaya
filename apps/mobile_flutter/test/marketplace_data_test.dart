import 'package:chambeaya_mobile/features/marketplace/marketplace_data.dart';
import 'package:chambeaya_mobile/core/formatters/currency_formatter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('marketplace demo exposes shifts, payments and company coverage', () {
    expect(availableShifts, isNotEmpty);
    expect(paymentHistory, isNotEmpty);
    expect(companyMetrics.coverage, greaterThan(0));
  });

  test('shift money stays typed as integer cents', () {
    expect(availableShifts.first.workerPayCents, 9000);
    expect(formatPenCents(availableShifts.first.workerPayCents), 'S/ 90');
  });

  // `Shift` compares by value so a screen that polls can tell "the server sent
  // the same thing again" from a real change (WorkerApplicationsPage).
  test('shift equality is by value over every field', () {
    Shift build({
      String title = 'Mozo',
      List<String> questions = const ['¿Experiencia?'],
      bool checkedIn = false,
      String? credential,
      DateTime? endsAt,
      bool confirmed = false,
    }) => Shift(
      id: 's1',
      title: title,
      company: 'La Mar',
      schedule: 'Hoy',
      workerPayCents: 9000,
      urgent: false,
      industry: ShiftIndustry.hospitality,
      location: 'Lima',
      dateScope: ShiftDateScope.any,
      screeningQuestions: List.of(questions),
      checkedIn: checkedIn,
      checkInCredential: credential,
      endsAt: endsAt,
      assignmentConfirmed: confirmed,
    );

    final base = build(endsAt: DateTime.utc(2026, 9, 21, 20));
    final same = build(endsAt: DateTime.utc(2026, 9, 21, 20));
    expect(identical(base, same), isFalse);
    expect(base, same);
    expect(base.hashCode, same.hashCode);

    expect(base, isNot(build(endsAt: DateTime.utc(2026, 9, 21, 21))));
    expect(
      base,
      isNot(build(endsAt: DateTime.utc(2026, 9, 21, 20), title: 'Barista')),
    );
    expect(
      base,
      isNot(build(endsAt: DateTime.utc(2026, 9, 21, 20), questions: [])),
    );
    expect(
      base,
      isNot(build(endsAt: DateTime.utc(2026, 9, 21, 20), checkedIn: true)),
    );
    expect(
      base,
      isNot(build(endsAt: DateTime.utc(2026, 9, 21, 20), credential: 'X')),
    );
    expect(
      base,
      isNot(build(endsAt: DateTime.utc(2026, 9, 21, 20), confirmed: true)),
    );
    expect(base.copyWith(checkedOut: true), isNot(base));
  });
}
