import 'package:chambeaya_mobile/features/discovery/discovery_models.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_data.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_secondary_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Cubre el hallazgo ALTO-1 de CN-20260916-099: `WorkerApplicationsPage` (la
// pestaña "Postulaciones", enrutada de verdad en `WorkerShell`, a diferencia
// de la antigua `ShiftsPage`, eliminada como código muerto en CN-20260918-007)
// debía seguir ofreciendo "Confirmar asistencia"/"Confirmar llegada" sobre un turno vencido de forma permanente, porque el error real
// del servidor se descartaba detrás de un mensaje genérico y la caché de la
// pantalla podía reintroducir el turno. Estas pruebas ejercen la pantalla
// real (no solo el repositorio) con un repositorio falso que reproduce
// exactamente esos dos síntomas.
void main() {
  testWidgets(
    'confirming an assignment whose shift already expired explains the real '
    'reason and retires the card instead of leaving a button that always fails',
    (tester) async {
      final repository = _ExpiringAcceptedRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerApplicationsPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Confirmar asistencia'), findsOneWidget);

      await tester.tap(find.text('Confirmar asistencia'));
      // Two short pumps (not pumpAndSettle) catch the SnackBar while it is
      // still visible: pumpAndSettle would keep advancing the fake clock
      // until it auto-dismisses, which would make this assertion flaky.
      await tester.pump();
      await tester.pump();
      expect(find.textContaining('ya no está disponible'), findsWidgets);

      // Now let the forced reload finish and the card retire.
      await tester.pumpAndSettle();
      expect(find.text('Confirmar asistencia'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'checking in on a shift the server no longer recognizes explains the '
    'real reason and retires the card',
    (tester) async {
      final repository = _ExpiringConfirmedRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerApplicationsPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Confirmar llegada'), findsOneWidget);

      await tester.tap(find.text('Confirmar llegada'));
      await tester.pumpAndSettle();
      // Confirms the arrival dialog before the repository call runs.
      await tester.tap(find.text('Sí, registrar llegada'));
      await tester.pump();
      await tester.pump();
      expect(find.textContaining('ya no está disponible'), findsWidgets);

      await tester.pumpAndSettle();
      expect(find.text('Confirmar llegada'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'checking in too early explains the check-in window without retiring '
    'the card (CN-20260918-002 MEDIO-2)',
    (tester) async {
      final repository = _TooEarlyCheckInRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerApplicationsPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Confirmar llegada'), findsOneWidget);

      await tester.tap(find.text('Confirmar llegada'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sí, registrar llegada'));
      await tester.pump();
      await tester.pump();
      expect(
        find.textContaining('la ventana de check-in abre 30 minutos antes'),
        findsWidgets,
      );

      // Unlike ASSIGNMENT_NOT_ACTIONABLE/isShiftGone, this is not permanent:
      // the card stays actionable so the worker can retry once the window
      // opens.
      await tester.pumpAndSettle();
      expect(find.text('Confirmar llegada'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a NO_SHOW/ABANDONED assignment reports it is no longer actionable and '
    'retires the card (CN-20260918-002 MEDIO-2)',
    (tester) async {
      final repository = _NotActionableCheckInRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerApplicationsPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Confirmar llegada'), findsOneWidget);

      await tester.tap(find.text('Confirmar llegada'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sí, registrar llegada'));
      await tester.pump();
      await tester.pump();
      expect(find.textContaining('Ya no puedes hacer esto'), findsWidgets);

      await tester.pumpAndSettle();
      expect(find.text('Confirmar llegada'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a transient failure while confirming keeps the card actionable with a '
    'generic message instead of retiring it',
    (tester) async {
      final repository = _TransientFailureRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerApplicationsPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Confirmar asistencia'));
      await tester.pump();
      await tester.pump();
      await tester.pumpAndSettle();

      expect(
        find.text('No pudimos confirmar la asignación. Inténtalo otra vez.'),
        findsOneWidget,
      );
      expect(find.text('Confirmar asistencia'), findsOneWidget);
    },
  );

  testWidgets(
    'a CONCURRENT_UPDATE conflict while confirming asks to try again and keeps '
    'the card actionable (no session error, no retirement)',
    (tester) async {
      final repository = _ConcurrentUpdateRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerApplicationsPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Confirmar asistencia'));
      await tester.pump();
      await tester.pump();
      await tester.pumpAndSettle();

      expect(
        find.text('No pudimos confirmar la asignación. Inténtalo otra vez.'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Este turno ya no está disponible'),
        findsNothing,
      );
      expect(find.text('Confirmar asistencia'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  // `onRetry` used to be `() => setState(() => _loading = _load())`: an
  // expression-bodied callback that returns the `Future`, which `setState`
  // rejects with an assertion in debug mode (before it schedules the rebuild).
  testWidgets('retrying a failed load reloads the applications without a '
      'setState assertion', (tester) async {
    final repository = _FlakyLoadRepository();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: WorkerApplicationsPage(repository: repository)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No pudimos cargar tus postulaciones'), findsOneWidget);

    await tester.tap(find.text('Reintentar'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('No pudimos cargar tus postulaciones'), findsNothing);
    expect(find.text('Confirmar asistencia'), findsOneWidget);
  });
}

const _acceptedNotConfirmedShift = Shift(
  id: 'shift-vencido',
  title: 'Mozo de Salón',
  company: 'Restaurante La Mar',
  schedule: 'Hoy · 18:00 – 00:00',
  workerPayCents: 9000,
  urgent: false,
  industry: ShiftIndustry.hospitality,
  location: 'Miraflores, Lima',
  dateScope: ShiftDateScope.any,
  state: ShiftState.assigned,
);

const _acceptedConfirmedShift = Shift(
  id: 'shift-vencido-confirmado',
  title: 'Mozo de Salón',
  company: 'Restaurante La Mar',
  schedule: 'Hoy · 18:00 – 00:00',
  workerPayCents: 9000,
  urgent: false,
  industry: ShiftIndustry.hospitality,
  location: 'Miraflores, Lima',
  dateScope: ShiftDateScope.any,
  state: ShiftState.assigned,
  assignmentConfirmed: true,
  checkInCredential: 'CUMPLE-TEST',
);

/// Simulates the real server behavior once a shift's `endsAt` has passed
/// without a check-in: `confirmAssignment` fails with `ASSIGNMENT_NOT_FOUND`
/// (matching `marketplace.service.ts`'s `endsAt: { gt: new Date() }` guard),
/// and a subsequent reload reports the application as closed and the shift as
/// no longer available, mirroring the corrected
/// `HttpWorkerMarketplaceRepository.applicationStates`/`availableShifts`.
class _ExpiringAcceptedRepository extends DemoWorkerMarketplaceRepository {
  var _closed = false;

  @override
  Future<Map<String, ApplicationState>> applicationStates() async => {
    _acceptedNotConfirmedShift.id: _closed
        ? ApplicationState.closed
        : ApplicationState.accepted,
  };

  @override
  Future<List<Shift>> availableShifts() async =>
      _closed ? const <Shift>[] : const [_acceptedNotConfirmedShift];

  @override
  Future<void> confirmAssignment(String shiftId) {
    _closed = true;
    return Future.error(const MarketplaceApiException('ASSIGNMENT_NOT_FOUND'));
  }
}

/// Same scenario as [_ExpiringAcceptedRepository] but for an assignment that
/// was already confirmed and is now failing at check-in with
/// `SHIFT_UNAVAILABLE` (matching `checkIn`'s `shift.endsAt <= new Date()`
/// guard in `marketplace.service.ts`).
class _ExpiringConfirmedRepository extends DemoWorkerMarketplaceRepository {
  var _closed = false;

  @override
  Future<Map<String, ApplicationState>> applicationStates() async => {
    _acceptedConfirmedShift.id: _closed
        ? ApplicationState.closed
        : ApplicationState.accepted,
  };

  @override
  Future<List<Shift>> availableShifts() async =>
      _closed ? const <Shift>[] : const [_acceptedConfirmedShift];

  @override
  Future<void> checkIn(String shiftId, String credential) {
    _closed = true;
    return Future.error(const MarketplaceApiException('SHIFT_UNAVAILABLE'));
  }
}

/// Simulates the server rejecting a check-in attempted before the 30-minute
/// tolerance window opens (`CHECK_IN_TOO_EARLY`, see `checkInWindowViolation`
/// in `shift-state.ts`). This is not a permanent closure: the card must stay
/// actionable so the worker can retry once the window opens.
class _TooEarlyCheckInRepository extends DemoWorkerMarketplaceRepository {
  @override
  Future<Map<String, ApplicationState>> applicationStates() async => {
    _acceptedConfirmedShift.id: ApplicationState.accepted,
  };

  @override
  Future<List<Shift>> availableShifts() async => const [
    _acceptedConfirmedShift,
  ];

  @override
  Future<void> checkIn(String shiftId, String credential) =>
      Future.error(const MarketplaceApiException('CHECK_IN_TOO_EARLY'));
}

/// Simulates the server having already resolved this assignment as
/// `NO_SHOW`/`ABANDONED` (`ASSIGNMENT_NOT_ACTIONABLE`, see
/// `resolveAssignmentLifecycle` in `shift-state.ts`): unlike
/// `CHECK_IN_TOO_EARLY`, this is a permanent closure for this assignment, so
/// the card must retire on reload.
class _NotActionableCheckInRepository extends DemoWorkerMarketplaceRepository {
  var _closed = false;

  @override
  Future<Map<String, ApplicationState>> applicationStates() async => {
    _acceptedConfirmedShift.id: _closed
        ? ApplicationState.closed
        : ApplicationState.accepted,
  };

  @override
  Future<List<Shift>> availableShifts() async =>
      _closed ? const <Shift>[] : const [_acceptedConfirmedShift];

  @override
  Future<void> checkIn(String shiftId, String credential) {
    _closed = true;
    return Future.error(
      const MarketplaceApiException('ASSIGNMENT_NOT_ACTIONABLE'),
    );
  }
}

class _TransientFailureRepository extends DemoWorkerMarketplaceRepository {
  @override
  Future<Map<String, ApplicationState>> applicationStates() async => {
    _acceptedNotConfirmedShift.id: ApplicationState.accepted,
  };

  @override
  Future<List<Shift>> availableShifts() async => const [
    _acceptedNotConfirmedShift,
  ];

  @override
  Future<void> confirmAssignment(String shiftId) =>
      Future.error(StateError('sin conexión'));
}

/// The API answers `409 CONCURRENT_UPDATE` when a serialization conflict
/// exhausted its retries: retryable, the operation was not applied.
class _ConcurrentUpdateRepository extends DemoWorkerMarketplaceRepository {
  @override
  Future<Map<String, ApplicationState>> applicationStates() async => {
    _acceptedNotConfirmedShift.id: ApplicationState.accepted,
  };

  @override
  Future<List<Shift>> availableShifts() async => const [
    _acceptedNotConfirmedShift,
  ];

  @override
  Future<void> confirmAssignment(String shiftId) =>
      Future.error(const MarketplaceApiException('CONCURRENT_UPDATE'));
}

/// Fails the first load (`applicationStates()`) and then serves an accepted,
/// not-yet-confirmed assignment, so the retry button has something to load.
class _FlakyLoadRepository extends DemoWorkerMarketplaceRepository {
  var _failed = false;

  @override
  Future<Map<String, ApplicationState>> applicationStates() {
    if (!_failed) {
      _failed = true;
      return Future.error(StateError('sin conexión'));
    }
    return Future.value({
      _acceptedNotConfirmedShift.id: ApplicationState.accepted,
    });
  }

  @override
  Future<List<Shift>> availableShifts() async => const [
    _acceptedNotConfirmedShift,
  ];
}
