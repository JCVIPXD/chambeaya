import 'package:cumple_now_mobile/features/marketplace/app_capabilities.dart';
import 'package:cumple_now_mobile/features/discovery/discovery_models.dart';
import 'package:cumple_now_mobile/features/marketplace/marketplace_data.dart';
import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('all protected capabilities are disabled by default', () {
    expect(AppCapabilities.defaults.cameraCheckInEnabled, isFalse);
    expect(AppCapabilities.defaults.locationCheckInEnabled, isFalse);
    expect(AppCapabilities.defaults.paymentsEnabled, isFalse);
  });

  test(
    'accepting a published demo shift produces an assigned check-in credential',
    () async {
      final repository = DemoWorkerMarketplaceRepository();

      final accepted = await repository.acceptShift('shift-la-mar');

      expect(accepted.state, ShiftState.assigned);
      expect(accepted.checkInCredential, startsWith('DEMO-CUMPLE-'));
    },
  );

  test('demo repository persists saved jobs and local applications', () async {
    final repository = DemoWorkerMarketplaceRepository();

    await repository.toggleSavedShift('shift-la-mar');
    await repository.applyToShift('shift-la-mar');

    expect(await repository.savedShiftIds(), contains('shift-la-mar'));
    expect(
      (await repository.applicationStates())['shift-la-mar'],
      ApplicationState.submitted,
    );
  });
}
