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
}
