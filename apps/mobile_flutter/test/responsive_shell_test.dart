import 'package:cumple_now_mobile/core/navigation/adaptive_worker_scaffold.dart';
import 'package:cumple_now_mobile/core/responsive/app_breakpoints.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('classifies the approved mobile tablet and desktop widths', () {
    expect(classifyLayout(390), AppLayoutClass.mobile);
    expect(classifyLayout(834), AppLayoutClass.tablet);
    expect(classifyLayout(1440), AppLayoutClass.desktop);
  });

  for (final scenario in <({double width, Type navigation})>[
    (width: 390, navigation: NavigationBar),
    (width: 834, navigation: NavigationRail),
  ]) {
    testWidgets('uses ${scenario.navigation} at ${scenario.width.toInt()}px', (
      tester,
    ) async {
      tester.view.physicalSize = Size(scenario.width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          home: AdaptiveWorkerScaffold(
            selectedIndex: 0,
            onDestinationSelected: (_) {},
            body: const Text('Contenido'),
          ),
        ),
      );

      expect(find.byType(scenario.navigation), findsOneWidget);
      if (scenario.width < 600) {
        expect(find.byType(SafeArea), findsWidgets);
      }
    });
  }

  testWidgets('desktop exposes branded sidebar and applications destination', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: AdaptiveWorkerScaffold(
          selectedIndex: 0,
          onDestinationSelected: (_) {},
          body: const Text('Contenido'),
        ),
      ),
    );

    expect(find.text('CUMPLE NOW'), findsOneWidget);
    expect(find.text('Postulaciones'), findsOneWidget);
  });
}
