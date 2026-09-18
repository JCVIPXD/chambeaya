import 'marketplace_data.dart';
import 'marketplace_data.dart' as data;
import '../discovery/discovery_models.dart';

/// Error tipado que conserva el código de error devuelto por la API
/// (`{"error": "SHIFT_UNAVAILABLE"}`, etc.) en vez de perderlo detrás de un
/// [StateError] genérico. Sin esto, un turno que venció o ya fue cubierto
/// entre que el trabajador lo vio en la lista y tocó "Postular ahora" era
/// indistinguible de cualquier otro fallo de red: la pantalla de
/// descubrimiento no podía retirar la tarjeta obsoleta ni explicar por qué
/// la postulación falló, así que ofrecía indefinidamente un botón que el
/// servidor siempre iba a rechazar.
class MarketplaceApiException implements Exception {
  const MarketplaceApiException(this.code, [this.message]);

  final String code;
  final String? message;

  bool get isShiftGone =>
      code == 'SHIFT_UNAVAILABLE' ||
      code == 'SHIFT_NOT_FOUND' ||
      // `confirmAssignment`/`checkIn`/`checkOut` report a vencido/cancelado/
      // inexistente turno con este código (404), no con SHIFT_UNAVAILABLE.
      code == 'ASSIGNMENT_NOT_FOUND';

  @override
  String toString() => message ?? code;
}

class WorkerMessageRecord {
  const WorkerMessageRecord({
    required this.id,
    required this.sender,
    required this.body,
    required this.createdAt,
    this.readAt,
  });
  final String id;
  final String sender;
  final String body;
  final DateTime createdAt;
  final DateTime? readAt;
}

class WorkerConversationRecord {
  const WorkerConversationRecord({
    required this.id,
    required this.company,
    required this.subject,
    required this.updatedAt,
    required this.messages,
    this.shiftTitle,
    this.shiftId,
  });
  final String id;
  final String company;
  final String subject;
  final DateTime updatedAt;
  final List<WorkerMessageRecord> messages;
  final String? shiftTitle;
  final String? shiftId;
}

abstract interface class WorkerMarketplaceRepository {
  bool get usesLiveFeed;
  Future<List<Shift>> availableShifts();
  Stream<List<Shift>> watchAvailableShifts();
  Future<bool> workerAvailability();
  Future<void> updateAvailability(bool isAvailable);
  Future<Shift?> activeShift();
  Future<Shift> acceptShift(String shiftId);
  Future<List<Shift>> completedShifts();
  Future<List<PaymentRecord>> walletMovements();
  Future<void> confirmPayment(String paymentId);
  Future<Set<String>> savedShiftIds();
  Future<void> toggleSavedShift(String shiftId);
  Future<Map<String, ApplicationState>> applicationStates();
  Future<void> applyToShift(
    String shiftId, {
    Map<String, String> answers = const {},
  });
  Future<void> confirmAssignment(String shiftId);
  Future<void> checkIn(String shiftId, String credential);
  Future<void> checkOut(String shiftId);
  Future<void> cancelApplication(String shiftId, String reason);
  Future<List<WorkerConversationRecord>> workerConversations();
  Future<WorkerConversationRecord> workerConversation(String conversationId);
  Future<WorkerMessageRecord> sendWorkerMessage(
    String conversationId,
    String body,
  );
}

WorkerMarketplaceRepository createWorkerMarketplaceRepository({
  required bool demoMode,
}) {
  // HTTP repositories require an authenticated token and are constructed by
  // main.dart. This factory intentionally exposes only the explicit demo path.
  if (!demoMode) {
    throw UnsupportedError(
      'Use HttpWorkerMarketplaceRepository for the authenticated API flow.',
    );
  }
  return DemoWorkerMarketplaceRepository();
}

class DemoWorkerMarketplaceRepository implements WorkerMarketplaceRepository {
  DemoWorkerMarketplaceRepository()
    : _shifts = List<Shift>.from(data.availableShifts);

  final List<Shift> _shifts;
  final Set<String> _savedShiftIds = {};
  var _isAvailable = true;
  final Map<String, ApplicationState> _applicationStates = {
    'shift-eventos-peru': ApplicationState.reviewing,
  };

  @override
  bool get usesLiveFeed => false;

  @override
  Future<List<Shift>> availableShifts() async => List.unmodifiable(_shifts);

  @override
  Future<bool> workerAvailability() async => _isAvailable;

  @override
  Future<Shift?> activeShift() async => _shifts
      .where(
        (shift) =>
            shift.state == ShiftState.assigned ||
            shift.state == ShiftState.checkedIn,
      )
      .firstOrNull;

  @override
  Future<void> updateAvailability(bool isAvailable) async {
    _isAvailable = isAvailable;
  }

  @override
  Stream<List<Shift>> watchAvailableShifts() async* {
    yield List.unmodifiable(_shifts);
  }

