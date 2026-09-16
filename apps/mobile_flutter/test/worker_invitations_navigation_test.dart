import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:cumple_now_mobile/features/marketplace/worker_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'the worker can reach the invitations screen from the shell navigation',
    (tester) async {
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

      await tester.tap(find.text('Invitaciones'));
      await tester.pumpAndSettle();

      // The default demo invitation repository seeds one pending invitation
      // so this screen is never permanently empty in a walkthrough.
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.text('Pendiente'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Aceptar'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Rechazar'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
