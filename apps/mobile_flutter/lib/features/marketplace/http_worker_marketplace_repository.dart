import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/config/app_config.dart';
import 'marketplace_data.dart';
import 'marketplace_repository.dart';
import '../discovery/discovery_models.dart';

class HttpWorkerMarketplaceRepository implements WorkerMarketplaceRepository {
  HttpWorkerMarketplaceRepository({
    http.Client? client,
    Uri? baseUri,
    this.token,
  }) : _client = client ?? http.Client(),
       _baseUri = baseUri ?? Uri.parse(AppConfig.apiBaseUrl);

  final http.Client _client;
  final Uri _baseUri;
  final String? token;
  final Set<String> _localSavedShiftIds = {};
  final Map<String, ApplicationState> _localApplicationStates = {};
  final Map<String, Shift> _applicationShiftCache = {};

  static const _savedJobsKey = 'chambeaya.worker.saved_jobs';
  static const _availabilityKey = 'chambeaya.worker.availability';
  static const _requestTimeout = Duration(seconds: 8);

  @override
  bool get usesLiveFeed => true;

  @override
  Future<List<Shift>> availableShifts() async {
    final response = await _client
        .get(
          _baseUri.resolve('/api/shifts'),
          headers: _headers(),
        )
        .timeout(_requestTimeout);
    if (response.statusCode != 200) {
      throw StateError('No se pudieron cargar turnos');
    }
    final values = jsonDecode(response.body) as List<dynamic>;
    final shifts = values
        .map((value) => _shiftFromJson(value as Map<String, dynamic>))
        .toList();
    // An accepted assignment can remain visible in the public feed while the
    // shift is still looking for additional workers. Replace that public
    // copy with the cached application copy so assignment-only fields (such
    // as the check-in credential and confirmation state) are not lost.
    for (final cached in _applicationShiftCache.values) {
      // Defense in depth: `applicationStates()` is the primary place that
      // prunes an expired-and-not-checked-in assignment from this cache (see
      // its `closed` computation), but this method can be called on its own
      // (e.g. from the discovery feed). Never let a stale cached copy
      // reintroduce a shift the server no longer considers available: once a
      // worker checked in, `checkOut` has no time limit of its own, so that
      // case must keep being reinjected regardless of `endsAt`.
      if (!cached.checkedIn && cached.isExpired) continue;
      final index = shifts.indexWhere((shift) => shift.id == cached.id);
      if (index >= 0) {
        shifts[index] = cached;
      } else {
        shifts.add(cached);
      }
    }
    return shifts;
  }

