import 'dart:async';

import 'package:chambeaya_mobile/features/discovery/worker_discovery_page.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_data.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/discovery/search_alert_store.dart';
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

  testWidgets('screening questions are answered before applying', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(home: WorkerDiscoveryPage(repository: _QuestionRepository())),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel(RegExp('Postular ahora')).first);
    await tester.pumpAndSettle();

    expect(find.text('Completa tu postulación'), findsOneWidget);
    await tester.enterText(find.byType(TextField).last, 'Sí, todo el turno.');
    await tester.tap(find.text('Enviar postulación'));
    await tester.pumpAndSettle();

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

  testWidgets('worker can save a search alert from the filter sheet', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final alertStore = InMemorySearchAlertStore();
    await alertStore.clear();

    await tester.pumpWidget(
      MaterialApp(
        home: WorkerDiscoveryPage(
          repository: DemoWorkerMarketplaceRepository(),
          alertStore: alertStore,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Filtros'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Urgentes').last);
    await tester.pump();
    await tester.tap(find.text('Crear alerta'));
    await tester.pumpAndSettle();

    expect((await alertStore.read())?.urgentOnly, isTrue);
  });

  testWidgets('a published shift appears without reloading discovery', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repository = _LiveRepository();
    addTearDown(repository.close);

    await tester.pumpWidget(
      MaterialApp(home: WorkerDiscoveryPage(repository: repository)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Anfitrión de evento'), findsNothing);

    repository.publish([
      const Shift(
        id: 'shift-live',
        title: 'Anfitrión de evento',
        company: 'Empresa en vivo',
        schedule: 'Lun 24 ago · 18:00 – 00:00',
        workerPayCents: 12000,
        match: 99,
        urgent: true,
        industry: ShiftIndustry.events,
        location: 'Barranco',
        dateScope: ShiftDateScope.any,
      ),
      ...availableShifts,
    ]);
    await tester.pumpAndSettle();

    expect(find.text('Anfitrión de evento'), findsOneWidget);
    expect(find.text('3 resultados'), findsNothing);
    expect(find.text('4 resultados'), findsOneWidget);
  });
}

class _LiveRepository extends DemoWorkerMarketplaceRepository {
  final _updates = StreamController<List<Shift>>.broadcast();

  @override
  Stream<List<Shift>> watchAvailableShifts() => _updates.stream;

  void publish(List<Shift> shifts) => _updates.add(shifts);
  Future<void> close() => _updates.close();
}

class _QuestionRepository extends DemoWorkerMarketplaceRepository {
  static const shift = Shift(
    id: 'shift-question',
    title: 'Ayudante de Cocina',
    company: 'Eventos Perú',
    schedule: 'Sábado · 10:00 – 18:00',
    workerPayCents: 12000,
    match: 88,
    urgent: false,
    industry: ShiftIndustry.events,
    location: 'San Isidro',
    dateScope: ShiftDateScope.weekend,
    screeningQuestions: [
      '¿Tienes disponibilidad durante todo el horario indicado?',
    ],
  );

  @override
  Future<List<Shift>> availableShifts() async => const [shift];

  @override
  Stream<List<Shift>> watchAvailableShifts() async* {
    yield const [shift];
  }

  @override
  Future<void> applyToShift(
    String shiftId, {
    Map<String, String> answers = const {},
  }) async {
    expect(answers[shift.screeningQuestions.single], 'Sí, todo el turno.');
  }
}
