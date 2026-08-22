import 'package:cumple_now_mobile/features/marketplace/worker_pages.dart';
import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'check-in screen communicates that camera verification is disabled',
    (tester) async {
      await tester.pumpWidget(const MaterialApp(home: CheckInPage()));

      expect(find.textContaining('Cámara desactivada'), findsOneWidget);
    },
  );

  testWidgets('shift search exposes an accessible query field', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ShiftsPage(
          repository: DemoWorkerMarketplaceRepository(),
          onAccepted: (_) {},
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets(
    'accepting a shift does not return asynchronous work from setState',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: ShiftsPage(
            repository: DemoWorkerMarketplaceRepository(),
            onAccepted: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Aceptar').first);
      await tester.pump();

      expect(tester.takeException(), isNull);
    },
  );
}
