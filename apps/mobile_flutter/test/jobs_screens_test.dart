import 'dart:typed_data';

import 'package:chambeaya_mobile/features/jobs/api_client.dart';
import 'package:chambeaya_mobile/features/jobs/application_detail_page.dart';
import 'package:chambeaya_mobile/features/jobs/demo_jobs_backend.dart';
import 'package:chambeaya_mobile/features/jobs/job_postings_page.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_models.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_services.dart';
import 'package:chambeaya_mobile/features/jobs/my_applications_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/jobs_fixtures.dart';

// Pantallas de puestos fijos y postulaciones del trabajador, con el servidor
// en memoria (DemoJobsBackend) que reproduce las reglas de la API.

const _answers = [
  ScreeningAnswer(
    question: '¿Cuánta experiencia tienes en oficinas?',
    answer: 'Dos años',
  ),
];

Future<void> _settle(WidgetTester tester) async {
  // Un indicador de progreso en marcha (botón enviando, panel cargando) impide
  // `pumpAndSettle`: se avanza un tiempo fijo, suficiente para transiciones.
  await tester.pump();
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}


Future<JobsServices> _pumpPostings(
  WidgetTester tester,
  DemoJobsBackend backend, {
  Size size = const Size(390, 844),
}) async {
  final services = JobsServices.demo(backend);
  addTearDown(services.dispose);
  await pumpApp(
    tester,
    Scaffold(
      body: JobPostingsPage(
        services: services,
        debounce: const Duration(milliseconds: 10),
      ),
    ),
    size: size,
  );
  await _settle(tester);
  return services;
}

Future<void> _openPosting(WidgetTester tester, String id) async {
  final card = find.byKey(Key('posting-card-$id'));
  await tester.ensureVisible(card);
  await tester.pump();
  await tester.tap(card);
  await _settle(tester);
}

/// Abre el detalle de [id] y la hoja de postulación.
Future<void> _openApplySheet(WidgetTester tester, String id) async {
  await _openPosting(tester, id);
  await tester.tap(find.byKey(const Key('apply-button')));
  await _settle(tester);
}

