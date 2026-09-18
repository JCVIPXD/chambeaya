import 'package:flutter/foundation.dart';

import '../marketplace/marketplace_data.dart';
import '../marketplace/marketplace_repository.dart';
import 'discovery_models.dart';

class DiscoveryController extends ChangeNotifier {
  DiscoveryController({
    required List<Shift> shifts,
    this.repository,
    ShiftSearchFilter initialFilter = const ShiftSearchFilter(),
    Set<String> savedShiftIds = const {},
    Map<String, ApplicationState> applicationStates = const {},
    this.onApplicationChanged,
  }) : _shifts = List.unmodifiable(shifts),
       _state = DiscoveryState(
         selectedShiftId: shifts.isEmpty ? null : shifts.first.id,
         filter: initialFilter,
         savedShiftIds: savedShiftIds,
         applicationStates: applicationStates,
       );

  List<Shift> _shifts;
  final WorkerMarketplaceRepository? repository;
  final VoidCallback? onApplicationChanged;
  DiscoveryState _state;

  DiscoveryState get state => _state;
  List<Shift> get shifts => _shifts;
  List<Shift> get filteredShifts => filterDemoShifts(_shifts, _state.filter);
  Shift? get selectedShift {
    final id = _state.selectedShiftId;
    if (id == null) return null;
    return _shifts.where((shift) => shift.id == id).firstOrNull;
  }

  void setQuery(String query) => _setFilter(_filter(query: query));
  void setUrgentOnly(bool value) => _setFilter(_filter(urgentOnly: value));
  void setRecommendedOnly(bool value) =>
      _setFilter(_filter(recommendedOnly: value));
  void setIndustry(ShiftIndustry? value) =>
      _setFilter(_filter(industry: value, replaceIndustry: true));
  void setMinimumPayCents(int value) =>
      _setFilter(_filter(minimumPayCents: value));
  void setLocation(String? value) =>
      _setFilter(_filter(location: value, replaceLocation: true));
  void setModality(String? value) =>
      _setFilter(_filter(modality: value, replaceModality: true));
  void setDateScope(ShiftDateScope value) =>
      _setFilter(_filter(dateScope: value));
  void setSortOrder(ShiftSortOrder value) =>
      _setFilter(_filter(sortOrder: value));
  void clearFilters() => _setFilter(const ShiftSearchFilter());

  void replaceShifts(List<Shift> shifts) {
    final next = List<Shift>.unmodifiable(shifts);
    final selectedId = _state.selectedShiftId;
    final nextSelectedId =
        selectedId != null && next.any((shift) => shift.id == selectedId)
        ? selectedId
        : next.firstOrNull?.id;
    _shifts = next;
    _replace(
      selectedShiftId: nextSelectedId,
      replaceSelectedShiftId: true,
      errorMessage: null,
    );
  }

  void replaceApplicationStates(Map<String, ApplicationState> states) {
    _replace(applicationStates: states);
  }

  void selectShift(String id) {
    if (!_shifts.any((shift) => shift.id == id)) return;
    _replace(selectedShiftId: id);
  }

  Future<void> toggleSaved(String id) async {
    if (!_shifts.any((shift) => shift.id == id)) return;
    final previous = Set<String>.from(_state.savedShiftIds);
    final updated = Set<String>.from(previous);
    updated.contains(id) ? updated.remove(id) : updated.add(id);
    _replace(savedShiftIds: updated);
    try {
      await repository?.toggleSavedShift(id);
    } catch (_) {
      _replace(
        savedShiftIds: previous,
        errorMessage: 'No pudimos guardar el empleo. Inténtalo otra vez.',
      );
    }
  }

