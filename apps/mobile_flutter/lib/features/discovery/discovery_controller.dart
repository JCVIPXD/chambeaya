import 'package:flutter/foundation.dart';

import '../marketplace/marketplace_data.dart';
import '../marketplace/marketplace_repository.dart';
import 'discovery_models.dart';

class DiscoveryController extends ChangeNotifier {
  DiscoveryController({
    required List<Shift> shifts,
    this.repository,
    Set<String> savedShiftIds = const {},
    Map<String, ApplicationState> applicationStates = const {},
    this.onApplicationChanged,
  }) : _shifts = List.unmodifiable(shifts),
       _state = DiscoveryState(
         selectedShiftId: shifts.isEmpty ? null : shifts.first.id,
         savedShiftIds: savedShiftIds,
         applicationStates: applicationStates,
       );

  final List<Shift> _shifts;
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
  void setDateScope(ShiftDateScope value) =>
      _setFilter(_filter(dateScope: value));
  void setSortOrder(ShiftSortOrder value) =>
      _setFilter(_filter(sortOrder: value));
  void clearFilters() => _setFilter(const ShiftSearchFilter());

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

  Future<void> applyToShift(String id) async {
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
      await repository?.applyToShift(id);
      onApplicationChanged?.call();
    } catch (_) {
      _replace(
        applicationStates: previous,
        errorMessage: 'No pudimos enviar la postulación. Inténtalo otra vez.',
      );
    }
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
    ShiftDateScope? dateScope,
    ShiftSortOrder? sortOrder,
  }) => ShiftSearchFilter(
    query: query ?? _state.filter.query,
    industry: replaceIndustry ? industry : _state.filter.industry,
    minimumPayCents: minimumPayCents ?? _state.filter.minimumPayCents,
    urgentOnly: urgentOnly ?? _state.filter.urgentOnly,
    recommendedOnly: recommendedOnly ?? _state.filter.recommendedOnly,
    location: replaceLocation ? location : _state.filter.location,
    dateScope: dateScope ?? _state.filter.dateScope,
    sortOrder: sortOrder ?? _state.filter.sortOrder,
  );

  void _setFilter(ShiftSearchFilter filter) => _replace(filter: filter);

  void _replace({
    ShiftSearchFilter? filter,
    String? selectedShiftId,
    Set<String>? savedShiftIds,
    Map<String, ApplicationState>? applicationStates,
    String? errorMessage,
  }) {
    _state = DiscoveryState(
      filter: filter ?? _state.filter,
      selectedShiftId: selectedShiftId ?? _state.selectedShiftId,
      savedShiftIds: savedShiftIds ?? _state.savedShiftIds,
      applicationStates: applicationStates ?? _state.applicationStates,
      errorMessage: errorMessage,
    );
    notifyListeners();
  }
}
