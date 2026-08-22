import 'package:cumple_now_mobile/features/discovery/discovery_controller.dart';
import 'package:cumple_now_mobile/features/discovery/discovery_models.dart';
import 'package:cumple_now_mobile/features/marketplace/marketplace_data.dart';
import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('saving and applying update client-visible state', () {
    final controller = DiscoveryController(
      shifts: availableShifts,
      repository: DemoWorkerMarketplaceRepository(),
    );

    controller.toggleSaved('shift-la-mar');
    expect(controller.state.savedShiftIds, contains('shift-la-mar'));

    controller.applyToShift('shift-la-mar');
    expect(
      controller.state.applicationStates['shift-la-mar'],
      ApplicationState.submitted,
    );
  });

  test('save and apply operations persist through the repository', () async {
    final repository = DemoWorkerMarketplaceRepository();
    final controller = DiscoveryController(
      shifts: availableShifts,
      repository: repository,
    );

    await controller.toggleSaved('shift-la-mar');
    await controller.applyToShift('shift-la-mar');

    expect(await repository.savedShiftIds(), contains('shift-la-mar'));
    expect(
      (await repository.applicationStates())['shift-la-mar'],
      ApplicationState.submitted,
    );
  });

  test(
    'a failed save rolls back optimistic state and exposes an error',
    () async {
      final controller = DiscoveryController(
        shifts: availableShifts,
        repository: _FailingRepository(),
      );

      await controller.toggleSaved('shift-la-mar');

      expect(controller.state.savedShiftIds, isNot(contains('shift-la-mar')));
      expect(controller.state.errorMessage, isNotNull);
    },
  );

  test('industry and minimum payment filters combine', () {
    final controller = DiscoveryController(shifts: availableShifts);

    controller.setIndustry(ShiftIndustry.events);
    controller.setMinimumPayCents(11000);

    expect(controller.filteredShifts.map((shift) => shift.id), [
      'shift-eventos-peru',
    ]);
  });

  test('query and urgent filters combine and clear together', () {
    final controller = DiscoveryController(shifts: availableShifts);

    controller.setQuery('mozo');
    controller.setUrgentOnly(true);
    expect(controller.filteredShifts.map((shift) => shift.id), [
      'shift-la-mar',
    ]);

    controller.clearFilters();
    expect(controller.filteredShifts.length, availableShifts.length);
  });

  test('selected job stays selected while filters change', () {
    final controller = DiscoveryController(shifts: availableShifts);

    controller.selectShift('shift-cafe-cielo');
    controller.setRecommendedOnly(true);

    expect(controller.state.selectedShiftId, 'shift-cafe-cielo');
  });

  test('live marketplace updates add shifts and preserve the selection', () {
    final controller = DiscoveryController(shifts: availableShifts);
    controller.selectShift('shift-cafe-cielo');
    final liveShift = Shift(
      id: 'shift-live',
      title: 'Anfitrión de evento',
      company: 'Empresa en vivo',
      schedule: 'Lun 24 ago · 18:00 – 00:00',
      workerPayCents: 12000,
      match: 90,
      urgent: false,
      industry: ShiftIndustry.events,
      location: 'Barranco',
      dateScope: ShiftDateScope.any,
    );

    controller.replaceShifts([liveShift, ...availableShifts]);

    expect(controller.shifts, contains(liveShift));
    expect(controller.state.selectedShiftId, 'shift-cafe-cielo');
  });

  test(
    'unknown applications expose a concise error without changing applications',
    () {
      final controller = DiscoveryController(shifts: availableShifts);

      controller.applyToShift('missing');

      expect(controller.state.applicationStates, isEmpty);
      expect(controller.state.errorMessage, 'El turno ya no está disponible.');
    },
  );
}

class _FailingRepository extends DemoWorkerMarketplaceRepository {
  @override
  Future<void> toggleSavedShift(String shiftId) =>
      Future.error(StateError('sin conexión'));
}
