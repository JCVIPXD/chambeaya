import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';

/// Error de la API (o de la red, con `status == 0`). Nunca contiene el token
/// ni el cuerpo completo de la respuesta: solo el código estable, los detalles
/// numéricos que el servidor devuelve (`cost`, `balance`, ...) y el
/// `Retry-After` del `503`.
class ApiException implements Exception {
  const ApiException(
    this.status,
    this.code, {
    this.details = const {},
    this.retryAfterSeconds,
  });

  /// `0` cuando no hubo respuesta (sin conexión o tiempo agotado).
  final int status;
  final String code;
  final Map<String, dynamic> details;
  final int? retryAfterSeconds;

  bool get isNetwork => status == 0;
  bool get isUnauthorized => status == 401;

  @override
  String toString() => 'ApiException($status, $code)';
}

/// Cliente HTTP mínimo de la API de puestos fijos y moneda. Una sola
/// implementación compartida por los repositorios, con el token de sesión
/// fijo y tiempo de espera acotado. Fácil de simular: recibe un
/// `http.Client` (por ejemplo `MockClient`).
class ApiClient {
  ApiClient({http.Client? client, String? baseUrl, this.token})
    : client = client ?? http.Client(),
      _baseUrl = (baseUrl ?? AppConfig.apiBaseUrl).replaceFirst(
        RegExp(r'/+$'),
        '',
      );

  final http.Client client;
  final String? token;
  final String _baseUrl;

  static const requestTimeout = Duration(seconds: 12);

  Map<String, String> get authHeaders =>
      token == null ? const {} : {'Authorization': 'Bearer $token'};

  Uri uri(String path, [Map<String, String>? query]) {
    final base = Uri.parse('$_baseUrl$path');
    if (query == null || query.isEmpty) return base;
    return base.replace(queryParameters: query);
  }

  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, String>? query,
  }) async {
    final response = await _send(
      () => client.get(uri(path, query), headers: authHeaders),
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final response = await _send(
      () => client.post(
        uri(path),
        headers: {...authHeaders, 'Content-Type': 'application/json'},
        body: jsonEncode(body ?? const <String, dynamic>{}),
      ),
    );
    return _decode(response);
  }

  /// Descarga binaria (PDF de una oferta). El llamador valida el contenido.
  Future<http.Response> getBytes(String path) =>
      _send(() => client.get(uri(path), headers: authHeaders));

  Future<http.Response> _send(Future<http.Response> Function() request) async {
    try {
      return await request().timeout(requestTimeout);
    } on TimeoutException {
      throw const ApiException(0, 'REQUEST_TIMEOUT');
    } on http.ClientException {
      throw const ApiException(0, 'NETWORK_ERROR');
    }
  }

  Map<String, dynamic> _decode(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw errorFrom(response);
    }
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } catch (_) {
      // Se trata abajo como respuesta inválida.
    }
    throw ApiException(response.statusCode, 'INVALID_RESPONSE');
  }

  /// Traduce una respuesta de error a [ApiException]. Un cuerpo que no es
  /// JSON no rompe nada: queda solo el estado HTTP.
  static ApiException errorFrom(http.Response response) {
    var code = 'HTTP_${response.statusCode}';
    var details = <String, dynamic>{};
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map) {
        details = Map<String, dynamic>.from(decoded);
        final error = details.remove('error');
        if (error is String && error.isNotEmpty) code = error;
      }
    } catch (_) {
      // Sin cuerpo útil.
    }
    final retry = int.tryParse(response.headers['retry-after'] ?? '');
    return ApiException(
      response.statusCode,
      code,
      details: details,
      retryAfterSeconds: retry != null && retry >= 0 ? retry.clamp(0, 60) : null,
    );
  }
}
