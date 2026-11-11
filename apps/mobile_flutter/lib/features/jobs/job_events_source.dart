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

/// Un único flujo de avisos por sesión, compartido por todas las pantallas
/// (Puestos y Postulaciones).
///
///  * [watch] devuelve siempre el mismo flujo `broadcast`;
///  * la conexión de la fuente real se abre cuando aparece el primer oyente y
///    se cierra cuando se va el último (la reconexión con retroceso y el corte
///    ante `401` son los de la fuente real: el error `401` llega a todos los
///    oyentes y la conexión no se reintenta);
///  * [close] la cierra al terminar la sesión.
class SharedJobEventsSource implements JobEventsSource {
  SharedJobEventsSource(this._inner) {
    _controller = StreamController<JobEventNotification>.broadcast(
      onListen: _connect,
      onCancel: _disconnect,
    );
  }

  final JobEventsSource _inner;
  late final StreamController<JobEventNotification> _controller;
  StreamSubscription<JobEventNotification>? _upstream;

  /// Conexiones abiertas a la fuente real desde el inicio (pruebas).
  int connections = 0;

  @override
  Stream<JobEventNotification> watch() => _controller.stream;

  void _connect() {
    if (_controller.isClosed || _upstream != null) return;
    connections += 1;
    late final StreamSubscription<JobEventNotification> subscription;
    subscription = _inner.watch().listen(
      (event) {
        if (!_controller.isClosed) _controller.add(event);
      },
      onError: (Object error, StackTrace stackTrace) {
        if (!_controller.isClosed) _controller.addError(error, stackTrace);
      },
      onDone: () {
        // La fuente real terminó (p. ej. tras un 401): no se reintenta hasta
        // que los oyentes se vayan y vuelva uno nuevo.
        if (identical(_upstream, subscription)) _upstream = null;
      },
    );
    _upstream = subscription;
  }

  void _disconnect() {
    final upstream = _upstream;
    _upstream = null;
    upstream?.cancel();
  }

  /// Corta la conexión y cierra el flujo compartido.
  Future<void> close() async {
    _disconnect();
    if (!_controller.isClosed) await _controller.close();
  }
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
            api.onUnauthorized?.call();
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
