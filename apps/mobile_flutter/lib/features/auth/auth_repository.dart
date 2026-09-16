import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';
import 'auth_session.dart';

enum AuthFailureKind {
  invalidCredentials,
  connectivity,
  validation,
  server,
  unknown,
}

class AuthFailure implements Exception {
  const AuthFailure(this.kind, {this.statusCode, this.code});

  final AuthFailureKind kind;
  final int? statusCode;
  final String? code;

  @override
  String toString() =>
      'AuthFailure($kind, ${statusCode ?? "no-status"}, $code)';
}

class GoogleSignInStart {
  const GoogleSignInStart._({this.session, this.profileSetupToken});

  const GoogleSignInStart.authenticated(AuthSession session)
    : this._(session: session);

  const GoogleSignInStart.profileRequired(String profileSetupToken)
    : this._(profileSetupToken: profileSetupToken);

  final AuthSession? session;
  final String? profileSetupToken;
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
  static const _requestTimeout = Duration(seconds: 8);

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

  Future<GoogleSignInStart> startGoogleLogin({required String idToken}) async {
    final response = await _postResponse('google', {'idToken': idToken});
    if (response.statusCode == 202) {
      final payload = jsonDecode(response.body);
      final profileSetupToken = payload is Map<String, dynamic>
          ? payload['profileSetupToken']
          : null;
      if (profileSetupToken is String && profileSetupToken.isNotEmpty) {
        return GoogleSignInStart.profileRequired(profileSetupToken);
      }
      throw const AuthFailure(AuthFailureKind.unknown);
    }
    return GoogleSignInStart.authenticated(_sessionFromResponse(response));
  }

  Future<AuthSession> completeGoogleProfile({
    required String profileSetupToken,
    required String dni,
    required String password,
  }) => _post('google/complete', {
    'profileSetupToken': profileSetupToken,
    'dni': dni,
    'password': password,
  });

  Future<AuthSession> setInitialGooglePassword({
    required String token,
    required String password,
  }) async {
    late final http.Response response;
    try {
      response = await _client
          .post(
            _endpoint('password'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({'password': password}),
          )
          .timeout(_requestTimeout);
    } on http.ClientException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    } on TimeoutException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    }
    return _sessionFromResponse(response);
  }

  Future<AuthSession> restore(String token) async {
    late final http.Response response;
    try {
      response = await _client
          .get(
            _endpoint('session'),
            headers: {'Authorization': 'Bearer $token'},
          )
          .timeout(_requestTimeout);
    } on http.ClientException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    } on TimeoutException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    }
    return _sessionFromResponse(response);
  }

  Future<void> logout(String token) async {
    try {
      await _client
          .delete(
            _endpoint('session'),
            headers: {'Authorization': 'Bearer $token'},
          )
          .timeout(_requestTimeout);
    } on http.ClientException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    } on TimeoutException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    }
  }

  Future<AuthSession> _post(String path, Map<String, Object> body) async =>
      _sessionFromResponse(await _postResponse(path, body));

  Future<http.Response> _postResponse(
    String path,
    Map<String, Object> body,
  ) async {
    late final http.Response response;
    try {
      response = await _client
          .post(
            _endpoint(path),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(body),
          )
          .timeout(_requestTimeout);
    } on http.ClientException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    } on TimeoutException {
      throw const AuthFailure(AuthFailureKind.connectivity);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _throwFailure(response);
    }
    return response;
  }

  AuthSession _sessionFromResponse(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _throwFailure(response);
    }
    return AuthSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Never _throwFailure(http.Response response) {
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

  Uri _endpoint(String path) => Uri.parse('$_apiBaseUrl/auth/$path');
}
