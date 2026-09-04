import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';
import 'auth_session.dart';

enum AuthFailureKind { invalidCredentials, connectivity, validation, server, unknown }

class AuthFailure implements Exception {
  const AuthFailure(this.kind, {this.statusCode, this.code});

  final AuthFailureKind kind;
  final int? statusCode;
  final String? code;

  @override
  String toString() => 'AuthFailure($kind, ${statusCode ?? "no-status"}, $code)';
}

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
    required String name,
    required String email,
    required String password,
    required String identifier,
  }) => _post('register', {
    'role': 'WORKER',
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
    late final http.Response response;
    try {
      response = await _client.get(
        _endpoint('session'),
        headers: {'Authorization': 'Bearer $token'},
      );
    } on http.ClientException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    } on TimeoutException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    }
    return _sessionFromResponse(response);
  }

  Future<void> logout(String token) async {
    try {
      await _client.delete(
        _endpoint('session'),
        headers: {'Authorization': 'Bearer $token'},
      );
    } on http.ClientException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    } on TimeoutException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    }
  }

  Future<AuthSession> _post(String path, Map<String, Object> body) async {
    late final http.Response response;
    try {
      response = await _client.post(
        _endpoint(path),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
    } on http.ClientException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    } on TimeoutException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    }
    return _sessionFromResponse(response);
  }

  AuthSession _sessionFromResponse(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String? code;
      try {
        final payload = jsonDecode(response.body);
        if (payload is Map<String, dynamic>) code = payload['error'] as String?;
      } catch (_) {
        // Ignore malformed error bodies; status still gives a useful category.
      }
      final kind = response.statusCode == 401 || response.statusCode == 403
          ? AuthFailureKind.invalidCredentials
          : response.statusCode >= 500
          ? AuthFailureKind.server
          : response.statusCode >= 400
          ? AuthFailureKind.validation
          : AuthFailureKind.unknown;
      throw AuthFailure(kind, statusCode: response.statusCode, code: code);
    }
    return AuthSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Uri _endpoint(String path) => Uri.parse('$_apiBaseUrl/auth/$path');
}
