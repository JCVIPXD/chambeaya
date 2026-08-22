import 'dart:ui' as ui;

import 'package:cumple_now_mobile/features/discovery/worker_discovery_page.dart';
import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final size in const [
    Size(320, 700),
    Size(390, 844),
    Size(834, 1112),
    Size(1440, 900),
  ]) {
    testWidgets(
      'discovery is accessible without overflow at ${size.width.toInt()}px',
      (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          MaterialApp(
            home: WorkerDiscoveryPage(
              repository: DemoWorkerMarketplaceRepository(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.bySemanticsLabel(RegExp('Buscar empleos')), findsOneWidget);
        expect(
          tester
              .getSemantics(find.byType(TextField).first)
              .flagsCollection
              .isEnabled,
          ui.Tristate.isTrue,
        );
        if (size.width < 1024) {
          expect(
            find.bySemanticsLabel(RegExp('Abrir filtros')),
            findsOneWidget,
          );
        }
        expect(find.bySemanticsLabel(RegExp('Guardar empleo')), findsWidgets);
        if (size.width >= 1024) {
          expect(find.bySemanticsLabel(RegExp('Postular ahora')), findsWidgets);
        }
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final width in const [600.0, 1023.0]) {
    testWidgets(
      'tablet boundary supports 200 percent text at ${width.toInt()}px',
      (tester) async {
        tester.view.physicalSize = Size(width, 1112);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: WorkerDiscoveryPage(
              repository: DemoWorkerMarketplaceRepository(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
      },
    );
  }
}
