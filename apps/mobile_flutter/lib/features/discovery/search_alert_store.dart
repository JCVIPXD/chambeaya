import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../marketplace/marketplace_data.dart';

abstract interface class SearchAlertStore {
  Future<ShiftSearchFilter?> read();
  Future<void> save(ShiftSearchFilter filter);
  Future<void> clear();
}

class InMemorySearchAlertStore implements SearchAlertStore {
  InMemorySearchAlertStore();
  ShiftSearchFilter? _filter;

  @override
  Future<ShiftSearchFilter?> read() async => _filter;

  @override
  Future<void> save(ShiftSearchFilter filter) async => _filter = filter;

  @override
  Future<void> clear() async => _filter = null;
}

class SharedPreferencesSearchAlertStore implements SearchAlertStore {
  static const _key = 'chambeaya.worker.search_alert';

  @override
  Future<ShiftSearchFilter?> read() async {
    final preferences = await SharedPreferences.getInstance();
    final raw = preferences.getString(_key);
    if (raw == null || raw.isEmpty) return null;
    try {
      return _fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      await clear();
      return null;
    }
  }

  @override
  Future<void> save(ShiftSearchFilter filter) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_key, jsonEncode(_toJson(filter)));
  }

  @override
  Future<void> clear() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove(_key);
  }

  Map<String, dynamic> _toJson(ShiftSearchFilter filter) => {
    'query': filter.query,
    'industry': filter.industry?.name,
    'minimumPayCents': filter.minimumPayCents,
    'urgentOnly': filter.urgentOnly,
    'recommendedOnly': filter.recommendedOnly,
    'location': filter.location,
    'modality': filter.modality,
    'dateScope': filter.dateScope.name,
    'sortOrder': filter.sortOrder.name,
  };

  ShiftSearchFilter _fromJson(Map<String, dynamic> json) => ShiftSearchFilter(
    query: json['query'] as String? ?? '',
    industry: _industry(json['industry'] as String?),
    minimumPayCents: (json['minimumPayCents'] as num?)?.toInt() ?? 0,
    urgentOnly: json['urgentOnly'] == true,
    recommendedOnly: json['recommendedOnly'] == true,
    location: json['location'] as String?,
    modality: json['modality'] as String?,
    dateScope: _dateScope(json['dateScope'] as String?),
    sortOrder: _sortOrder(json['sortOrder'] as String?),
  );

  ShiftIndustry? _industry(String? value) => switch (value) {
    'hospitality' => ShiftIndustry.hospitality,
    'foodService' => ShiftIndustry.foodService,
    'retail' => ShiftIndustry.retail,
    'events' => ShiftIndustry.events,
    _ => null,
  };

  ShiftDateScope _dateScope(String? value) => ShiftDateScope.values.firstWhere(
    (item) => item.name == value,
    orElse: () => ShiftDateScope.any,
  );

  ShiftSortOrder _sortOrder(String? value) => ShiftSortOrder.values.firstWhere(
    (item) => item.name == value,
    orElse: () => ShiftSortOrder.recommended,
  );
}
