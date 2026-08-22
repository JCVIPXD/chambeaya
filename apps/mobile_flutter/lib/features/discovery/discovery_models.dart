import '../marketplace/marketplace_data.dart';

enum ApplicationState { notApplied, submitted, reviewing, accepted, closed }

class DiscoveryState {
  DiscoveryState({
    this.filter = const ShiftSearchFilter(),
    this.selectedShiftId,
    Set<String> savedShiftIds = const {},
    Map<String, ApplicationState> applicationStates = const {},
    this.errorMessage,
  }) : savedShiftIds = Set.unmodifiable(savedShiftIds),
       applicationStates = Map.unmodifiable(applicationStates);

  final ShiftSearchFilter filter;
  final String? selectedShiftId;
  final Set<String> savedShiftIds;
  final Map<String, ApplicationState> applicationStates;
  final String? errorMessage;
}
