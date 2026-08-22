import 'package:cumple_now_mobile/features/auth/auth_page.dart';
import 'package:cumple_now_mobile/features/onboarding/onboarding_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('registration requires a DNI for a worker', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AuthPage(role: AppAudience.worker)),
    );

    expect(find.text('DNI'), findsOneWidget);
  });

  testWidgets('demo registration enters without waiting for the API', (
    tester,
  ) async {
    var authenticated = false;
    await tester.pumpWidget(
      MaterialApp(
        home: AuthPage(
          role: AppAudience.worker,
          useLocalApi: false,
          onAuthenticated: (_) async => authenticated = true,
        ),
      ),
    );

    await tester.enterText(find.byType(TextFormField).at(0), 'Cliente Demo');
    await tester.enterText(find.byType(TextFormField).at(1), 'cliente@demo.pe');
    await tester.enterText(find.byType(TextFormField).at(2), 'Demo2026');
    await tester.enterText(find.byType(TextFormField).at(3), '12345678');
    await tester.tap(find.text('Crear cuenta'));
    await tester.pump();

    expect(authenticated, isTrue);
  });

  testWidgets('desktop authentication keeps a readable form width', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(home: AuthPage(role: AppAudience.worker)),
    );

    final content = find.byKey(const Key('auth-content'));
    expect(content, findsOneWidget);
    expect(tester.getSize(content).width, lessThanOrEqualTo(600));
    expect(find.textContaining('Modo demostración'), findsOneWidget);
  });
}
