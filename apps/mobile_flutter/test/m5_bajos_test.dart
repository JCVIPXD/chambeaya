import 'dart:async';

import 'package:chambeaya_mobile/features/auth/auth_page.dart';
import 'package:chambeaya_mobile/features/auth/auth_repository.dart';
import 'package:chambeaya_mobile/features/auth/auth_session.dart';
import 'package:chambeaya_mobile/features/auth/auth_session_store.dart';
import 'package:chambeaya_mobile/features/jobs/api_client.dart';
import 'package:chambeaya_mobile/features/jobs/demo_jobs_backend.dart';
import 'package:chambeaya_mobile/features/jobs/job_events_source.dart';
import 'package:chambeaya_mobile/features/jobs/job_postings_page.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_models.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_services.dart';
import 'package:chambeaya_mobile/features/onboarding/onboarding_page.dart';
import 'package:chambeaya_mobile/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/jobs_fixtures.dart';

// Bajos abiertos de la reauditoría CN-20261110-059 (BAJO-1, 3, 4, 5 y 6).

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

class _MemorySessionStore implements AuthSessionStore {
  _MemorySessionStore(this.session);

  AuthSession? session;

  @override
  Future<void> clear() async => session = null;

  @override
  Future<AuthSession?> read() async => session;

  @override
  Future<void> write(AuthSession value) async => session = value;
}

class _RestoringAuthRepository extends AuthRepository {
  @override
  Future<AuthSession> restore(String token) async => AuthSession(
    token: token,
    audience: AppAudience.worker,
    name: 'Ana Torres',
  );

  @override
  Future<void> logout(String token) async {}
}

class _RecordingAuthRepository extends AuthRepository {
  final logins = <String>[];
  final registrations = <String>[];

  @override
  Future<AuthSession> login({required String email, required String password}) {
    logins.add('$email|$password');
    return Future<AuthSession>.error(
      const AuthFailure(AuthFailureKind.invalidCredentials, statusCode: 401),
    );
  }

  @override
  Future<AuthSession> register({
    required String name,
    required String email,
    required String password,
    required String identifier,
    String? referralCode,
  }) {
    registrations.add('$email|$identifier');
    return Future<AuthSession>.error(const AuthFailure(AuthFailureKind.connectivity));
  }
}

/// Fuente de avisos que cuenta conexiones y permite emitir a mano.
class _CountingSource implements JobEventsSource {
  int watches = 0;
  int cancels = 0;
  late StreamController<JobEventNotification> controller;

  @override
  Stream<JobEventNotification> watch() {
    watches += 1;
    controller = StreamController<JobEventNotification>(onCancel: () => cancels += 1);
    return controller.stream;
  }
}

JobEventNotification _event(String id) => JobEventNotification(
  type: 'OFFER_ISSUED',
  applicationId: id,
  postingId: 'p',
  status: ApplicationStatus.offer,
);

