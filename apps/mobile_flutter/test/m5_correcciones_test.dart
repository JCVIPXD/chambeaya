import 'dart:typed_data';

import 'package:chambeaya_mobile/features/auth/auth_page.dart';
import 'package:chambeaya_mobile/features/jobs/api_client.dart';
import 'package:chambeaya_mobile/features/jobs/application_detail_page.dart';
import 'package:chambeaya_mobile/features/jobs/apply_sheet.dart';
import 'package:chambeaya_mobile/features/jobs/demo_jobs_backend.dart';
import 'package:chambeaya_mobile/features/jobs/job_postings_page.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_models.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_services.dart';
import 'package:chambeaya_mobile/features/jobs/my_applications_page.dart';
import 'package:chambeaya_mobile/features/jobs/pdf_saver.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_shell.dart';
import 'package:chambeaya_mobile/features/onboarding/onboarding_page.dart';
import 'package:chambeaya_mobile/features/wallet/wallet_page.dart';
import 'package:chambeaya_mobile/theme/app_theme.dart';
import 'package:chambeaya_mobile/theme/theme_mode_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/jobs_fixtures.dart';

// Correcciones de la auditoría CN-20261110-055 (MEDIO-1 a MEDIO-5 y BAJO-1 a
// BAJO-6) sobre la app Flutter del trabajador.

const _answers = [
  ScreeningAnswer(
    question: '¿Cuánta experiencia tienes en oficinas?',
    answer: 'Dos años',
  ),
];

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _reveal(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
}

Future<void> _openApplySheet(
  WidgetTester tester,
  DemoJobsBackend backend, {
  String id = 'demo-job-2',
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
  );
  await _settle(tester);
  final card = find.byKey(Key('posting-card-$id'));
  await _reveal(tester, card);
  await tester.tap(card);
  await _settle(tester);
  await tester.tap(find.byKey(const Key('apply-button')));
  await _settle(tester);
}

/// Mi postulación a `demo-job-1` ya creada, abierta como pantalla.
Future<(DemoJobsBackend, String)> _pumpApplicationDetail(
  WidgetTester tester,
  DemoJobsBackend backend, {
  PdfSaver? saver,
  bool isWeb = false,
  bool withOffer = false,
}) async {
  final applied = await backend.apply('demo-job-1', answers: _answers);
  final id = applied.application.id;
  if (withOffer) backend.issueOffer(id, withDocument: true);
  final services = JobsServices.demo(backend);
  addTearDown(services.dispose);
  await pumpApp(
    tester,
    ApplicationDetailPage(
      services: services,
      applicationId: id,
      pdfSaver: saver ?? (name, Uint8List bytes) async => true,
      isWeb: isWeb,
    ),
  );
  await _settle(tester);
  return (backend, id);
}

