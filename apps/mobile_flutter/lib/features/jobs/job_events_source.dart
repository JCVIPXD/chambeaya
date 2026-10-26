import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_client.dart';
import 'jobs_models.dart';

/// Avisos en vivo del proceso de selección (`GET /api/job-events`, SSE).
///
/// Contrato del flujo devuelto por [watch]:
///  * emite un [JobEventNotification] por cada `event: job`;
///  * si la conexión se corta, se vuelve a conectar sola con retroceso
///    exponencial (1 s, 2 s, 4 s ... hasta 30 s) sin emitir errores;
///  * si el servidor responde `401` la sesión venció: emite un
///    [ApiException] `401` y se cierra, **sin reintentar**;
///  * al cancelar la suscripción se aborta la conexión abierta y no queda
///    ningún temporizador pendiente.
abstract interface class JobEventsSource {
  Stream<JobEventNotification> watch();
}

class HttpJobEventsSource implements JobEventsSource {
  HttpJobEventsSource({
    required this.api,
    this.initialBackoff = const Duration(seconds: 1),
    this.maxBackoff = const Duration(seconds: 30),
  });

  final ApiClient api;
  final Duration initialBackoff;
  final Duration maxBackoff;

  /// Retroceso exponencial acotado (visible para las pruebas).
  static Duration backoffFor(
    int attempt, {
    required Duration initial,
    required Duration max,
  }) {
    final factor = 1 << (attempt < 10 ? attempt : 10);
    final candidate = initial * factor;
    return candidate > max ? max : candidate;
  }

  @override
  Stream<JobEventNotification> watch() {
    late final StreamController<JobEventNotification> controller;
    var cancelled = false;
    final cancelSignal = Completer<void>();
    Completer<void>? abort;

    Future<void> run() async {
      var attempt = 0;
      while (!cancelled) {
        final currentAbort = abort = Completer<void>();
        try {
          final request =
              http.AbortableRequest(
                  'GET',
                  api.uri('/job-events'),
                  abortTrigger: currentAbort.future,
                )
                ..headers['Accept'] = 'text/event-stream'
                ..headers['Cache-Control'] = 'no-cache'
                ..headers.addAll(api.authHeaders);
          final response = await api.client.send(request);
          if (cancelled) break;
          if (response.statusCode == 401) {
            if (!controller.isClosed) {
              controller.addError(const ApiException(401, 'INVALID_SESSION'));
            }
            break;
          }
          if (response.statusCode != 200) {
            throw StateError('SSE ${response.statusCode}');
          }
          attempt = 0;
          var buffer = '';
          await for (final chunk in response.stream.transform(utf8.decoder)) {
            if (cancelled) break;
            buffer += chunk.replaceAll('\r\n', '\n');
            var boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              final block = buffer.substring(0, boundary);
              buffer = buffer.substring(boundary + 2);
              final event = _parseBlock(block);
              if (event != null && !controller.isClosed) controller.add(event);
              boundary = buffer.indexOf('\n\n');
            }
            // Un bloque sin terminar que crece sin fin no es un flujo válido.
            if (buffer.length > 65536) buffer = '';
          }
        } catch (_) {
          // Corte de red, respuesta inesperada o abortada: se reintenta.
        }
        if (cancelled) break;
        final wait = backoffFor(
          attempt,
          initial: initialBackoff,
          max: maxBackoff,
        );
        attempt += 1;
        final elapsed = Completer<void>();
        final timer = Timer(wait, elapsed.complete);
        await Future.any<void>([elapsed.future, cancelSignal.future]);
        timer.cancel();
      }
      if (!controller.isClosed) await controller.close();
    }

    controller = StreamController<JobEventNotification>(
      onListen: () {
        unawaited(run());
      },
      onCancel: () {
        cancelled = true;
        if (!cancelSignal.isCompleted) cancelSignal.complete();
        final pending = abort;
        if (pending != null && !pending.isCompleted) pending.complete();
      },
    );
    return controller.stream;
  }

  static JobEventNotification? _parseBlock(String block) {
    String? name;
    final data = <String>[];
    for (final line in block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        name = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        data.add(line.substring(5).trimLeft());
      }
    }
    if (name != 'job' || data.isEmpty) return null;
    try {
      return JobEventNotification.tryParse(jsonDecode(data.join('\n')));
    } catch (_) {
      return null;
    }
  }
}