void main() {
  group('Puestos fijos', () {
    testWidgets('lista los puestos, marca el destacado y muestra el saldo con el nombre de la API', (
      tester,
    ) async {
      final backend = DemoJobsBackend(currencyName: 'Puntos', balance: 50);
      await _pumpPostings(tester, backend);
      expect(find.text('Asistente administrativo'), findsOneWidget);
      expect(find.text('Cajero de tienda'), findsOneWidget);
      expect(find.text('Destacado'), findsOneWidget);
      // El nombre de la moneda no está fijo en la app.
      expect(find.textContaining('50 Puntos'), findsWidgets);
      expect(find.textContaining('Chambitas'), findsNothing);
    });

    testWidgets('la búsqueda por texto filtra la lista', (tester) async {
      final backend = DemoJobsBackend();
      await _pumpPostings(tester, backend);
      await tester.enterText(find.byType(TextField).first, 'Cajero');
      await tester.pump(const Duration(milliseconds: 50));
      await _settle(tester);
      expect(find.text('Cajero de tienda'), findsOneWidget);
      expect(find.text('Asistente administrativo'), findsNothing);
    });

    testWidgets('sin resultados explica que no hay puestos', (tester) async {
      await _pumpPostings(tester, DemoJobsBackend(postings: []));
      expect(find.text('No encontramos puestos'), findsOneWidget);
    });

    testWidgets('un error de la lista se explica y se puede reintentar', (tester) async {
      final backend = DemoJobsBackend()
        ..scriptError(
          'searchPostings',
          const ApiException(503, 'SERIALIZATION_RETRY_EXHAUSTED', retryAfterSeconds: 1),
        );
      await _pumpPostings(tester, backend);
      expect(find.text('No pudimos cargar los puestos'), findsOneWidget);
      expect(find.textContaining('SERIALIZATION'), findsNothing);
      await tester.tap(find.text('Reintentar'));
      await _settle(tester);
      expect(find.text('Asistente administrativo'), findsOneWidget);
    });

    testWidgets('el detalle muestra sueldo, condiciones y preguntas de la empresa', (tester) async {
      await _pumpPostings(tester, DemoJobsBackend());
      await _openPosting(tester, 'demo-job-1');
      expect(find.text('Asistente administrativo'), findsWidgets);
      expect(find.textContaining('S/ 1.500'), findsWidgets);
      expect(find.byKey(const Key('apply-button')), findsOneWidget);
    });
  });

  group('Postular y costos previos', () {
    testWidgets('dentro de la cuota gratuita no pide confirmar ni cobra', (tester) async {
      final backend = DemoJobsBackend(balance: 50);
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      final quotesBefore = backend.callCount('quote');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      // Se cotizó antes de actuar, pero no hubo cuadro de pago.
      expect(backend.callCount('quote'), quotesBefore + 1);
      expect(find.textContaining('Confirmar y pagar'), findsNothing);
      expect(backend.callCount('apply'), 1);
      expect(backend.currentBalance, 50);
      expect(find.byKey(const Key('view-application-button')), findsOneWidget);
    });

    testWidgets('responde las preguntas de la empresa antes de enviar', (tester) async {
      final backend = DemoJobsBackend();
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-1');
      final quotesBefore = backend.callCount('quote');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.text('Responde esta pregunta'), findsOneWidget);
      expect(backend.callCount('quote'), quotesBefore);
      expect(backend.callCount('apply'), 0);
      await tester.enterText(find.byKey(const Key('screening-answer-0')), 'Dos años');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(backend.callCount('apply'), 1);
    });

    testWidgets('con costo muestra el desglose y cobra solo al confirmar', (tester) async {
      final backend = DemoJobsBackend(balance: 20, freeQuotaPerMonth: 0, extraCost: 5);
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.textContaining('Confirmar y pagar 5 Chambitas'), findsOneWidget);
      expect(find.text('Te quedarían'), findsOneWidget);
      expect(find.textContaining('te devolvemos el costo'), findsOneWidget);
      expect(backend.callCount('apply'), 0);
      expect(backend.currentBalance, 20);

      await tester.tap(find.textContaining('Confirmar y pagar'));
      await _settle(tester);
      expect(backend.callCount('apply'), 1);
      expect(backend.currentBalance, 15);
    });

    testWidgets('cancelar el cuadro de costo no envía nada', (tester) async {
      final backend = DemoJobsBackend(balance: 20, freeQuotaPerMonth: 0);
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      await tester.tap(find.text('Cancelar'));
      await _settle(tester);
      expect(backend.callCount('apply'), 0);
      expect(backend.currentBalance, 20);
    });

    testWidgets('sin saldo no ofrece pagar y lleva a la billetera', (tester) async {
      final backend = DemoJobsBackend(balance: 3, freeQuotaPerMonth: 0, extraCost: 5);
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.textContaining('No tienes saldo suficiente'), findsOneWidget);
      expect(find.textContaining('te faltan 2 Chambitas'), findsOneWidget);
      expect(find.textContaining('Confirmar y pagar'), findsNothing);
      expect(backend.callCount('apply'), 0);
      await tester.tap(find.text('Ver mi billetera'));
      await _settle(tester);
      expect(find.text('Mi billetera'), findsOneWidget);
    });

    testWidgets('la prioridad es opcional: se puede continuar sin ella si no alcanza', (
      tester,
    ) async {
      final backend = DemoJobsBackend(balance: 6, freeQuotaPerMonth: 0, extraCost: 5, priorityCost: 10);
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      await tester.tap(find.byKey(const Key('priority-switch')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.text('Prioridad'), findsOneWidget);
      expect(find.textContaining('No tienes saldo suficiente'), findsOneWidget);
      await tester.tap(find.text('Continuar sin lo opcional'));
      await _settle(tester);
      // Se vuelve a cotizar solo la postulación y se pide confirmar.
      expect(find.text('Prioridad'), findsNothing);
      await tester.tap(find.textContaining('Confirmar y pagar 5 Chambitas'));
      await _settle(tester);
      expect(backend.callCount('apply'), 1);
      expect(backend.currentBalance, 1);
    });

    testWidgets('una cotización que falla no bloquea una acción gratuita', (tester) async {
      final backend = DemoJobsBackend()
        // La primera cotización es la sugerencia del detalle; la segunda, la del envío.
        ..scriptError('quote', const ApiException(0, 'NETWORK_ERROR'))
        ..scriptError('quote', const ApiException(0, 'NETWORK_ERROR'));
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.textContaining('No pudimos consultar el costo'), findsOneWidget);
      await tester.tap(find.text('Continuar'));
      await _settle(tester);
      expect(backend.callCount('apply'), 1);
    });

    testWidgets('un 409 de saldo en el envío se explica sin código crudo', (tester) async {
      final backend = DemoJobsBackend()
        ..scriptError(
          'apply',
          const ApiException(
            409,
            'INSUFFICIENT_CURRENCY',
            details: {'cost': 5, 'balance': 1},
          ),
        );
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.textContaining('No tienes saldo suficiente'), findsOneWidget);
      expect(find.textContaining('INSUFFICIENT_CURRENCY'), findsNothing);
      expect(find.byKey(const Key('submit-application')), findsOneWidget);
    });

    testWidgets('un 409 de tope diario se explica y no cobra', (tester) async {
      final backend = DemoJobsBackend()
        ..scriptError(
          'apply',
          const ApiException(
            409,
            'DAILY_SPEND_CAP_REACHED',
            details: {'cost': 5, 'dailyCap': 200, 'spentToday': 198},
          ),
        );
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.textContaining('Alcanzaste el tope diario de gasto'), findsOneWidget);
      expect(find.textContaining('198 Chambitas'), findsOneWidget);
      expect(backend.currentBalance, 50);
    });

    testWidgets('un 503 permite reintentar el envío sin volver a preguntar el costo', (
      tester,
    ) async {
      final backend = DemoJobsBackend()
        ..scriptError(
          'apply',
          const ApiException(503, 'SERIALIZATION_RETRY_EXHAUSTED', retryAfterSeconds: 1),
        );
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      final quotesBefore = backend.callCount('quote');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.textContaining('No se aplicó ningún cambio'), findsOneWidget);
      // La cuenta regresiva del Retry-After deshabilita el botón un momento.
      expect(find.text('Reintentar en 1s'), findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
      await tester.tap(find.text('Reintentar'));
      await _settle(tester);
      expect(backend.callCount('apply'), 2);
      expect(backend.callCount('quote'), quotesBefore + 1);
      expect(find.byKey(const Key('view-application-button')), findsOneWidget);
    });

    testWidgets('tras un 409 de saldo con prioridad se puede reenviar sin ella', (tester) async {
      // El saldo cambió entre la cotización y el envío: lo aceptado ya no vale.
      final backend = DemoJobsBackend(balance: 50)
        ..scriptError(
          'apply',
          const ApiException(
            409,
            'INSUFFICIENT_CURRENCY',
            details: {'cost': 10, 'balance': 2},
          ),
        );
      await _pumpPostings(tester, backend);
      await _openApplySheet(tester, 'demo-job-2');
      await tester.tap(find.byKey(const Key('priority-switch')));
      await tester.pump();
      final quotesBefore = backend.callCount('quote');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      await tester.tap(find.textContaining('Confirmar y pagar'));
      await _settle(tester);
      expect(find.textContaining('No tienes saldo suficiente'), findsOneWidget);
      // El interruptor vuelve a estar disponible y se vuelve a cotizar.
      final switchTile = tester.widget<SwitchListTile>(find.byKey(const Key('priority-switch')));
      expect(switchTile.onChanged, isNotNull);
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(backend.callCount('quote'), quotesBefore + 4);
      expect(find.textContaining('Confirmar y pagar'), findsOneWidget);
      // Se cancela el cuadro de costo, se apaga la prioridad y se reenvía sin
      // ella: la postulación sale sin prioridad y no cobra los 10 de la prioridad.
      await tester.tap(find.text('Cancelar'));
      await _settle(tester);
      expect(backend.callCount('apply'), 1);
      await tester.tap(find.byKey(const Key('priority-switch')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(backend.callCount('apply'), 2);
      expect(backend.applyPriorities, [true, false]);
      expect(backend.currentBalance, 50);
      expect(find.byKey(const Key('view-application-button')), findsOneWidget);
    });
  });

  group('Mis postulaciones', () {
    Future<(JobsServices, DemoJobsBackend, String)> pumpApplications(
      WidgetTester tester, {
      PdfSaverFake? saver,
      DemoJobsBackend? backend,
    }) async {
      final server = backend ?? DemoJobsBackend();
      final result = await server.apply('demo-job-1', answers: _answers);
      final services = JobsServices.demo(server);
      addTearDown(services.dispose);
      await pumpApp(
        tester,
        Scaffold(
          body: MyApplicationsPage(
            services: services,
            pdfSaver: saver?.call ?? (name, bytes) async => true,
          ),
        ),
      );
      await _settle(tester);
      return (services, server, result.application.id);
    }

    testWidgets('lista la postulación con su etapa', (tester) async {
      final (_, _, id) = await pumpApplications(tester);
      expect(find.byKey(Key('application-$id')), findsOneWidget);
      expect(find.text('Asistente administrativo'), findsOneWidget);
      expect(find.text('Postulado'), findsWidgets);
    });

    testWidgets('sin postulaciones lo explica', (tester) async {
      final services = JobsServices.demo(DemoJobsBackend());
      addTearDown(services.dispose);
      await pumpApp(tester, Scaffold(body: MyApplicationsPage(services: services)));
      await _settle(tester);
      expect(find.text('Aún no tienes postulaciones'), findsOneWidget);
    });

    testWidgets('un aviso en vivo de oferta actualiza la lista sin recargar la pantalla', (
      tester,
    ) async {
      final (_, backend, id) = await pumpApplications(tester);
      backend.issueOffer(id);
      await _settle(tester);
      expect(find.text('Oferta por responder'), findsOneWidget);
    });

    testWidgets('acepta una oferta con PDF: guarda la constancia y descarga el documento', (
      tester,
    ) async {
      final saved = <String>[];
      final (_, backend, id) = await pumpApplications(
        tester,
        saver: (name, Uint8List bytes) async {
          saved.add('$name:${bytes.length}');
          return true;
        },
      );
      final offer = backend.issueOffer(id, withDocument: true);
      await _settle(tester);
      await tester.tap(find.byKey(Key('application-$id')));
      await _settle(tester);
      expect(find.text('Mi postulación'), findsOneWidget);
      expect(find.byKey(const Key('accept-offer')), findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('accept-offer')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('accept-offer')));
      await _settle(tester);
      // Confirmación explícita antes de aceptar.
      expect(find.textContaining('Se guardará una constancia'), findsOneWidget);
      expect(backend.callCount('acceptOffer'), 0);
      await tester.tap(find.widgetWithText(FilledButton, 'Aceptar oferta').last);
      await _settle(tester);
      expect(backend.callCount('acceptOffer'), 1);
      expect(find.byKey(const Key('accept-offer')), findsNothing);
      expect(find.text('Constancia de aceptación', skipOffstage: false), findsOneWidget);

      final download = find.byKey(Key('download-offer-${offer.id}'));
      await tester.ensureVisible(download);
      await tester.pump();
      await tester.tap(download);
      await _settle(tester);
      expect(saved, hasLength(1));
      expect(saved.single, endsWith('.pdf:${'%PDF-1.4\n% demo\n'.length}'));
      expect(find.text('PDF guardado.'), findsOneWidget);
    });

    testWidgets('rechazar una oferta retira la postulación tras confirmar', (tester) async {
      final (_, backend, id) = await pumpApplications(tester);
      backend.issueOffer(id);
      await _settle(tester);
      await tester.tap(find.byKey(Key('application-$id')));
      await _settle(tester);
      await tester.ensureVisible(find.byKey(const Key('decline-offer')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('decline-offer')));
      await _settle(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Rechazar oferta').last);
      await _settle(tester);
      expect(backend.callCount('declineOffer'), 1);
      expect(find.byKey(const Key('reapply')), findsOneWidget);
    });

    testWidgets('un cierre automático del puesto se explica en el detalle y la línea de tiempo', (
      tester,
    ) async {
      final (_, backend, id) = await pumpApplications(tester);
      backend.issueOffer(id);
      backend.autoClose(id, reason: 'POSTING_FILLED');
      await _settle(tester);
      // Las cerradas por el sistema salen del listado normal: se ven en el historial.
      await tester.tap(find.byKey(const Key('history-switch')));
      await _settle(tester);
      await tester.tap(find.byKey(Key('application-$id')));
      await _settle(tester);
      expect(find.textContaining('El puesto ya se cubrió'), findsWidgets);
      expect(find.byKey(const Key('withdraw')), findsNothing);
      expect(find.byKey(const Key('reapply')), findsNothing);
    });

    testWidgets('retirarse pide confirmación y luego ofrece volver a postular', (tester) async {
      final (_, backend, id) = await pumpApplications(tester);
      await tester.tap(find.byKey(Key('application-$id')));
      await _settle(tester);
      await tester.ensureVisible(find.byKey(const Key('withdraw')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('withdraw')));
      await _settle(tester);
      expect(backend.callCount('withdraw'), 0);
      await tester.tap(find.text('Retirarme'));
      await _settle(tester);
      expect(backend.callCount('withdraw'), 1);
      expect(find.byKey(const Key('reapply')), findsOneWidget);
    });

    testWidgets('dar prioridad a una postulación cotiza antes y se bloquea sin saldo', (
      tester,
    ) async {
      final backend = DemoJobsBackend(balance: 4, priorityCost: 10);
      final (_, _, id) = await pumpApplications(tester, backend: backend);
      await tester.tap(find.byKey(Key('application-$id')));
      await _settle(tester);
      await tester.ensureVisible(find.byKey(const Key('prioritize')));
      await tester.pump();
      final quotesBefore = backend.callCount('quote');
      await tester.tap(find.byKey(const Key('prioritize')));
      await _settle(tester);
      expect(backend.callCount('quote'), quotesBefore + 1);
      expect(find.textContaining('No tienes saldo suficiente'), findsOneWidget);
      expect(find.textContaining('Confirmar y pagar'), findsNothing);
      expect(backend.callCount('prioritize'), 0);
    });
  });

  testWidgets('el detalle de una postulación inexistente se explica con un botón para reintentar', (
    tester,
  ) async {
    final services = JobsServices.demo(DemoJobsBackend());
    addTearDown(services.dispose);
    await pumpApp(
      tester,
      ApplicationDetailPage(services: services, applicationId: 'no-existe'),
    );
    await _settle(tester);
    expect(find.text('No pudimos cargar tu postulación'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
  });

  testWidgets('el detalle con una oferta y una constancia no se desborda en pantalla angosta', (
    tester,
  ) async {
    final backend = DemoJobsBackend();
    final applied = await backend.apply('demo-job-1', answers: _answers);
    final id = applied.application.id;
    final offer = backend.issueOffer(id, withDocument: true);
    final services = JobsServices.demo(backend);
    addTearDown(services.dispose);
    await pumpApp(
      tester,
      ApplicationDetailPage(services: services, applicationId: id),
      size: const Size(320, 640),
      textScale: 1.6,
    );
    await _settle(tester);
    // Oferta pendiente (con su etiqueta larga) y luego la constancia.
    final scrollable = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.byKey(Key('offer-${offer.id}')), 200, scrollable: scrollable);
    await tester.pump();
    expect(tester.takeException(), isNull);
    await backend.acceptOffer(id, offer.id);
    await tester.tap(find.byTooltip('Actualizar postulación'));
    await _settle(tester);
    await tester.scrollUntilVisible(find.text('Constancia de aceptación'), 200, scrollable: find.byType(Scrollable).first);
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('con texto grande y pantalla angosta las postulaciones no se desbordan', (
    tester,
  ) async {
    final backend = DemoJobsBackend();
    await backend.apply('demo-job-1', answers: _answers);
    final services = JobsServices.demo(backend);
    addTearDown(services.dispose);
    await pumpApp(
      tester,
      Scaffold(body: MyApplicationsPage(services: services)),
      size: const Size(320, 640),
      textScale: 1.6,
    );
    await _settle(tester);
    expect(tester.takeException(), isNull);
  });
}

typedef PdfSaverFake = Future<bool> Function(String name, Uint8List bytes);