void main() {
  group('BAJO-1: «Continuar sin prioridad» muestra el costo que queda', () {
    testWidgets('con la cuota agotada se cotiza la postulación y se confirma antes de enviar', (
      tester,
    ) async {
      final backend = DemoJobsBackend(balance: 50, freeQuotaPerMonth: 0, extraCost: 5);
      final services = JobsServices.demo(backend);
      addTearDown(services.dispose);
      await pumpApp(
        tester,
        Scaffold(
          body: JobPostingsPage(services: services, debounce: const Duration(milliseconds: 10)),
        ),
      );
      await _settle(tester);
      final card = find.byKey(const Key('posting-card-demo-job-2'));
      await tester.ensureVisible(card);
      await tester.pump();
      await tester.tap(card);
      await _settle(tester);
      await tester.tap(find.byKey(const Key('apply-button')));
      await _settle(tester);
      await tester.tap(find.byKey(const Key('priority-switch')));
      await tester.pump();
      // Solo falla la cotización de la prioridad; la de la postulación llega.
      backend.scriptError('quote:APPLICATION_PRIORITY', const ApiException(0, 'NETWORK_ERROR'));
      await tester.tap(find.byKey(const Key('submit-application')));
      await _settle(tester);
      expect(find.textContaining('No pudimos consultar el costo'), findsOneWidget);
      await tester.tap(find.text('Continuar sin prioridad'));
      await _settle(tester);

      // No se envió: primero se muestra el costo de la postulación.
      expect(backend.callCount('apply'), 0);
      expect(find.textContaining('Confirmar y pagar 5 Chambitas'), findsOneWidget);
      await tester.tap(find.textContaining('Confirmar y pagar'));
      await _settle(tester);
      expect(backend.applyPriorities, [false]);
      expect(backend.currentBalance, 45);
    });
  });

  group('BAJO-3: tras un 401 se vuelve directo al login', () {
    testWidgets('ChambeayaApp: sin pasar por la bienvenida y con el aviso de sesión vencida', (
      tester,
    ) async {
      SharedPreferences.setMockInitialValues({});
      final store = _MemorySessionStore(
        const AuthSession(token: 'viejo', audience: AppAudience.worker, name: 'Ana Torres'),
      );
      final mock = MockClient.streaming((request, _) async {
        return http.StreamedResponse(
          Stream.value('{"error":"INVALID_SESSION"}'.codeUnits),
          401,
        );
      });
      await tester.pumpWidget(
        ChambeayaApp(
          sessionStore: store,
          authRepository: _RestoringAuthRepository(),
          demoModeOverride: false,
          jobsHttpClient: mock,
        ),
      );
      // Restaura la sesión, abre el panel y la primera petición responde 401.
      await tester.pump();
      for (var i = 0; i < 30; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      await tester.pump(const Duration(seconds: 1));

      expect(store.session, isNull);
      expect(find.text('Inicia sesión'), findsOneWidget);
      expect(find.byType(OnboardingPage), findsNothing);
      expect(find.text('Tu sesión venció. Vuelve a ingresar.'), findsOneWidget);
    });
  });

  group('BAJO-3: el 401 también llega por el SSE', () {
    test('HttpJobEventsSource avisa a onUnauthorized y emite el error', () async {
      var expired = 0;
      final mock = MockClient.streaming((request, _) async {
        return http.StreamedResponse(const Stream<List<int>>.empty(), 401);
      });
      final source = HttpJobEventsSource(
        api: ApiClient(
          client: mock,
          baseUrl: 'http://api.test/api',
          token: 't',
          onUnauthorized: () => expired++,
        ),
      );
      final done = Completer<void>();
      final errors = <Object>[];
      source.watch().listen((_) {}, onError: errors.add, onDone: done.complete);
      await done.future.timeout(const Duration(seconds: 2));
      expect(expired, 1);
      expect(errors.single, isA<ApiException>().having((e) => e.isUnauthorized, '401', isTrue));
    });
  });

  group('BAJO-4: un único flujo SSE compartido', () {
    test('varios oyentes usan una sola conexión y todos reciben los avisos', () async {
      final inner = _CountingSource();
      final shared = SharedJobEventsSource(inner);
      final a = <String>[];
      final b = <String>[];
      final subA = shared.watch().listen((e) => a.add(e.applicationId));
      final subB = shared.watch().listen((e) => b.add(e.applicationId));
      expect(inner.watches, 1);
      inner.controller.add(_event('x1'));
      await Future<void>.delayed(Duration.zero);
      expect(a, ['x1']);
      expect(b, ['x1']);

      // Se va uno: la conexión sigue. Se va el último: se cierra.
      await subA.cancel();
      expect(inner.cancels, 0);
      await subB.cancel();
      expect(inner.cancels, 1);

      // Un oyente nuevo reabre una sola conexión.
      final subC = shared.watch().listen((_) {});
      expect(inner.watches, 2);
      await subC.cancel();
      await shared.close();
    });

    test('el 401 llega a todos los oyentes y no se reintenta', () async {
      final inner = _CountingSource();
      final shared = SharedJobEventsSource(inner);
      final errorsA = <Object>[];
      final errorsB = <Object>[];
      final subA = shared.watch().listen((_) {}, onError: errorsA.add);
      final subB = shared.watch().listen((_) {}, onError: errorsB.add);
      inner.controller.addError(const ApiException(401, 'INVALID_SESSION'));
      await inner.controller.close();
      await Future<void>.delayed(Duration.zero);
      expect(errorsA, hasLength(1));
      expect(errorsB, hasLength(1));
      expect(inner.watches, 1);
      await subA.cancel();
      await subB.cancel();
      await shared.close();
    });

    test('JobsServices.http abre una sola petición /job-events para dos pestañas', () async {
      var connections = 0;
      final aborted = Completer<void>();
      final mock = MockClient.streaming((request, _) async {
        if (request.url.path.endsWith('/job-events')) {
          connections += 1;
          return http.StreamedResponse(
            Stream<List<int>>.fromFuture(aborted.future.then((_) => <int>[])),
            200,
          );
        }
        return http.StreamedResponse(Stream.value('{}'.codeUnits), 200);
      });
      final services = JobsServices.http(
        token: 't',
        api: ApiClient(client: mock, baseUrl: 'http://api.test/api', token: 't'),
      );
      final first = services.events.watch().listen((_) {});
      final second = services.events.watch().listen((_) {});
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(connections, 1);
      await first.cancel();
      await second.cancel();
      aborted.complete();
      services.dispose();
    });

    test('JobsServices.dispose corta la conexión compartida', () async {
      final inner = _CountingSource();
      final services = JobsServices(
        jobs: DemoJobsBackend(),
        wallet: DemoJobsBackend(),
        walletController: JobsServices.demo().walletController,
        events: inner,
      );
      services.events.watch().listen((_) {});
      expect(inner.watches, 1);
      services.dispose();
      await Future<void>.delayed(Duration.zero);
      expect(inner.cancels, 1);
    });
  });

  group('BAJO-5: paso 2 de la bienvenida', () {
    Future<void> goToStep2(WidgetTester tester, {required bool shifts}) async {
      await tester.pumpWidget(
        MaterialApp(
          home: OnboardingPage(onComplete: (_) {}, temporaryShiftsEnabled: shifts),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Siguiente'));
      await tester.pumpAndSettle();
    }

    testWidgets('con turnos apagados no promete un índice de reputación', (tester) async {
      await goToStep2(tester, shifts: false);
      expect(find.text('Tu perfil cuenta'), findsOneWidget);
      expect(find.textContaining('Índice Chambeaya'), findsNothing);
      expect(find.textContaining('puntualidad'), findsNothing);
    });

    testWidgets('con turnos encendidos conserva el texto del índice', (tester) async {
      await goToStep2(tester, shifts: true);
      expect(find.text('Índice Chambeaya'), findsOneWidget);
      expect(
        find.text('La puntualidad, asistencia y desempeño construyen tu reputación.'),
        findsOneWidget,
      );
    });
  });

  group('BAJO-6: Enter en el último campo envía el formulario', () {
    testWidgets('login: Enter en la contraseña inicia sesión', (tester) async {
      final repository = _RecordingAuthRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: AuthPage(role: AppAudience.worker, demoMode: false, repository: repository),
        ),
      );
      await tester.enterText(find.byKey(const ValueKey('auth-email')), 'a@b.pe');
      await tester.enterText(find.byKey(const ValueKey('auth-password')), 'Password1');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(repository.logins, ['a@b.pe|Password1']);
    });

    testWidgets('registro: Enter en la contraseña avanza y Enter en el DNI envía', (tester) async {
      final repository = _RecordingAuthRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: AuthPage(role: AppAudience.worker, demoMode: false, repository: repository),
        ),
      );
      await tester.tap(find.text('Quiero registrarme'));
      await tester.pump();
      await tester.enterText(find.byKey(const ValueKey('auth-name')), 'Persona Demo');
      await tester.enterText(find.byKey(const ValueKey('auth-email')), 'p@demo.pe');
      await tester.enterText(find.byKey(const ValueKey('auth-password')), 'Password1');
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pump();
      expect(repository.registrations, isEmpty);

      await tester.enterText(find.byKey(const ValueKey('auth-dni')), '12345678');
      // Sin campo de referido, el DNI es el último: Enter envía.
      expect(find.byKey(const ValueKey('auth-referral')), findsNothing);
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(repository.registrations, ['p@demo.pe|12345678']);
    });
  });
}
