import 'package:cumple_now_mobile/features/onboarding/onboarding_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('desktop onboarding stays focused and keeps company contrast', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(home: OnboardingPage(onComplete: (_) {})),
    );

    final content = find.byKey(const Key('onboarding-content'));
    expect(content, findsOneWidget);
    expect(tester.getSize(content).width, lessThanOrEqualTo(600));

    final companyButton = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Soy empresa'),
    );
    expect(companyButton.style?.foregroundColor?.resolve({}), Colors.white);
    expect(tester.takeException(), isNull);
  });
}
