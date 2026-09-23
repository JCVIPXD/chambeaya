import 'dart:convert';

import 'package:chambeaya_mobile/features/discovery/discovery_models.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_data.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/http_worker_marketplace_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
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
      expect(movements, hasLength(3));
      expect(movements.first.company, 'Turno liberado');
      expect(movements.first.amount, 'S/ 125.50');
      expect(movements.first.status, 'Liberado');
      expect(movements[1].status, 'Pendiente');
      // CN-20260918-005 (Alcance 2): el mapeo interno mezclaba español e
      // inglés ('Liberado'/'Reversed'); ahora el valor interno es
      // consistentemente español ('Revertido'). Su único consumidor de UI
      // (`worker_pages.dart`, pantalla "Mis pagos") se eliminó en
      // CN-20260918-007 por ser código no enrutado; el repositorio conserva
      // el mapeo para cuando exista una pantalla de pagos enrutada.
      expect(movements.last.status, 'Revertido');
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

  // CN-20260922-013 (pendiente #1 de "turnos multi-cupo parcialmente
  // cubiertos"): la API ahora puede cerrar un turno multi-cupo `COMPLETED`
  // aunque solo uno de sus cupos haya completado (el otro terminó
  // `CANCELLED`). `completedShifts()` usaba `shift['status'] == 'COMPLETED'`
  // como señal alternativa de que ESTE trabajador completó su turno; con la
  // nueva semántica, eso mezcla el resultado agregado del turno con el
  // resultado de este trabajador en particular. Un trabajador cuya propia
  // asignación terminó `CANCELLED` no debe aparecer en su propio historial
  // de turnos completados solo porque otro cupo sí completó.
  test(
    "HTTP repository does not surface a shift in the worker's own history as "
    'completed when their own assignment was CANCELLED, even if the shift '
    'closed COMPLETED because a different seat finished it (partial '
    'multi-seat completion)',
    () async {
      final client = _JsonClient({
        '/api/workers/applications': [
          {
            'id': 'application-partial',
            'shiftId': 'shift-partial',
            'status': 'ACCEPTED',
            'createdAt': '2026-08-24T10:00:00Z',
            'updatedAt': '2026-08-24T12:00:00Z',
            'shift': {
              'id': 'shift-partial',
              'role': 'Turno multi-cupo',
              'businessName': 'Empresa de prueba',
              'dateLabel': 'Lun 24 ago · 10:00 – 12:00',
              'workerPayCents': 10000,
              'status': 'COMPLETED',
              'industry': 'EVENTS',
              'urgent': false,
              'location': 'Lima',
            },
            'assignment': {
              'id': 'assignment-partial',
              'status': 'CANCELLED',
              'checkInCredential': 'CUMPLE-TEST',
              'checkedOutAt': null,
            },
          },
        ],
      });
      final repository = HttpWorkerMarketplaceRepository(
        client: client,
        baseUri: Uri.parse('http://localhost:4000/api'),
      );

      final completed = await repository.completedShifts();

      expect(completed, isEmpty);
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

  test(
    'HTTP repository closes and stops reinjecting an accepted assignment '
    'whose shift already ended without a check-in',
    () async {
      final pastEndsAt = DateTime.now()
          .subtract(const Duration(hours: 2))
          .toIso8601String();
      final client = _JsonClient({
        '/api/workers/applications': [
          {
            'id': 'application-expired',
            'shiftId': 'shift-expired',
            'status': 'ACCEPTED',
            'createdAt': '2026-08-24T10:00:00Z',
            'updatedAt': '2026-08-24T12:00:00Z',
            'shift': {
              'id': 'shift-expired',
              'role': 'Turno vencido',
              'businessName': 'Empresa de prueba',
              'dateLabel': 'Lun 24 ago · 10:00 – 12:00',
              'workerPayCents': 10000,
              'status': 'ASSIGNED',
              'industry': 'EVENTS',
              'urgent': false,
              'location': 'Lima',
              'endsAt': pastEndsAt,
            },
            'assignment': {
              'id': 'assignment-expired',
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

      final states = await repository.applicationStates();
      final shifts = await repository.availableShifts();

      // Nunca transiciona automáticamente por tiempo del lado del servidor,
      // así que sin este chequeo el cliente seguiría ofreciendo indefinidamente
      // "Confirmar asistencia"/"Confirmar llegada" sobre un turno que ya
      // venció (ver CN-20260916-099 ALTO-1).
      expect(states['shift-expired'], ApplicationState.closed);
      expect(shifts, isEmpty);
    },
  );

  test(
    'HTTP repository keeps a checked-in assignment actionable past its endsAt',
    () async {
      final pastEndsAt = DateTime.now()
          .subtract(const Duration(hours: 2))
          .toIso8601String();
      final client = _JsonClient({
        '/api/workers/applications': [
          {
            'id': 'application-in-progress',
            'shiftId': 'shift-in-progress',
            'status': 'ACCEPTED',
            'createdAt': '2026-08-24T10:00:00Z',
            'updatedAt': '2026-08-24T12:00:00Z',
            'shift': {
              'id': 'shift-in-progress',
              'role': 'Turno en curso',
              'businessName': 'Empresa de prueba',
              'dateLabel': 'Lun 24 ago · 10:00 – 12:00',
              'workerPayCents': 10000,
              'status': 'CHECKED_IN',
              'industry': 'EVENTS',
              'urgent': false,
              'location': 'Lima',
              'endsAt': pastEndsAt,
            },
            'assignment': {
              'id': 'assignment-in-progress',
              'status': 'ASSIGNED',
              'checkInCredential': 'CUMPLE-TEST',
              'workerConfirmedAt': '2026-08-24T10:30:00Z',
              'checkedInAt': '2026-08-24T11:00:00Z',
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

      final states = await repository.applicationStates();
      final shifts = await repository.availableShifts();

      // `checkOut` no tiene ventana de tiempo propia: un trabajador que ya
      // hizo check-in debe poder seguir registrando su salida aunque el
      // turno ya haya llegado a su `endsAt` nominal.
      expect(states['shift-in-progress'], ApplicationState.accepted);
      expect(shifts.single.id, 'shift-in-progress');
      expect(shifts.single.checkedIn, isTrue);
    },
  );
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
              {
                'id': 'movement-3',
                'amountCents': 3000,
                'description': 'Turno con incidencia',
                'status': 'REVERSED',
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
