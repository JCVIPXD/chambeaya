import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the demo repository requires an explicit demo mode', () {
    expect(
      createWorkerMarketplaceRepository(demoMode: true),
      isA<DemoWorkerMarketplaceRepository>(),
    );
    expect(
      () => createWorkerMarketplaceRepository(demoMode: false),
      throwsUnsupportedError,
    );
  });
}
