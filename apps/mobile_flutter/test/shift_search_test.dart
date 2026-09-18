import 'package:chambeaya_mobile/features/marketplace/marketplace_data.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'recommended search excludes shifts below the worker match threshold',
    () {
      final results = filterDemoShifts(
        availableShifts,
        const ShiftSearchFilter(recommendedOnly: true),
      );

      expect(results, isNotEmpty);
      expect(results.every((shift) => (shift.match ?? -1) >= 80), isTrue);
    },
  );
}
