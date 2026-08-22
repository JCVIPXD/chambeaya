import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';
import 'marketplace_data.dart';
import 'marketplace_repository.dart';
import '../discovery/discovery_models.dart';

class HttpWorkerMarketplaceRepository implements WorkerMarketplaceRepository {
  HttpWorkerMarketplaceRepository({http.Client? client, Uri? baseUri})
    : _client = client ?? http.Client(),
      _baseUri = baseUri ?? Uri.parse(AppConfig.apiBaseUrl);

  final http.Client _client;
  final Uri _baseUri;
  final Set<String> _localSavedShiftIds = {};
  final Map<String, ApplicationState> _localApplicationStates = {};

  @override
  Future<List<Shift>> availableShifts() async {
    final response = await _client.get(_baseUri.resolve('/api/shifts'));
    if (response.statusCode != 200) {
      throw StateError('No se pudieron cargar turnos');
    }
    final values = jsonDecode(response.body) as List<dynamic>;
    return values
        .map((value) => _shiftFromJson(value as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<Shift> acceptShift(String shiftId) async {
    final response = await _client.put(
      _baseUri.resolve('/api/shifts/$shiftId/accept'),
    );
    if (response.statusCode != 200) {
      throw StateError('El turno ya no está disponible');
    }
    return _shiftFromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  @override
  Future<List<PaymentRecord>> walletMovements() async {
    final response = await _client.get(_baseUri.resolve('/api/workers/wallet'));
    if (response.statusCode != 200) {
      throw StateError('No se pudo cargar la billetera');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final movements = body['movements'] as List<dynamic>;
    return movements.map((value) {
      final movement = value as Map<String, dynamic>;
      final amount = (movement['amountCents'] as num).toInt() / 100;
      return PaymentRecord(
        company: movement['description'] as String,
        role: 'Pago de turno',
        amount: 'S/ ${amount.toStringAsFixed(2)}',
        status: movement['status'] == 'RELEASED' ? 'Liberado' : 'Pendiente',
      );
    }).toList();
  }

  @override
  Future<Set<String>> savedShiftIds() async =>
      Set.unmodifiable(_localSavedShiftIds);

  @override
  Future<void> toggleSavedShift(String shiftId) async {
    _localSavedShiftIds.contains(shiftId)
        ? _localSavedShiftIds.remove(shiftId)
        : _localSavedShiftIds.add(shiftId);
  }

  @override
  Future<Map<String, ApplicationState>> applicationStates() async =>
      Map.unmodifiable(_localApplicationStates);

  @override
  Future<void> applyToShift(String shiftId) async {
    _localApplicationStates[shiftId] = ApplicationState.submitted;
  }

  Shift _shiftFromJson(Map<String, dynamic> json) {
    return Shift(
      id: json['id'] as String,
      title: json['role'] as String,
      company: json['businessName'] as String,
      schedule: json['dateLabel'] as String,
      workerPayCents: (json['workerPayCents'] as num).toInt(),
      match: 90,
      urgent: json['urgent'] == true,
      industry: _industryFromApi(json['industry'] as String?),
      location: json['location'] as String,
      dateScope: ShiftDateScope.any,
      state: json['status'] == 'ASSIGNED'
          ? ShiftState.assigned
          : ShiftState.published,
      checkInCredential: json['checkInCredential'] as String?,
    );
  }

  ShiftIndustry _industryFromApi(String? value) => switch (value) {
    'HOSPITALITY' => ShiftIndustry.hospitality,
    'FOOD_SERVICE' => ShiftIndustry.foodService,
    'RETAIL' => ShiftIndustry.retail,
    _ => ShiftIndustry.events,
  };
}