  Future<void> applyToShift(
    String id, {
    Map<String, String> answers = const {},
  }) async {
    if (!_shifts.any((shift) => shift.id == id)) {
      _replace(errorMessage: 'El turno ya no está disponible.');
      return;
    }
    final previous = Map<String, ApplicationState>.from(
      _state.applicationStates,
    );
    final updated = Map<String, ApplicationState>.from(previous)
      ..[id] = ApplicationState.submitted;
    _replace(selectedShiftId: id, applicationStates: updated);
    try {
      await repository?.applyToShift(id, answers: answers);
      onApplicationChanged?.call();
    } catch (error) {
      // Un turno puede vencer (o llenarse) entre que el trabajador lo vio en
      // la lista y tocó "Postular ahora": el feed en vivo solo se refresca
      // por evento o cada cierto intervalo, nunca al instante. Si el
      // servidor confirma que el turno ya no existe/está disponible, no basta
      // con revertir el estado optimista a "no aplicado": eso dejaba la
      // tarjeta como si nada hubiera pasado, invitando a reintentar contra un
      // turno que el servidor siempre va a rechazar. En ese caso se retira la
      // tarjeta de la lista visible y se explica por qué; para cualquier
      // otro error (p. ej. de red) se conserva el comportamiento previo:
      // revertir y permitir reintentar.
      if (error is MarketplaceApiException && error.isShiftGone) {
        _removeUnavailableShift(id, previous);
      } else {
        _replace(
          applicationStates: previous,
          errorMessage:
              'No pudimos enviar la postulación. Inténtalo otra vez.',
        );
      }
    }
  }

  void _removeUnavailableShift(
    String id,
    Map<String, ApplicationState> previousApplicationStates,
  ) {
    final remainingShifts = _shifts
        .where((shift) => shift.id != id)
        .toList(growable: false);
    _shifts = List.unmodifiable(remainingShifts);
    final remainingStates = Map<String, ApplicationState>.from(
      previousApplicationStates,
    )..remove(id);
    final selectedId = _state.selectedShiftId;
    _replace(
      applicationStates: remainingStates,
      selectedShiftId: selectedId == id
          ? remainingShifts.firstOrNull?.id
          : selectedId,
      replaceSelectedShiftId: true,
      errorMessage:
          'Este turno ya no está disponible: venció o ya fue cubierto. Actualizamos la lista.',
    );
  }

  ShiftSearchFilter _filter({
    String? query,
    ShiftIndustry? industry,
    bool replaceIndustry = false,
    int? minimumPayCents,
    bool? urgentOnly,
    bool? recommendedOnly,
    String? location,
    bool replaceLocation = false,
    String? modality,
    bool replaceModality = false,
    ShiftDateScope? dateScope,
    ShiftSortOrder? sortOrder,
  }) => ShiftSearchFilter(
    query: query ?? _state.filter.query,
    industry: replaceIndustry ? industry : _state.filter.industry,
    minimumPayCents: minimumPayCents ?? _state.filter.minimumPayCents,
    urgentOnly: urgentOnly ?? _state.filter.urgentOnly,
    recommendedOnly: recommendedOnly ?? _state.filter.recommendedOnly,
    location: replaceLocation ? location : _state.filter.location,
    modality: replaceModality ? modality : _state.filter.modality,
    dateScope: dateScope ?? _state.filter.dateScope,
    sortOrder: sortOrder ?? _state.filter.sortOrder,
  );

  void _setFilter(ShiftSearchFilter filter) => _replace(filter: filter);

  void _replace({
    ShiftSearchFilter? filter,
    String? selectedShiftId,
    bool replaceSelectedShiftId = false,
    Set<String>? savedShiftIds,
    Map<String, ApplicationState>? applicationStates,
    String? errorMessage,
  }) {
    _state = DiscoveryState(
      filter: filter ?? _state.filter,
      selectedShiftId: replaceSelectedShiftId
          ? selectedShiftId
          : selectedShiftId ?? _state.selectedShiftId,
      savedShiftIds: savedShiftIds ?? _state.savedShiftIds,
      applicationStates: applicationStates ?? _state.applicationStates,
      errorMessage: errorMessage,
    );
    notifyListeners();
  }
}
