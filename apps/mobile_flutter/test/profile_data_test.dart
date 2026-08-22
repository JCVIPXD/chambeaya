import 'package:cumple_now_mobile/features/profile/profile_data.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'profile exposes the three worker strengths shown in the home screen',
    () {
      expect(workerProfile.name, isNotEmpty);
      expect(profileStrengths, hasLength(3));
      expect(
        profileStrengths.every((strength) => strength.emphasis.isNotEmpty),
        isTrue,
      );
    },
  );

  test('turns the score into a clear reputation label', () {
    expect(profileCompletionLabel(98), 'Excelente');
    expect(profileCompletionLabel(82), 'Confiable');
  });
}
