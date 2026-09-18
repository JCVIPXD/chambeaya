import 'package:chambeaya_mobile/features/discovery/discovery_models.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_data.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_secondary_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Cubre el hallazgo ALTO-1 de CN-20260916-099: `WorkerApplicationsPage` (la
// pestaña "Postulaciones", enrutada de verdad en `WorkerShell`, a diferencia
// de `ShiftsPage`) debía seguir ofreciendo "Confirmar asistencia"/"Confirmar
// llegada" sobre un turno vencido de forma permanente, porque el error real
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
