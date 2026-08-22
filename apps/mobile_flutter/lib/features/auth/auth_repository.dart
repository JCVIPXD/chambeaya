import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';
import '../onboarding/onboarding_page.dart';
import 'auth_session.dart';

class AuthRepository {
  AuthRepository({http.Client? client, String? apiBaseUrl})
    : _client = client ?? http.Client(),
      _apiBaseUrl = (apiBaseUrl ?? AppConfig.apiBaseUrl).replaceFirst(
        RegExp(r'/$'),
        '',
      );

  final http.Client _client;
  final String _apiBaseUrl;

  Future<AuthSession> register({
    required AppAudience audience,
    required String name,
    required String email,
    required String password,
    required String identifier,
  }) => _post('register', {
    'role': audience == AppAudience.worker ? 'WORKER' : 'BUSINESS',
    'name': name,
    'email': email,
    'password': password,
    'dniOrRuc': identifier,
  });

  Future<AuthSession> login({
    required String email,
    required String password,
  }) => _post('login', {'email': email, 'password': password});

  Future<AuthSession> restore(String token) async {
    final response = await _client.get(
      _endpoint('session'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _sessionFromResponse(response);
  }

  Future<void> logout(String token) async {
    await _client.delete(
      _endpoint('session'),
      headers: {'Authorization': 'Bearer $token'},
    );
  }

  Future<AuthSession> _post(String path, Map<String, Object> body) async {
    final response = await _client.post(
      _endpoint(path),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    return _sessionFromResponse(response);
  }

  AuthSession _sessionFromResponse(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('No se pudo validar la sesión.');
    }
    return AuthSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Uri _endpoint(String path) => Uri.parse('$_apiBaseUrl/auth/$path');
}
