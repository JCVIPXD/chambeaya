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

  test('demo operational progress survives repository reads', () async {
    final repository = DemoWorkerMarketplaceRepository();
    final accepted = await repository.acceptShift('shift-la-mar');

    await repository.confirmAssignment(accepted.id);
    var shift = (await repository.availableShifts()).firstWhere(
      (item) => item.id == accepted.id,
    );
    expect(shift.assignmentConfirmed, isTrue);

    await repository.checkIn(shift.id, shift.checkInCredential!);
    shift = (await repository.availableShifts()).firstWhere(
      (item) => item.id == accepted.id,
    );
    expect(shift.state, ShiftState.checkedIn);
    expect(shift.checkedIn, isTrue);

    await repository.checkOut(shift.id);
    shift = (await repository.availableShifts()).firstWhere(
      (item) => item.id == accepted.id,
    );
    expect(shift.state, ShiftState.completed);
    expect(shift.checkedOut, isTrue);
  });

  test(
    'HTTP wallet reads persisted movements with the worker session token',
    () async {
      final client = _WalletClient();
      final repository = HttpWorkerMarketplaceRepository(
        client: client,
        baseUri: Uri.parse('http://localhost:4000'),
        token: 'worker-token',
      );

      final movements = await repository.walletMovements();

      expect(client.authorization, 'Bearer worker-token');
      expect(movements, hasLength(2));
      expect(movements.first.company, 'Turno liberado');
      expect(movements.first.amount, 'S/ 125.50');
      expect(movements.first.status, 'Liberado');
      expect(movements.last.status, 'Pendiente');
    },
  );

  test(
    'HTTP repository sends screening answers with the application',
    () async {
      final client = _ApplicationClient();
      final repository = HttpWorkerMarketplaceRepository(
        client: client,
        baseUri: Uri.parse('http://localhost:4000/api'),
        token: 'worker-token',
      );

      await repository.applyToShift(
        'shift-live',
        answers: const {
          '¿Tienes disponibilidad completa?': 'Sí, durante todo el turno.',
        },
      );

      expect(client.authorization, 'Bearer worker-token');
      expect(client.body, {
        'answers': [
          {
            'question': '¿Tienes disponibilidad completa?',
            'answer': 'Sí, durante todo el turno.',
          },
        ],
      });
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

  test(
    'HTTP repository does not restore a completed turn as actionable',
    () async {
      final client = _JsonClient({
        '/api/workers/applications': [
          {
            'id': 'application-completed',
            'shiftId': 'shift-completed',
            'status': 'ACCEPTED',
            'createdAt': '2026-08-24T10:00:00Z',
            'updatedAt': '2026-08-24T12:00:00Z',
            'shift': {
              'id': 'shift-completed',
              'role': 'Turno finalizado',
              'businessName': 'Empresa de prueba',
              'dateLabel': 'Lun 24 ago · 10:00 – 12:00',
              'workerPayCents': 10000,
              'status': 'COMPLETED',
              'industry': 'EVENTS',
              'urgent': false,
              'location': 'Lima',
            },
            'assignment': {
              'id': 'assignment-completed',
              'status': 'COMPLETED',
              'checkInCredential': 'CUMPLE-TEST',
            },
          },
        ],
        '/api/shifts': [],
      });
      final repository = HttpWorkerMarketplaceRepository(
        client: client,
        baseUri: Uri.parse('http://localhost:4000/api'),
      );

      final states = await repository.applicationStates();
      final shifts = await repository.availableShifts();

      expect(states['shift-completed'], ApplicationState.closed);
      expect(shifts, isEmpty);
    },
  );

  test('HTTP repository restores the persisted next worker action', () async {
    final client = _JsonClient({
      '/api/workers/applications': [
        {
          'id': 'application-assigned',
          'shiftId': 'shift-assigned',
          'status': 'ACCEPTED',
          'createdAt': '2026-08-24T10:00:00Z',
          'updatedAt': '2026-08-24T12:00:00Z',
          'shift': {
            'id': 'shift-assigned',
            'role': 'Turno confirmado',
            'businessName': 'Empresa de prueba',
            'dateLabel': 'Lun 24 ago · 10:00 – 12:00',
            'workerPayCents': 10000,
            'status': 'ASSIGNED',
            'industry': 'EVENTS',
            'urgent': false,
            'location': 'Lima',
          },
          'assignment': {
            'id': 'assignment-active',
            'status': 'ASSIGNED',
            'checkInCredential': 'CUMPLE-TEST',
            'workerConfirmedAt': '2026-08-24T10:30:00Z',
            'checkedInAt': null,
            'checkedOutAt': null,
          },
        },
      ],
      '/api/shifts': [],
    });
    final repository = HttpWorkerMarketplaceRepository(
      client: client,
      baseUri: Uri.parse('http://localhost:4000/api'),
    );

    await repository.applicationStates();
    final shift = (await repository.availableShifts()).single;

    expect(shift.assignmentConfirmed, isTrue);
    expect(shift.checkedIn, isFalse);
    expect(shift.checkInCredential, 'CUMPLE-TEST');
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

class _JsonClient extends http.BaseClient {
  _JsonClient(this.responses);
  final Map<String, dynamic> responses;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final payload = responses[request.url.path] ?? <dynamic>[];
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(payload))),
      200,
      headers: {'content-type': 'application/json'},
      request: request,
    );
  }
}

class _ApplicationClient extends http.BaseClient {
  Map<String, dynamic>? body;
  String? authorization;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    authorization = request.headers['authorization'];
    body =
        jsonDecode(await request.finalize().bytesToString())
            as Map<String, dynamic>;
    return http.StreamedResponse(
      Stream.value(utf8.encode('{}')),
      201,
      headers: {'content-type': 'application/json'},
      request: request,
    );
  }
}

class _WalletClient extends http.BaseClient {
  String? authorization;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    authorization = request.headers['authorization'];
    return http.StreamedResponse(
      Stream.value(
        utf8.encode(
          jsonEncode({
            'balanceCents': 12550,
            'movements': [
              {
                'id': 'movement-1',
                'amountCents': 12550,
                'description': 'Turno liberado',
                'status': 'RELEASED',
              },
              {
                'id': 'movement-2',
                'amountCents': 5000,
                'description': 'Turno pendiente',
                'status': 'PENDING',
              },
            ],
          }),
        ),
      ),
      200,
      headers: {'content-type': 'application/json'},
      request: request,
    );
  }
}
