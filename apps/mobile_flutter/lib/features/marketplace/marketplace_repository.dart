import 'marketplace_data.dart';
import 'marketplace_data.dart' as data;
import '../discovery/discovery_models.dart';

abstract interface class WorkerMarketplaceRepository {
  bool get usesLiveFeed;
  Future<List<Shift>> availableShifts();
  Stream<List<Shift>> watchAvailableShifts();
  Future<Shift> acceptShift(String shiftId);
  Future<List<PaymentRecord>> walletMovements();
  Future<Set<String>> savedShiftIds();
  Future<void> toggleSavedShift(String shiftId);
  Future<Map<String, ApplicationState>> applicationStates();
  Future<void> applyToShift(String shiftId);
}

WorkerMarketplaceRepository createWorkerMarketplaceRepository({
  required bool useLocalApi,
}) {
  // The HTTP client is constructed by main.dart only when the user explicitly
  // opts in with USE_LOCAL_API=true. Demo is the safe default for every run.
  if (useLocalApi) {
    throw UnsupportedError(
      'Use HttpWorkerMarketplaceRepository in local API mode.',
    );
  }
  return DemoWorkerMarketplaceRepository();
}

class DemoWorkerMarketplaceRepository implements WorkerMarketplaceRepository {
  DemoWorkerMarketplaceRepository()
    : _shifts = List<Shift>.from(data.availableShifts);

  final List<Shift> _shifts;
  final Set<String> _savedShiftIds = {};
  final Map<String, ApplicationState> _applicationStates = {
    'shift-eventos-peru': ApplicationState.reviewing,
  };

  @override
  bool get usesLiveFeed => false;

  @override
  Future<List<Shift>> availableShifts() async => List.unmodifiable(_shifts);

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
  Future<List<PaymentRecord>> walletMovements() async => paymentHistory;

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
  Future<void> applyToShift(String shiftId) async {
    if (!_shifts.any((shift) => shift.id == shiftId)) {
      throw StateError('Turno no encontrado');
    }
    _applicationStates[shiftId] = ApplicationState.submitted;
  }
}