  @override
  Future<Shift> acceptShift(String shiftId) async {
    final index = _shifts.indexWhere((shift) => shift.id == shiftId);
    if (index == -1) {
      throw StateError('Turno no encontrado');
    }

    final shift = _shifts[index];
    if (shift.state != ShiftState.published) {
      throw StateError('El turno ya no está disponible');
    }

    final accepted = shift.copyWith(
      state: ShiftState.assigned,
      checkInCredential: 'DEMO-CUMPLE-${shift.id.toUpperCase()}',
    );
    _shifts[index] = accepted;
    return accepted;
  }

  @override
  Future<List<Shift>> completedShifts() async => _shifts
      .where((shift) => shift.state == ShiftState.completed || shift.checkedOut)
      .toList(growable: false);

  @override
  Future<List<PaymentRecord>> walletMovements() async => paymentHistory;

  @override
  Future<void> confirmPayment(String paymentId) async {
    throw StateError('Este pago de demostración no requiere confirmación');
  }

  @override
  Future<Set<String>> savedShiftIds() async => Set.unmodifiable(_savedShiftIds);

  @override
  Future<void> toggleSavedShift(String shiftId) async {
    if (!_shifts.any((shift) => shift.id == shiftId)) {
      throw StateError('Turno no encontrado');
    }
    _savedShiftIds.contains(shiftId)
        ? _savedShiftIds.remove(shiftId)
        : _savedShiftIds.add(shiftId);
  }

  @override
  Future<Map<String, ApplicationState>> applicationStates() async =>
      Map.unmodifiable(_applicationStates);

  @override
  Future<void> applyToShift(
    String shiftId, {
    Map<String, String> answers = const {},
  }) async {
    if (!_shifts.any((shift) => shift.id == shiftId)) {
      throw StateError('Turno no encontrado');
    }
    final shift = _shifts.firstWhere((candidate) => candidate.id == shiftId);
    if (shift.screeningQuestions.any(
      (question) => answers[question]?.trim().isEmpty ?? true,
    )) {
      throw StateError('Responde las preguntas de filtro');
    }
    _applicationStates[shiftId] = ApplicationState.submitted;
  }

  @override
  Future<void> confirmAssignment(String shiftId) async {
    final index = _shifts.indexWhere(
      (shift) => shift.id == shiftId && shift.state == ShiftState.assigned,
    );
    if (index == -1) {
      throw StateError('No tienes una asignación para confirmar');
    }
    _shifts[index] = _shifts[index].copyWith(assignmentConfirmed: true);
  }

  @override
  Future<void> checkIn(String shiftId, String credential) async {
    final shift = _shifts
        .where((candidate) => candidate.id == shiftId)
        .firstOrNull;
    if (shift == null ||
        !shift.assignmentConfirmed ||
        shift.checkInCredential != credential) {
      throw StateError('Credencial de check-in inválida');
    }
    final index = _shifts.indexWhere((candidate) => candidate.id == shiftId);
    _shifts[index] = shift.copyWith(
      state: ShiftState.checkedIn,
      checkedIn: true,
    );
  }

  @override
  Future<void> checkOut(String shiftId) async {
    final shift = _shifts
        .where((candidate) => candidate.id == shiftId)
        .firstOrNull;
    if (shift == null || shift.state != ShiftState.checkedIn) {
      throw StateError('No tienes un turno activo');
    }
    final index = _shifts.indexWhere((candidate) => candidate.id == shiftId);
    _shifts[index] = shift.copyWith(
      state: ShiftState.completed,
      checkedOut: true,
    );
  }

  @override
  Future<void> cancelApplication(String shiftId, String reason) async {
    if (reason.trim().length < 3) throw StateError('Indica un motivo');
    _applicationStates[shiftId] = ApplicationState.closed;
  }

  @override
  Future<List<WorkerConversationRecord>> workerConversations() async => [
    WorkerConversationRecord(
      id: 'demo-conversation-la-mar',
      company: 'Restaurante La Mar',
      subject: 'Postulación · Mozo de Salón',
      updatedAt: DateTime.now(),
      shiftId: 'shift-la-mar',
      shiftTitle: 'Mozo de Salón',
      messages: [
        WorkerMessageRecord(
          id: 'demo-message-la-mar',
          sender: 'BUSINESS',
          body: 'Gracias por postular. Revisaremos tu perfil hoy.',
          createdAt: DateTime.now(),
        ),
      ],
    ),
  ];

  @override
  Future<WorkerConversationRecord> workerConversation(
    String conversationId,
  ) async {
    final conversations = await workerConversations();
    return conversations.firstWhere(
      (conversation) => conversation.id == conversationId,
    );
  }

  @override
  Future<WorkerMessageRecord> sendWorkerMessage(
    String conversationId,
    String body,
  ) async => WorkerMessageRecord(
    id: 'demo-message-${DateTime.now().microsecondsSinceEpoch}',
    sender: 'WORKER',
    body: body,
    createdAt: DateTime.now(),
  );
}