  @override
  Future<bool> workerAvailability() async {
    try {
      final response = await _client
          .get(
            _baseUri.resolve('/api/workers/availability'),
            headers: _headers(),
          )
          .timeout(_requestTimeout);
      if (response.statusCode == 200) {
        final value =
            (jsonDecode(response.body) as Map<String, dynamic>)['isAvailable'];
        if (value is bool) return value;
      }
    } catch (_) {
      // Fall back to the last local value while the API is unavailable.
    }
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_availabilityKey) ?? true;
  }

  @override
  Future<void> updateAvailability(bool isAvailable) async {
    final response = await _client.put(
      _baseUri.resolve('/api/workers/availability'),
      headers: {..._headers(), 'Content-Type': 'application/json'},
      body: jsonEncode({'isAvailable': isAvailable}),
    );
    if (response.statusCode != 200)
      throw StateError('No se pudo actualizar tu disponibilidad');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_availabilityKey, isAvailable);
  }

  @override
  Future<Shift?> activeShift() async {
    final response = await _client.get(
      _baseUri.resolve('/api/shifts/active'),
      headers: _headers(),
    );
    if (response.statusCode != 200)
      throw StateError('No se pudo cargar tu turno activo');
    final value = jsonDecode(response.body);
    return value is Map<String, dynamic> ? _shiftFromJson(value) : null;
  }

  @override
  Future<List<Shift>> completedShifts() async {
    final response = await _client.get(
      _baseUri.resolve('/api/workers/applications'),
      headers: _headers(),
    );
    if (response.statusCode != 200) {
      throw StateError('No se pudo cargar tu historial');
    }
    final values = jsonDecode(response.body) as List<dynamic>;
    final completed = <Shift>[];
    for (final value in values) {
      final item = Map<String, dynamic>.from(value as Map);
      if (item['status'] != 'ACCEPTED') continue;
      final rawShift = item['shift'];
      if (rawShift is! Map) continue;
      final shift = Map<String, dynamic>.from(rawShift);
      final rawAssignment = item['assignment'];
      final assignment = rawAssignment is Map
          ? Map<String, dynamic>.from(rawAssignment)
          : null;
      final assignmentStatus = assignment?['status'] as String?;
      final isCompleted =
          shift['status'] == 'COMPLETED' ||
          assignmentStatus == 'COMPLETED' ||
          assignment?['checkedOutAt'] != null;
      if (!isCompleted) continue;

      var parsed = _shiftFromJson(shift);
      parsed = parsed.copyWith(
        state: ShiftState.completed,
        assignmentConfirmed: assignment?['workerConfirmedAt'] != null,
        checkedIn: assignment?['checkedInAt'] != null,
        checkedOut: true,
        checkInCredential: assignment?['checkInCredential'] as String?,
      );
      completed.add(parsed);
    }
    return List.unmodifiable(completed);
  }

  @override
  Stream<List<Shift>> watchAvailableShifts() async* {
    String? lastSnapshot;
    while (true) {
      try {
        final request = http.Request(
          'GET',
          _baseUri.resolve('/api/shifts/events'),
        )..headers['Accept'] = 'text/event-stream';
        request.headers.addAll(_headers());
        final response = await _client.send(request);
        if (response.statusCode != 200) {
          throw StateError('No se pudo abrir el feed de turnos');
        }

        var buffer = '';
        await for (final chunk in response.stream.transform(utf8.decoder)) {
          buffer += chunk.replaceAll('\r\n', '\n');
          var boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            final event = buffer.substring(0, boundary);
            buffer = buffer.substring(boundary + 2);
            final data = event
                .split('\n')
                .where((line) => line.startsWith('data:'))
                .map((line) => line.substring(5).trimLeft())
                .join('\n');
            if (data.isNotEmpty) {
              final values = jsonDecode(data);
              if (values is List<dynamic>) {
                final shifts = values
                    .map(
                      (value) => _shiftFromJson(
                        Map<String, dynamic>.from(value as Map),
                      ),
                    )
                    .toList();
                final signature = _snapshotSignature(shifts);
                if (signature != lastSnapshot) {
                  lastSnapshot = signature;
                  yield shifts;
                }
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (_) {
        try {
          final shifts = await availableShifts();
          final signature = _snapshotSignature(shifts);
          if (signature != lastSnapshot) {
            lastSnapshot = signature;
            yield shifts;
          }
        } catch (_) {
          // La siguiente reconexión recuperará el feed cuando vuelva la API.
        }
      }
      await Future<void>.delayed(const Duration(seconds: 2));
    }
  }

  @override
  Future<Shift> acceptShift(String shiftId) async {
    final response = await _client.post(
      _baseUri.resolve('/api/shifts/$shiftId/applications'),
      headers: _headers(),
    );
    if (response.statusCode != 201 && response.statusCode != 200) {
      throw StateError('El turno ya no está disponible');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    _localApplicationStates[shiftId] = ApplicationState.submitted;
    return _shiftFromJson(Map<String, dynamic>.from(body['shift'] as Map));
  }

  @override
  Future<List<PaymentRecord>> walletMovements() async {
    final response = await _client.get(
      _baseUri.resolve('/api/workers/wallet'),
      headers: _headers(),
    );
    if (response.statusCode != 200) {
      throw StateError('No se pudo cargar la billetera');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final movements = body['movements'] as List<dynamic>;
    return movements.map((value) {
      final movement = value as Map<String, dynamic>;
      final amount = (movement['amountCents'] as num).toInt() / 100;
      return PaymentRecord(
        id: movement['id'] as String?,
        company: movement['description'] as String,
        role: 'Pago de turno',
        amount: 'S/ ${amount.toStringAsFixed(2)}',
        status: movement['status'] == 'RELEASED'
            ? 'Liberado'
            : movement['status'] == 'REVERSED'
            ? 'Revertido'
            : 'Pendiente',
        reference: movement['reference'] as String?,
        receiptConfirmed: movement['receiptConfirmed'] == true,
      );
    }).toList();
  }

  @override
  Future<void> confirmPayment(String paymentId) async {
    final response = await _client.post(
      _baseUri.resolve('/api/workers/payments/$paymentId/confirm'),
      headers: _headers(),
    );
    if (response.statusCode != 200) {
      throw StateError('No pudimos confirmar la recepción del pago');
    }
  }

  @override
  Future<Set<String>> savedShiftIds() async {
    final prefs = await SharedPreferences.getInstance();
    _localSavedShiftIds
      ..clear()
      ..addAll(prefs.getStringList(_savedJobsKey) ?? const []);
    return Set.unmodifiable(_localSavedShiftIds);
  }

  @override
  Future<void> toggleSavedShift(String shiftId) async {
    _localSavedShiftIds.contains(shiftId)
        ? _localSavedShiftIds.remove(shiftId)
        : _localSavedShiftIds.add(shiftId);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_savedJobsKey, _localSavedShiftIds.toList());
  }

  @override
  Future<Map<String, ApplicationState>> applicationStates() async {
    try {
      final response = await _client
          .get(
            _baseUri.resolve('/api/workers/applications'),
            headers: _headers(),
          )
          .timeout(_requestTimeout);
      if (response.statusCode == 200) {
        final values = jsonDecode(response.body) as List<dynamic>;
        final remote = <String, ApplicationState>{};
        for (final value in values) {
          final item = value as Map<String, dynamic>;
          final status = item['status'];
          final shiftId = item['shiftId'] as String;
          final shift = item['shift'];
          final shiftStatus = shift is Map ? shift['status'] as String? : null;
          final assignment = item['assignment'];
          final assignmentStatus = assignment is Map
              ? assignment['status'] as String?
              : null;
          final checkedInAt = assignment is Map
              ? assignment['checkedInAt']
              : null;
          final shiftEndsAt = shift is Map
              ? DateTime.tryParse(shift['endsAt'] as String? ?? '')
              : null;
          // No existe transición automática por tiempo: una asignación
          // ACCEPTED cuyo turno venció sin que el trabajador llegara a hacer
          // check-in se queda en `status: 'ASSIGNED'` para siempre del lado
          // del servidor. Sin este chequeo, la pantalla la sigue mostrando
          // como accionable ("Confirmar asistencia"/"Confirmar llegada")
          // indefinidamente, aunque ambas acciones siempre fallan contra el
          // servidor (`endsAt` ya pasó) — ver CN-20260916-099 ALTO-1. Una vez
          // que el trabajador ya hizo check-in, `checkOut` no tiene límite de
          // tiempo propio, así que esa asignación debe seguir accionable más
          // allá de `endsAt`.
          final expiredBeforeCheckIn =
              checkedInAt == null &&
              shiftEndsAt != null &&
              !shiftEndsAt.isAfter(DateTime.now());
          // `NO_SHOW`/`ABANDONED` (ver `shift-state.ts` en la API) son estados
          // de asignación que el servidor resuelve "al tocar" la asignación,
          // nunca disparados por este cliente: una vez alcanzados, el
          // servidor rechaza `confirm`/`check-in`/`check-out` con 409, así
          // que deben tratarse como cerrados igual que `COMPLETED`/`CANCELLED`
          // para no seguir ofreciendo una acción que siempre va a fallar.
          final closed =
              const {'COMPLETED', 'CANCELLED'}.contains(shiftStatus) ||
              const {
                'COMPLETED',
                'CANCELLED',
                'NO_SHOW',
                'ABANDONED',
              }.contains(assignmentStatus) ||
              expiredBeforeCheckIn;
          remote[shiftId] = switch (status) {
            'ACCEPTED' =>
              closed ? ApplicationState.closed : ApplicationState.accepted,
            'REJECTED' || 'CANCELLED' => ApplicationState.closed,
            _ => ApplicationState.submitted,
          };
          if (shift is Map) {
            var parsed = _shiftFromJson(Map<String, dynamic>.from(shift));
            if (assignment is Map &&
                assignment['checkInCredential'] is String) {
              parsed = parsed.copyWith(
                checkInCredential: assignment['checkInCredential'] as String,
                assignmentConfirmed: assignment['workerConfirmedAt'] != null,
                checkedIn: assignment['checkedInAt'] != null,
                checkedOut:
                    assignment['checkedOutAt'] != null ||
                    assignmentStatus == 'COMPLETED',
              );
            }
            if (closed) {
              // Closed assignments belong to history, never to the active
              // marketplace feed or actionable application cards.
              _applicationShiftCache.remove(shiftId);
            } else {
              _applicationShiftCache[shiftId] =
                  remote[shiftId] == ApplicationState.accepted
                  ? parsed.copyWith(state: ShiftState.assigned)
                  : parsed;
            }
          }
        }
        _localApplicationStates
          ..clear()
          ..addAll(remote);
        _applicationShiftCache.removeWhere(
          (shiftId, _) => !remote.containsKey(shiftId),
        );
      }
    } catch (_) {
      // Keep the last known local state while the API reconnects.
    }
    return Map.unmodifiable(_localApplicationStates);
  }

  @override
  Future<void> applyToShift(
    String shiftId, {
    Map<String, String> answers = const {},
  }) async {
    final response = await _client.post(
      _baseUri.resolve('/api/shifts/$shiftId/applications'),
      headers: {..._headers(), 'Content-Type': 'application/json'},
      body: jsonEncode({
        'answers': answers.entries
            .map(
              (entry) => {'question': entry.key, 'answer': entry.value.trim()},
            )
            .toList(),
      }),
    );
    if (response.statusCode != 201 && response.statusCode != 200) {
      throw MarketplaceApiException(_errorCodeFrom(response.body));
    }
    _localApplicationStates[shiftId] = ApplicationState.submitted;
  }

  @override
  Future<void> confirmAssignment(String shiftId) async {
    final response = await _client.post(
      _baseUri.resolve('/api/shifts/$shiftId/confirm'),
      headers: _headers(),
    );
    if (response.statusCode != 200) {
      // Un turno vencido, cancelado o inexistente responde 404
      // ASSIGNMENT_NOT_FOUND aquí: conservar el código real (en vez de un
      // StateError genérico) es lo que permite a la pantalla explicar el
      // motivo en vez de ofrecer un botón que siempre va a fallar.
      throw MarketplaceApiException(_errorCodeFrom(response.body));
    }
  }

  @override
  Future<void> checkIn(String shiftId, String credential) async {
    final response = await _client.post(
      _baseUri.resolve('/api/shifts/$shiftId/check-in'),
      headers: {..._headers(), 'Content-Type': 'application/json'},
      body: jsonEncode({'credential': credential}),
    );
    if (response.statusCode != 200) {
      throw MarketplaceApiException(_errorCodeFrom(response.body));
    }
  }

  @override
  Future<void> checkOut(String shiftId) async {
    final response = await _client.post(
      _baseUri.resolve('/api/shifts/$shiftId/check-out'),
      headers: _headers(),
    );
    if (response.statusCode != 200) {
      throw MarketplaceApiException(_errorCodeFrom(response.body));
    }
  }

  @override
  Future<void> cancelApplication(String shiftId, String reason) async {
    final response = await _client.post(
      _baseUri.resolve('/api/shifts/$shiftId/cancel'),
      headers: {..._headers(), 'Content-Type': 'application/json'},
      body: jsonEncode({'reason': reason}),
    );
    if (response.statusCode != 200) {
      throw StateError('No pudimos cancelar la postulación');
    }
    _localApplicationStates[shiftId] = ApplicationState.closed;
  }

  @override
  Future<List<WorkerConversationRecord>> workerConversations() async {
    final response = await _client.get(
      _baseUri.resolve('/api/workers/conversations'),
      headers: _headers(),
    );
    if (response.statusCode != 200) {
      throw StateError('No se pudieron cargar los mensajes');
    }
    final values = jsonDecode(response.body) as List<dynamic>;
    return values
        .map(
          (value) => _conversationFromJson(
            Map<String, dynamic>.from(value as Map),
            summary: true,
          ),
        )
        .toList();
  }

  @override
  Future<WorkerConversationRecord> workerConversation(
    String conversationId,
  ) async {
    final response = await _client.get(
      _baseUri.resolve('/api/workers/conversations/$conversationId'),
      headers: _headers(),
    );
    if (response.statusCode != 200) {
      throw StateError('No se pudo abrir la conversación');
    }
    return _conversationFromJson(
      Map<String, dynamic>.from(jsonDecode(response.body) as Map),
    );
  }

  @override
  Future<WorkerMessageRecord> sendWorkerMessage(
    String conversationId,
    String body,
  ) async {
    final response = await _client.post(
      _baseUri.resolve('/api/workers/conversations/$conversationId/messages'),
      headers: {..._headers(), 'Content-Type': 'application/json'},
      body: jsonEncode({'body': body.trim()}),
    );
    if (response.statusCode != 201) {
      throw StateError('No se pudo enviar el mensaje');
    }
    return _messageFromJson(
      Map<String, dynamic>.from(jsonDecode(response.body) as Map),
    );
  }

  Map<String, String> _headers() => {
    if (token case final value? when value.isNotEmpty)
      'Authorization': 'Bearer $value',
  };

  /// Extrae el código de error (`{"error": "SHIFT_UNAVAILABLE"}`) del cuerpo
  /// de una respuesta fallida. Si el cuerpo no es JSON o no trae ese campo,
  /// se conserva un código genérico en vez de fallar al parsear.
  String _errorCodeFrom(String body) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map && decoded['error'] is String) {
        return decoded['error'] as String;
      }
    } catch (_) {
      // El cuerpo no es JSON válido; se usa el código genérico de abajo.
    }
    return 'UNKNOWN_ERROR';
  }

  WorkerConversationRecord _conversationFromJson(
    Map<String, dynamic> json, {
    bool summary = false,
  }) {
    final company = Map<String, dynamic>.from(
      (json['company'] as Map?) ?? const {},
    );
    final shift = json['shift'] is Map
        ? Map<String, dynamic>.from(json['shift'] as Map)
        : null;
    final rawMessages = (json['messages'] as List<dynamic>? ?? const []);
    return WorkerConversationRecord(
      id: json['id'] as String,
      company: (company['name'] as String?) ?? 'Empresa',
      subject: json['subject'] as String? ?? 'Conversación',
      updatedAt:
          DateTime.tryParse(json['updatedAt'] as String? ?? '') ??
          DateTime.now(),
      shiftId: shift?['id'] as String?,
      shiftTitle: shift?['title'] as String?,
      messages: summary
          ? rawMessages
                .take(1)
                .map(
                  (value) =>
                      _messageFromJson(Map<String, dynamic>.from(value as Map)),
                )
                .toList()
          : rawMessages
                .map(
                  (value) =>
                      _messageFromJson(Map<String, dynamic>.from(value as Map)),
                )
                .toList(),
    );
  }

  WorkerMessageRecord _messageFromJson(Map<String, dynamic> json) =>
      WorkerMessageRecord(
        id: json['id'] as String,
        sender: json['sender'] as String? ?? 'BUSINESS',
        body: json['body'] as String? ?? '',
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.now(),
        readAt: DateTime.tryParse(json['readAt'] as String? ?? ''),
      );

  Shift _shiftFromJson(Map<String, dynamic> json) {
    return Shift(
      id: json['id'] as String,
      title: json['role'] as String,
      company: json['businessName'] as String,
      schedule: json['dateLabel'] as String,
      workerPayCents: (json['workerPayCents'] as num).toInt(),
      match: (json['matchScore'] as num?)?.toInt(),
      urgent: json['urgent'] == true,
      industry: _industryFromApi(json['industry'] as String?),
      location: json['location'] as String,
      dateScope: ShiftDateScope.any,
      state: switch (json['status']) {
        'ASSIGNED' => ShiftState.assigned,
        'CHECKED_IN' => ShiftState.checkedIn,
        'COMPLETED' || 'CANCELLED' => ShiftState.completed,
        _ => ShiftState.published,
      },
      checkInCredential: json['checkInCredential'] as String?,
      description: json['description'] as String?,
      responsibilities: json['responsibilities'] as String?,
      requirements: json['requirements'] as String?,
      screeningQuestions:
          (json['screeningQuestions'] as List<dynamic>?)
              ?.whereType<String>()
              .toList() ??
          const [],
      modality: json['modality'] as String? ?? 'PRESENCIAL',
      companyVerified: json['companyVerified'] == true,
      paymentProtected: json['paymentProtected'] == true,
      endsAt: DateTime.tryParse(json['endsAt'] as String? ?? ''),
    );
  }

  ShiftIndustry _industryFromApi(String? value) => switch (value) {
    'HOSPITALITY' => ShiftIndustry.hospitality,
    'FOOD_SERVICE' => ShiftIndustry.foodService,
    'RETAIL' => ShiftIndustry.retail,
    _ => ShiftIndustry.events,
  };

  String _snapshotSignature(List<Shift> shifts) => shifts
      .map(
        (shift) => [
          shift.id,
          shift.title,
          shift.company,
          shift.schedule,
          shift.workerPayCents,
          shift.match,
          shift.urgent,
          shift.location,
          shift.modality,
          shift.screeningQuestions.join('~'),
          shift.state,
        ].join(':'),
      )
      .join('|');
}
