import 'package:cumple_now_mobile/features/discovery/worker_discovery_page.dart';
import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('mobile discovery shows client-ready search and demo data', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
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

    expect(find.text('Hola, Ana'), findsOneWidget);
    expect(find.text('Datos de demostración'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('Buscar empleos')), findsOneWidget);
    expect(find.text('Mozo de Salón'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('desktop discovery shows results and selected detail together', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
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

    expect(find.text('Oportunidades para ti'), findsOneWidget);
    expect(find.text('Detalle del turno'), findsOneWidget);
    expect(find.text('Restaurante La Mar'), findsWidgets);
  });

  testWidgets('saving and applying expose visible state changes', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
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

    await tester.tap(find.byTooltip('Guardar empleo').first);
    await tester.pump();
    expect(find.byTooltip('Empleo guardado'), findsWidgets);

    await tester.tap(find.bySemanticsLabel(RegExp('Postular ahora')).first);
    await tester.pump();
    expect(find.text('Postulación enviada'), findsOneWidget);
  });

  testWidgets('tablet job selection opens the detail experience', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(834, 1112);
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
    await tester.tap(find.text('Mozo de Salón').first);
    await tester.pumpAndSettle();

    expect(find.text('Detalle del turno'), findsOneWidget);
  });

  testWidgets('mobile detail reacts after applying', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
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
    await tester.tap(find.text('Mozo de Salón').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Postular ahora'));
    await tester.pumpAndSettle();

    expect(find.text('Postulación enviada'), findsOneWidget);
  });

  testWidgets('desktop filter action opens functional controls', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
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
    await tester.tap(find.byTooltip('Filtros'));
    await tester.pumpAndSettle();

    expect(find.text('Filtros de búsqueda'), findsOneWidget);
  });
}