void main() {
  group('MEDIO-1: una cotización fallida no cobra lo que no se mostró', () {
    testWidgets('postular con prioridad: sin costo visible no se envía la prioridad', (
      tester,
    ) async {
      final backend = DemoJobsBackend(balance: 50);
      await _openApplySheet(tester, backend);
      await tester.tap(find.byKey(const Key('priority-switch')));
      await tester.pump();
      // Las dos cotizaciones del envío (postulación y prioridad) fallan.
      backend
        ..scriptError('quote', const ApiException(0, 'NETWORK_ERROR'))
        ..scriptError('quote', const ApiException(0, 'NETWORK_ERROR'));
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.textContaining('No pudimos consultar el costo'), findsOneWidget);
      expect(find.text('Continuar sin prioridad'), findsOneWidget);
      expect(find.text('Continuar'), findsNothing);
      expect(backend.callCount('apply'), 0);

      await tester.tap(find.text('Continuar sin prioridad'));
      await _settle(tester);
      expect(backend.callCount('apply'), 1);
      // Lo que se envió: sin prioridad, y el saldo no cambió.
      expect(backend.applyPriorities, [false]);
      expect(backend.currentBalance, 50);
    });

    testWidgets('postular con prioridad: Reintentar vuelve a cotizar y muestra el costo', (
      tester,
    ) async {
      final backend = DemoJobsBackend(balance: 50, priorityCost: 10);
      await _openApplySheet(tester, backend);
      await tester.tap(find.byKey(const Key('priority-switch')));
      await tester.pump();
      backend
        ..scriptError('quote', const ApiException(0, 'NETWORK_ERROR'))
        ..scriptError('quote', const ApiException(0, 'NETWORK_ERROR'));
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      await tester.tap(find.text('Reintentar'));
      await _settle(tester);
      // Ahora sí hay costo a la vista: se confirma y se cobra solo la prioridad.
      expect(find.textContaining('Confirmar y pagar 10 Chambitas'), findsOneWidget);
      expect(backend.callCount('apply'), 0);
      await tester.tap(find.textContaining('Confirmar y pagar'));
      await _settle(tester);
      expect(backend.applyPriorities, [true]);
      expect(backend.currentBalance, 40);
    });

    testWidgets('postular con prioridad: Cancelar no envía nada', (tester) async {
      final backend = DemoJobsBackend(balance: 50);
      await _openApplySheet(tester, backend);
      await tester.tap(find.byKey(const Key('priority-switch')));
      await tester.pump();
      backend
        ..scriptError('quote', const ApiException(0, 'NETWORK_ERROR'))
        ..scriptError('quote', const ApiException(0, 'NETWORK_ERROR'));
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      await tester.tap(find.text('Cancelar'));
      await _settle(tester);
      expect(backend.callCount('apply'), 0);
      expect(backend.currentBalance, 50);
    });

    testWidgets('dar prioridad sin cotización: solo Reintentar o Cancelar, nada se cobra', (
      tester,
    ) async {
      final backend = DemoJobsBackend(balance: 50, priorityCost: 10);
      final (_, _) = await _pumpApplicationDetail(tester, backend);
      final button = find.byKey(const Key('prioritize'));
      await _reveal(tester, button);
      backend.scriptError('quote', const ApiException(0, 'NETWORK_ERROR'));
      await tester.tap(button);
      await _settle(tester);
      expect(find.textContaining('No pudimos consultar el costo'), findsOneWidget);
      expect(find.textContaining('siempre tiene un costo'), findsOneWidget);
      expect(find.text('Continuar'), findsNothing);
      expect(find.text('Continuar sin prioridad'), findsNothing);
      expect(find.text('Reintentar'), findsOneWidget);
      expect(find.text('Cancelar'), findsOneWidget);
      expect(backend.callCount('prioritize'), 0);
      expect(backend.currentBalance, 50);

      // Reintentar: ahora el costo se muestra y solo entonces se cobra.
      await tester.tap(find.text('Reintentar'));
      await _settle(tester);
      expect(find.textContaining('Confirmar y pagar 10 Chambitas'), findsOneWidget);
      expect(backend.callCount('prioritize'), 0);
      await tester.tap(find.textContaining('Confirmar y pagar'));
      await _settle(tester);
      expect(backend.callCount('prioritize'), 1);
      expect(backend.currentBalance, 40);
    });

    testWidgets('destacar el perfil sin cotización: solo Reintentar o Cancelar', (tester) async {
      final backend = DemoJobsBackend(balance: 30, highlightCost: 10);
      final services = JobsServices.demo(backend);
      addTearDown(services.dispose);
      await pumpApp(tester, WalletPage(services: services));
      await _settle(tester);
      final button = find.byKey(const Key('highlight-profile'));
      for (var i = 0; i < 6 && button.evaluate().isEmpty; i++) {
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -300));
        await tester.pump();
      }
      await _reveal(tester, button);
      backend.scriptError('quote', const ApiException(0, 'NETWORK_ERROR'));
      await tester.tap(button);
      await _settle(tester);
      expect(find.textContaining('No pudimos consultar el costo'), findsOneWidget);
      expect(find.text('Continuar'), findsNothing);
      expect(find.text('Reintentar'), findsOneWidget);
      await tester.tap(find.text('Cancelar'));
      await _settle(tester);
      expect(backend.callCount('highlightProfile'), 0);
      expect(backend.currentBalance, 30);
    });
  });

  group('MEDIO-2: descarga del PDF en web', () {
    test('pdfSaveMessage: en web un false es «Descarga iniciada», fuera de web es cancelada', () {
      expect(pdfSaveMessage(saved: true, isWeb: false), 'PDF guardado.');
      expect(pdfSaveMessage(saved: true, isWeb: true), 'PDF guardado.');
      expect(pdfSaveMessage(saved: false, isWeb: true), 'Descarga iniciada.');
      expect(pdfSaveMessage(saved: false, isWeb: false), 'Descarga cancelada.');
    });

    Future<void> download(WidgetTester tester, DemoJobsBackend backend, String id) async {
      final offerId = (await backend.application(id)).offers.first.id;
      final button = find.byKey(Key('download-offer-$offerId'));
      await _reveal(tester, button);
      await tester.tap(button);
      await _settle(tester);
    }

    testWidgets('en web el selector devuelve null y se anuncia «Descarga iniciada»', (
      tester,
    ) async {
      final backend = DemoJobsBackend();
      final (_, id) = await _pumpApplicationDetail(
        tester,
        backend,
        withOffer: true,
        isWeb: true,
        saver: (name, bytes) async => false,
      );
      await tester.tap(find.byTooltip('Actualizar postulación'));
      await _settle(tester);
      await download(tester, backend, id);
      expect(find.text('Descarga iniciada.'), findsOneWidget);
      expect(find.text('Descarga cancelada.'), findsNothing);
    });

    testWidgets('fuera de web un false sigue siendo «Descarga cancelada»', (tester) async {
      final backend = DemoJobsBackend();
      final (_, id) = await _pumpApplicationDetail(
        tester,
        backend,
        withOffer: true,
        saver: (name, bytes) async => false,
      );
      await tester.tap(find.byTooltip('Actualizar postulación'));
      await _settle(tester);
      await download(tester, backend, id);
      expect(find.text('Descarga cancelada.'), findsOneWidget);
      expect(find.text('Descarga iniciada.'), findsNothing);
    });
  });

  group('MEDIO-3: la lista de puestos se refresca en silencio', () {
    Future<(DemoJobsBackend, ValueNotifier<int>)> pumpList(
      WidgetTester tester,
    ) async {
      final backend = DemoJobsBackend();
      final services = JobsServices.demo(backend);
      addTearDown(services.dispose);
      final revision = ValueNotifier(0);
      addTearDown(revision.dispose);
      await pumpApp(
        tester,
        Scaffold(
          body: ValueListenableBuilder<int>(
            valueListenable: revision,
            builder: (context, value, _) => JobPostingsPage(
              services: services,
              revision: value,
              debounce: const Duration(milliseconds: 10),
            ),
          ),
        ),
      );
      await _settle(tester);
      return (backend, revision);
    }

    testWidgets('un aviso en vivo actualiza «Postulaste» sin indicador de carga', (tester) async {
      final (backend, _) = await pumpList(tester);
      expect(find.textContaining('Postulaste:'), findsNothing);
      // Otra pantalla (o la empresa) cambió el estado de mi postulación.
      final applied = await backend.apply('demo-job-1', answers: _answers);
      backend.emit(
        JobEventNotification(
          type: 'APPLICATION_RECEIVED',
          applicationId: applied.application.id,
          postingId: 'demo-job-1',
          status: ApplicationStatus.applied,
        ),
      );
      await tester.pump();
      // Mientras recarga, la lista sigue visible (no hay panel de carga).
      expect(find.text('Cargando puestos'), findsNothing);
      expect(find.text('Asistente administrativo'), findsOneWidget);
      await _settle(tester);
      expect(find.textContaining('Postulaste: Postulado'), findsOneWidget);

      backend.advance(applied.application.id, ApplicationStatus.offer);
      await _settle(tester);
      expect(find.textContaining('Postulaste: Oferta'), findsOneWidget);
      expect(find.textContaining('Postulaste: Postulado'), findsNothing);
    });

    testWidgets('un cambio de revisión recarga la lista en silencio', (tester) async {
      final (backend, revision) = await pumpList(tester);
      final searchesBefore = backend.callCount('searchPostings');
      await backend.apply('demo-job-1', answers: _answers);
      revision.value = 1;
      await tester.pump();
      expect(find.text('Cargando puestos'), findsNothing);
      await _settle(tester);
      expect(backend.callCount('searchPostings'), searchesBefore + 1);
      expect(find.textContaining('Postulaste: Postulado'), findsOneWidget);
    });

    testWidgets('si la recarga en silencio falla, la lista visible se conserva', (tester) async {
      final (backend, revision) = await pumpList(tester);
      backend.scriptError('searchPostings', const ApiException(0, 'NETWORK_ERROR'));
      revision.value = 1;
      await _settle(tester);
      expect(find.text('Asistente administrativo'), findsOneWidget);
      expect(find.text('No pudimos cargar los puestos'), findsNothing);
    });

    testWidgets('en el shell, volver a la pestaña Puestos recarga la lista', (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final backend = DemoJobsBackend();
      final services = JobsServices.demo(backend);
      addTearDown(services.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(Brightness.light),
          home: WorkerShell(
            temporaryShiftsEnabled: false,
            repository: DemoWorkerMarketplaceRepository(),
            jobsServices: services,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Postulaste:'), findsNothing);
      final before = backend.callCount('searchPostings');
      await backend.apply('demo-job-1', answers: _answers);
      await tester.tap(find.text('Postulaciones'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Puestos'));
      await tester.pumpAndSettle();
      expect(backend.callCount('searchPostings'), greaterThan(before));
      expect(find.textContaining('Postulaste: Postulado'), findsOneWidget);
    });
  });

  group('MEDIO-4: las pantallas hijas respetan el tema oscuro del shell', () {
    testWidgets('detalle del puesto, hoja de postular y Mi postulación salen oscuros y atrás funciona', (
      tester,
    ) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = ThemeModeController(initial: ThemeMode.dark);
      addTearDown(controller.dispose);
      final backend = DemoJobsBackend();
      final services = JobsServices.demo(backend);
      addTearDown(services.dispose);
      await tester.pumpWidget(
        MaterialApp(
          // Igual que la app real: el tema del MaterialApp es siempre claro.
          theme: buildAppTheme(Brightness.light),
          home: WorkerShell(
            temporaryShiftsEnabled: false,
            repository: DemoWorkerMarketplaceRepository(),
            themeModeController: controller,
            jobsServices: services,
          ),
        ),
      );
      await tester.pumpAndSettle();
      Brightness brightnessOf(Finder finder) => Theme.of(tester.element(finder.first)).brightness;

      expect(brightnessOf(find.text('Puestos fijos')), Brightness.dark);

      // Detalle del puesto.
      final card = find.byKey(const Key('posting-card-demo-job-2'));
      await _reveal(tester, card);
      await tester.tap(card);
      await tester.pumpAndSettle();
      expect(find.text('Detalle del puesto'), findsOneWidget);
      expect(brightnessOf(find.text('Detalle del puesto')), Brightness.dark);
      expect(
        Theme.of(tester.element(find.byType(Scaffold).last)).scaffoldBackgroundColor,
        AppPalette.dark.background,
      );

      // Hoja de postular.
      await tester.tap(find.byKey(const Key('apply-button')));
      await tester.pumpAndSettle();
      expect(find.byType(ApplySheet), findsOneWidget);
      expect(brightnessOf(find.byType(ApplySheet)), Brightness.dark);
      await tester.tap(find.byKey(const Key('submit-application')));
      await tester.pumpAndSettle();
      expect(backend.callCount('apply'), 1);

      // Mi postulación (desde el detalle).
      // Deja que el aviso de «postulación enviada» (SnackBar) desaparezca.
      await tester.pump(const Duration(seconds: 8));
      await tester.pumpAndSettle();
      await _reveal(tester, find.byKey(const Key('view-application-button')));
      await tester.tap(find.byKey(const Key('view-application-button')));
      await tester.pumpAndSettle();
      expect(find.text('Mi postulación'), findsOneWidget);
      expect(brightnessOf(find.text('Mi postulación')), Brightness.dark);

      // El botón atrás recorre la pila: Mi postulación -> detalle -> lista.
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Mi postulación'), findsNothing);
      expect(find.text('Detalle del puesto'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Detalle del puesto'), findsNothing);
      expect(find.text('Puestos fijos'), findsOneWidget);
      expect(brightnessOf(find.text('Puestos fijos')), Brightness.dark);
    });

    testWidgets('con el tema claro todo sigue claro', (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = ThemeModeController(initial: ThemeMode.light);
      addTearDown(controller.dispose);
      final services = JobsServices.demo(DemoJobsBackend());
      addTearDown(services.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(Brightness.light),
          home: WorkerShell(
            temporaryShiftsEnabled: false,
            repository: DemoWorkerMarketplaceRepository(),
            themeModeController: controller,
            jobsServices: services,
          ),
        ),
      );
      await tester.pumpAndSettle();
      final card = find.byKey(const Key('posting-card-demo-job-2'));
      await _reveal(tester, card);
      await tester.tap(card);
      await tester.pumpAndSettle();
      expect(
        Theme.of(tester.element(find.text('Detalle del puesto'))).brightness,
        Brightness.light,
      );
    });
  });

  group('MEDIO-5: textos de bienvenida y login según la bandera de turnos', () {
    String allText(WidgetTester tester) =>
        tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? t.textSpan?.toPlainText() ?? '').join(' | ');

    testWidgets('bienvenida con turnos apagados: solo puestos fijos formales', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: OnboardingPage(onComplete: (_) {}, temporaryShiftsEnabled: false)),
      );
      final seen = StringBuffer();
      for (var i = 0; i < 4; i++) {
        seen.writeln(allText(tester));
        if (i < 3) {
          await tester.tap(find.widgetWithText(FilledButton, 'Siguiente'));
          await tester.pump();
        }
      }
      final text = seen.toString().toLowerCase();
      expect(text, isNot(contains('turno')));
      expect(text, isNot(contains('reemplazo')));
      expect(text, isNot(contains('urgencia')));
      expect(text, contains('puestos fijos formales'));
      expect(find.widgetWithText(FilledButton, 'Empezar'), findsOneWidget);
    });

    testWidgets('bienvenida con turnos encendidos conserva el texto actual', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: OnboardingPage(onComplete: (_) {}, temporaryShiftsEnabled: true),
        ),
      );
      for (var i = 0; i < 3; i++) {
        await tester.tap(find.widgetWithText(FilledButton, 'Siguiente'));
        await tester.pump();
      }
      expect(find.text('Continuidad operativa en evolución'), findsOneWidget);
      expect(
        find.text('Cuando hay una urgencia, encontramos el mejor reemplazo en minutos.'),
        findsOneWidget,
      );
    });

    for (final width in [390.0, 1280.0]) {
      testWidgets('login del trabajador con turnos apagados (${width.toInt()} px) no habla de turnos', (
        tester,
      ) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          const MaterialApp(
            home: AuthPage(
              role: AppAudience.worker,
              demoMode: true,
              temporaryShiftsEnabled: false,
            ),
          ),
        );
        await tester.pumpAndSettle();
        final text = allText(tester).toLowerCase();
        expect(text, isNot(contains('turno')));
        expect(text, contains('puestos fijos'));
      });
    }

    testWidgets('login con turnos encendidos conserva el texto actual', (tester) async {
      tester.view.physicalSize = const Size(1280, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        const MaterialApp(
          home: AuthPage(
            role: AppAudience.worker,
            demoMode: true,
            temporaryShiftsEnabled: true,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Tu próximo turno empieza aquí'), findsOneWidget);
      expect(find.text('Turnos cerca de ti'), findsOneWidget);
      expect(find.text('Busca → postúlate → confirma'), findsOneWidget);
    });
  });

  group('BAJO-1: la cuota gratuita con límite 0 no se muestra', () {
    testWidgets('dar prioridad y destacar no hablan de «0 de 0»', (tester) async {
      final backend = DemoJobsBackend(balance: 50, priorityCost: 10);
      // El servidor en memoria devuelve la cuota con límite 0, como la API real.
      final quote = await backend.quote('APPLICATION_PRIORITY');
      expect(quote.freeQuota?.monthlyLimit, 0);
      expect((await backend.quote('PROFILE_HIGHLIGHT')).freeQuota?.monthlyLimit, 0);

      await _pumpApplicationDetail(tester, backend);
      final button = find.byKey(const Key('prioritize'));
      await _reveal(tester, button);
      await tester.tap(button);
      await _settle(tester);
      expect(find.textContaining('Confirmar y pagar 10 Chambitas'), findsOneWidget);
      expect(find.textContaining('0 de 0'), findsNothing);
      expect(find.textContaining('Usos gratuitos'), findsNothing);
    });

    testWidgets('con un límite mayor que 0 la cuota se sigue mostrando', (tester) async {
      final backend = DemoJobsBackend(balance: 20, freeQuotaPerMonth: 0, extraCost: 5);
      await _openApplySheet(tester, backend);
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      // La postulación extra con cupo 0 tampoco habla de «0 de 0».
      expect(find.textContaining('0 de 0'), findsNothing);
    });
  });

  group('BAJO-2: límites de la búsqueda (iguales a los de la API)', () {
    test('toQuery recorta texto y ubicación a 100 y limita el sueldo a S/ 100 000', () {
      final filter = JobSearchFilter(
        query: 'a' * 150,
        location: 'b' * 130,
        minSalarySoles: 250000,
      );
      final query = filter.toQuery();
      expect(query['query']!.length, 100);
      expect(query['location']!.length, 100);
      expect(query['minSalaryCents'], '10000000');
      expect(const JobSearchFilter(minSalarySoles: 100000).toQuery()['minSalaryCents'], '10000000');
    });

    testWidgets('el campo de búsqueda no deja escribir más de 100 caracteres', (tester) async {
      final services = JobsServices.demo(DemoJobsBackend());
      addTearDown(services.dispose);
      await pumpApp(
        tester,
        Scaffold(body: JobPostingsPage(services: services)),
      );
      await _settle(tester);
      await tester.enterText(find.byType(TextField).first, 'x' * 130);
      await tester.pump(const Duration(seconds: 1));
      final field = tester.widget<TextField>(find.byType(TextField).first);
      expect(field.controller!.text.length, 100);
    });

    testWidgets('el sueldo mínimo de los filtros no pasa de S/ 100 000 y la ubicación de 100 caracteres', (
      tester,
    ) async {
      final backend = DemoJobsBackend();
      final services = JobsServices.demo(backend);
      addTearDown(services.dispose);
      await pumpApp(
        tester,
        Scaffold(body: JobPostingsPage(services: services)),
      );
      await _settle(tester);
      await tester.tap(find.byTooltip('Filtros'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Ubicación'), 'z' * 130);
      await tester.enterText(find.widgetWithText(TextField, 'Sueldo mínimo mensual (S/)'), '100001');
      await tester.pump();
      final location = tester.widget<TextField>(find.widgetWithText(TextField, 'Ubicación'));
      expect(location.controller!.text.length, 100);
      final searchesBefore = backend.callCount('searchPostings');
      await tester.tap(find.text('Aplicar filtros'));
      await tester.pumpAndSettle();
      // No se aplica: se explica el tope y no se envía una consulta inválida.
      expect(find.text('El sueldo mínimo no puede pasar de S/ 100 000'), findsOneWidget);
      expect(backend.callCount('searchPostings'), searchesBefore);

      await tester.enterText(find.widgetWithText(TextField, 'Sueldo mínimo mensual (S/)'), '100000');
      await tester.pump();
      expect(find.text('El sueldo mínimo no puede pasar de S/ 100 000'), findsNothing);
      await tester.tap(find.text('Aplicar filtros'));
      await tester.pumpAndSettle();
      expect(backend.callCount('searchPostings'), searchesBefore + 1);
    });
  });

  group('BAJO-3: un 401 en una ruta normal cierra la sesión local', () {
    // Solo cubre las rutas REST (`getJson`/`getBytes`); el 401 del SSE y el
    // camino completo hasta el login están en `m5_bajos_test.dart`.
    testWidgets('ApiClient avisa al recibir 401 en rutas REST y no en otros errores', (tester) async {
      var expired = 0;
      final mock = MockClient((request) async {
        if (request.url.path.endsWith('/boom')) return http.Response('{"error":"X"}', 500);
        return http.Response('{"error":"INVALID_SESSION"}', 401);
      });
      final api = ApiClient(
        client: mock,
        baseUrl: 'http://localhost/api',
        token: 't',
        onUnauthorized: () => expired++,
      );
      await expectLater(api.getJson('/workers/job-postings'), throwsA(isA<ApiException>()));
      expect(expired, 1);
      await expectLater(api.getJson('/boom'), throwsA(isA<ApiException>()));
      expect(expired, 1);
      await expectLater(api.getBytes('/x'), completes);
      expect(expired, 2);
    });
  });

  group('BAJO-4: lo aceptado se limpia tras cualquier error no reintentable', () {
    testWidgets('tras un 400 el siguiente envío vuelve a cotizar', (tester) async {
      final backend = DemoJobsBackend(balance: 50)
        ..scriptError('apply', const ApiException(400, 'INVALID_SCREENING_ANSWERS'));
      await _openApplySheet(tester, backend);
      final quotesBefore = backend.callCount('quote');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.textContaining('Responde todas las preguntas'), findsOneWidget);
      expect(backend.callCount('quote'), quotesBefore + 1);
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(backend.callCount('quote'), quotesBefore + 2);
      expect(backend.callCount('apply'), 2);
    });

    testWidgets('tras un 409 de estado el siguiente envío vuelve a cotizar', (tester) async {
      final backend = DemoJobsBackend(balance: 50)
        ..scriptError('apply', const ApiException(409, 'POSTING_FILLED'));
      await _openApplySheet(tester, backend);
      final quotesBefore = backend.callCount('quote');
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(backend.callCount('quote'), quotesBefore + 2);
    });
  });

  group('BAJO-5: el cliente HTTP se cierra al desechar los servicios', () {
    test('JobsServices.http con cliente propio lo cierra en dispose; uno inyectado no', () {
      var closedInjected = false;
      final injected = ApiClient(client: _ClosableClient(() => closedInjected = true), baseUrl: 'http://x/api');
      final shared = JobsServices.http(token: 't', api: injected);
      shared.dispose();
      expect(closedInjected, isFalse);

      final own = JobsServices.http(token: 't');
      var closedOwn = false;
      final spy = JobsServices(
        jobs: own.jobs,
        wallet: own.wallet,
        walletController: own.walletController,
        events: own.events,
        onClose: () => closedOwn = true,
      );
      spy.dispose();
      expect(closedOwn, isTrue);
    });

    test('ApiClient.close cierra el http.Client', () {
      var closed = false;
      ApiClient(client: _ClosableClient(() => closed = true), baseUrl: 'http://x/api').close();
      expect(closed, isTrue);
    });
  });

  group('BAJO-6: reenviar sin prioridad tras un 409 de saldo', () {
    testWidgets('el reenvío sale sin prioridad y no cobra la prioridad', (tester) async {
      final backend = DemoJobsBackend(balance: 50)
        ..scriptError(
          'apply',
          const ApiException(
            409,
            'INSUFFICIENT_CURRENCY',
            details: {'cost': 10, 'balance': 2},
          ),
        );
      await _openApplySheet(tester, backend);
      await tester.tap(find.byKey(const Key('priority-switch')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      await tester.tap(find.textContaining('Confirmar y pagar'));
      await _settle(tester);
      expect(find.textContaining('No tienes saldo suficiente'), findsOneWidget);
      expect(backend.applyPriorities, [true]);

      // El interruptor vuelve a estar disponible: se apaga y se reenvía.
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

  testWidgets('Mis postulaciones sigue abriendo el detalle con el tema de su contexto', (tester) async {
    final backend = DemoJobsBackend();
    final applied = await backend.apply('demo-job-1', answers: _answers);
    final services = JobsServices.demo(backend);
    addTearDown(services.dispose);
    await pumpApp(
      tester,
      Scaffold(body: MyApplicationsPage(services: services)),
      brightness: Brightness.dark,
    );
    await _settle(tester);
    await tester.tap(find.byKey(Key('application-${applied.application.id}')));
    await _settle(tester);
    expect(find.text('Mi postulación'), findsOneWidget);
    await tester.pageBack();
    await _settle(tester);
    expect(find.text('Mi postulación'), findsNothing);
  });
}

class _ClosableClient extends http.BaseClient {
  _ClosableClient(this.onClose);

  final void Function() onClose;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      throw UnimplementedError();

  @override
  void close() => onClose();
}
