import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:cumple_now_mobile/features/marketplace/worker_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('worker navigation exposes useful demo destinations', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: WorkerShell(repository: DemoWorkerMarketplaceRepository()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Oportunidades para ti'), findsOneWidget);

    await tester.tap(find.text('Postulaciones'));
    await tester.pumpAndSettle();
    expect(find.text('Mis postulaciones'), findsOneWidget);
    expect(find.text('En revisión'), findsWidgets);

    await tester.tap(find.text('Mensajes'));
    await tester.pumpAndSettle();
    expect(find.text('Conversaciones'), findsOneWidget);
    expect(find.text('Restaurante La Mar'), findsOneWidget);

    await tester.tap(find.text('Perfil'));
    await tester.pumpAndSettle();
    expect(find.text('Amanda González'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
