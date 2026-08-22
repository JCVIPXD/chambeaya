import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the default repository is demo-safe', () {
    expect(
      createWorkerMarketplaceRepository(useLocalApi: false),
      isA<DemoWorkerMarketplaceRepository>(),
    );
  });
}
