import 'dart:convert';

import 'package:cumple_now_mobile/features/marketplace/app_capabilities.dart';
import 'package:cumple_now_mobile/features/discovery/discovery_models.dart';
import 'package:cumple_now_mobile/features/marketplace/marketplace_data.dart';
import 'package:cumple_now_mobile/features/marketplace/marketplace_repository.dart';
import 'package:cumple_now_mobile/features/marketplace/http_worker_marketplace_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

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

  test('HTTP repository parses live shift snapshots from SSE', () async {
    final payload = jsonEncode([
      {
        'id': 'shift-live',
        'role': 'Anfitrión de evento',
        'businessName': 'Empresa en vivo',
        'dateLabel': 'Lun 24 ago · 18:00 – 00:00',
        'workerPayCents': 12000,
        'status': 'PUBLISHED',
        'industry': 'EVENTS',
        'urgent': false,
        'location': 'Barranco',
      },
    ]);
    final client = _SseClient('event: shifts\ndata: $payload\n\n');
    final repository = HttpWorkerMarketplaceRepository(
      client: client,
      baseUri: Uri.parse('http://localhost:4000/api'),
    );

    final snapshot = await repository.watchAvailableShifts().first;

    expect(snapshot.single.id, 'shift-live');
    expect(snapshot.single.company, 'Empresa en vivo');
  });
}

class _SseClient extends http.BaseClient {
  _SseClient(this.event);
  final String event;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async =>
      http.StreamedResponse(
        Stream.value(utf8.encode(event)),
        200,
        headers: {'content-type': 'text/event-stream'},
        request: request,
      );
}
