import 'dart:async';
import 'dart:convert';

import 'package:chambeaya_mobile/features/jobs/api_client.dart';
import 'package:chambeaya_mobile/features/jobs/job_events_source.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_errors.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_format.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_models.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_repository.dart';
import 'package:chambeaya_mobile/features/wallet/wallet_models.dart';
import 'package:chambeaya_mobile/features/wallet/wallet_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/jobs_fixtures.dart';

// Contrato entre la app y la API real (apps/api, docs/reference/api.md): rutas,
// parámetros, cuerpos, códigos de error y cabeceras. Las respuestas simuladas
// replican la forma que devuelve la API (verificada contra el stack de
// desarrollo al registrar CN-20261110-053).

typedef _Call = ({String method, Uri url, Map<String, String> headers, String body});

http.Response _json(Object body, [int status = 200, Map<String, String>? headers]) =>
    http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json', ...?headers},
    );

({ApiClient api, List<_Call> calls}) _client(
  FutureOr<http.Response> Function(http.Request request) handler,
) {
  final calls = <_Call>[];
  final mock = MockClient((request) async {
    calls.add((
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
    ));
    return handler(request);
  });
  return (
    api: ApiClient(client: mock, baseUrl: 'http://api.test/api/', token: 'tok-123'),
    calls: calls,
  );
}

void main() {
  group('HttpJobsRepository: rutas y formas de la API', () {
    test('busca puestos con filtros, cursor y token de sesión', () async {
      final h = _client(
        (_) => _json({
          'items': [postingJson('p1', highlighted: true)],
          'nextCursor': 'abc',
        }),
      );
      final page = await HttpJobsRepository(api: h.api).searchPostings(
        const JobSearchFilter(
          query: ' caja ',
          modality: Modality.remote,
          workload: Workload.partTime,
          contractType: ContractType.fixedTerm,
          minSalarySoles: 1500,
          location: 'Lima',
        ),
        cursor: 'c0',
        limit: 10,
      );
      final call = h.calls.single;
      expect(call.method, 'GET');
      expect(call.url.path, '/api/workers/job-postings');
      expect(call.url.queryParameters, {
        'query': 'caja',
        'modality': 'REMOTE',
        'workload': 'PART_TIME',
        'contractType': 'FIXED_TERM',
        // La API recibe céntimos de sol.
        'minSalaryCents': '150000',
        'location': 'Lima',
        'limit': '10',
        'cursor': 'c0',
      });
      expect(call.headers['Authorization'], 'Bearer tok-123');
      expect(page.items.single.isHighlighted, isTrue);
      expect(page.items.single.companyName, 'Empresa p1');
      expect(page.nextCursor, 'abc');
      expect(page.hasMore, isTrue);
    });

    test('sin filtros no envía parámetros vacíos y el último cursor es null', () async {
      final h = _client((_) => _json({'items': [], 'nextCursor': null}));
      final page = await HttpJobsRepository(api: h.api).searchPostings(const JobSearchFilter());
      expect(h.calls.single.url.queryParameters, {'limit': '20'});
      expect(page.items, isEmpty);
      expect(page.nextCursor, isNull);
    });

    test('postular envía las respuestas y la prioridad solo si se pidió', () async {
      final h = _client(
        (_) => _json({
          ...applicationJson('a1'),
          'created': true,
          'reopened': false,
          'idempotent': false,
          'chargedAmount': 15,
        }, 201),
      );
      final repository = HttpJobsRepository(api: h.api);
      final result = await repository.apply(
        'p/1',
        answers: const [ScreeningAnswer(question: '¿Experiencia?', answer: '2 años')],
        priority: true,
      );
      expect(h.calls.single.method, 'POST');
      // El id viaja codificado como un único segmento de ruta.
      expect(h.calls.single.url.path, '/api/workers/job-postings/p%2F1/applications');
      expect(jsonDecode(h.calls.single.body), {
        'answers': [
          {'question': '¿Experiencia?', 'answer': '2 años'},
        ],
        'priority': true,
      });
      expect(result.created, isTrue);
      expect(result.chargedAmount, 15);
      expect(result.application.id, 'a1');

      await repository.apply('p1');
      expect(jsonDecode(h.calls.last.body), {'answers': <Object>[]});
    });

    test('lista mis postulaciones con historial y etapa', () async {
      final h = _client((_) => _json({'items': [applicationJson('a1')], 'nextCursor': null}));
      final page = await HttpJobsRepository(api: h.api).myApplications(
        history: true,
        status: ApplicationStatus.offer,
        cursor: 'k',
      );
      expect(h.calls.single.url.path, '/api/workers/job-applications');
      expect(h.calls.single.url.queryParameters, {
        'limit': '20',
        'history': 'true',
        'status': 'OFFER',
        'cursor': 'k',
      });
      expect(page.items.single.status, ApplicationStatus.applied);
    });

    test('retirar, priorizar, aceptar y rechazar usan las rutas del trabajador', () async {
      final h = _client((_) => _json(applicationJson('a1')));
      final repository = HttpJobsRepository(api: h.api);
      await repository.application('a1');
      await repository.withdraw('a1');
      await repository.prioritize('a1');
      await repository.acceptOffer('a1', 'o1');
      await repository.declineOffer('a1', 'o1');
      expect(h.calls.map((call) => '${call.method} ${call.url.path}').toList(), [
        'GET /api/workers/job-applications/a1',
        'POST /api/workers/job-applications/a1/withdraw',
        'POST /api/workers/job-applications/a1/priority',
        'POST /api/workers/job-applications/a1/offers/o1/accept',
        'POST /api/workers/job-applications/a1/offers/o1/decline',
      ]);
    });

    test('el PDF de la oferta solo se acepta si es un PDF real', () async {
      final pdf = utf8.encode('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
      var body = pdf;
      var type = 'application/pdf';
      final h = _client((_) => http.Response.bytes(body, 200, headers: {'content-type': type}));
      final repository = HttpJobsRepository(api: h.api);

      final ok = await repository.offerDocument('a1', 'o1', fallbackName: 'oferta.pdf');
      expect(h.calls.single.url.path, '/api/workers/job-applications/a1/offers/o1/document');
      expect(ok.bytes, pdf);

      type = 'text/html';
      await expectLater(
        repository.offerDocument('a1', 'o1', fallbackName: 'x.pdf'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'INVALID_PDF_RESPONSE')),
      );
      type = 'application/pdf';
      body = utf8.encode('<html>no soy pdf</html>');
      await expectLater(
        repository.offerDocument('a1', 'o1', fallbackName: 'x.pdf'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'INVALID_PDF_RESPONSE')),
      );
    });

    test('un 404 del PDF conserva el código de la API', () async {
      final h = _client((_) => _json({'error': 'JOB_DOCUMENT_NOT_FOUND'}, 404));
      await expectLater(
        HttpJobsRepository(api: h.api).offerDocument('a1', 'o1', fallbackName: 'x.pdf'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 404)
              .having((e) => e.code, 'code', 'JOB_DOCUMENT_NOT_FOUND'),
        ),
      );
    });
  });

  group('HttpWalletRepository: rutas y formas de la API', () {
    test('saldo y movimientos leen el nombre de la moneda de la respuesta', () async {
      final h = _client((request) {
        if (request.url.path.endsWith('/balance')) {
          return _json({'currency': 'Puntos', 'balance': 42});
        }
        return _json({
          'currency': 'Puntos',
          'items': [
            {
              'id': 'm1',
              'quantity': -5,
              'balanceAfter': 37,
              'action': 'ACTION_CHARGE',
              'actionKey': 'APPLICATION_EXTRA',
              'reason': 'Postulación',
              'createdAt': '2026-11-01T10:00:00.000Z',
            },
            {
              'id': 'm2',
              'quantity': 50,
              'balanceAfter': 87,
              'action': 'REWARD',
              'actionKey': 'WELCOME_BONUS',
              'reason': null,
              'createdAt': '2026-11-01T09:00:00.000Z',
            },
          ],
          'nextCursor': 'next',
        });
      });
      final wallet = HttpWalletRepository(api: h.api);
      final balance = await wallet.balance();
      expect(balance.currency, 'Puntos');
      expect(balance.balance, 42);
      final page = await wallet.movements(cursor: 'c', limit: 5);
      expect(h.calls.last.url.path, '/api/workers/currency/movements');
      expect(h.calls.last.url.queryParameters, {'limit': '5', 'cursor': 'c'});
      expect(page.currency, 'Puntos');
      expect(page.items.first.action, MovementAction.charge);
      expect(page.items.first.quantity, -5);
      expect(page.items.last.action, MovementAction.reward);
      expect(page.nextCursor, 'next');
    });

    test('la cotización pide actionKey y targetId y lee todos los campos', () async {
      final h = _client(
        (_) => _json(quoteJson(cost: 10, reason: 'CHARGE', balance: 4, sufficient: false)),
      );
      final quote = await HttpWalletRepository(
        api: h.api,
      ).quote(ActionKeys.applicationPriority, targetId: 'a1');
      expect(h.calls.single.method, 'GET');
      expect(h.calls.single.url.path, '/api/workers/currency/quote');
      expect(h.calls.single.url.queryParameters, {
        'actionKey': 'APPLICATION_PRIORITY',
        'targetId': 'a1',
      });
      expect(quote.cost, 10);
      expect(quote.reason, QuoteReason.charge);
      expect(quote.sufficientBalance, isFalse);
      expect(quote.canExecute, isFalse);
      expect(quote.isFree, isFalse);
      expect(quote.freeQuota?.remaining, 7);
      expect(quote.dailyCap?.remaining, 200);
      expect(quote.refundWindowHours, 72);
      expect(quote.currency, 'Chambitas');
    });

    test('catálogo, premios, referido y destacar perfil', () async {
      final h = _client((request) {
        switch (request.url.path) {
          case '/api/workers/currency/catalog':
            return _json({
              'currency': 'Chambitas',
              'items': [
                {
                  'actionKey': 'APPLICATION_EXTRA',
                  'kind': 'COST',
                  'amount': 5,
                  'freeMonthlyQuota': 10,
                  'freeRemaining': 4,
                  'refundWindowHours': 72,
                },
                {'actionKey': 'WELCOME_BONUS', 'kind': 'REWARD', 'amount': 50},
              ],
            });
          case '/api/workers/currency/rewards':
            return _json({
              'currency': 'Chambitas',
              'items': [
                {
                  'actionKey': 'PROFILE_COMPLETE',
                  'amount': 20,
                  'repeatable': false,
                  'earnedCount': 0,
                  'earnedAmount': 0,
                  'status': 'AVAILABLE',
                  'requiredSections': ['headline', 'bio'],
                  'missingSections': ['bio'],
                },
                {
                  'actionKey': 'DOCUMENT_VERIFIED',
                  'amount': 10,
                  'repeatable': true,
                  'earnedCount': 1,
                  'earnedAmount': 10,
                  'status': 'AVAILABLE',
                  'maxRewards': 2,
                  'documents': [
                    {'kind': 'CV', 'uploaded': true, 'verified': true, 'rewarded': true},
                  ],
                },
                {
                  'actionKey': 'REFERRAL',
                  'amount': 20,
                  'repeatable': true,
                  'earnedCount': 0,
                  'earnedAmount': 0,
                  'status': 'AVAILABLE',
                  'monthly': {'limit': 5, 'used': 1, 'remaining': 4},
                },
              ],
              'caps': {
                'daily': {'limit': 100, 'earned': 20, 'remaining': 80},
                'monthly': {'limit': 600, 'earned': 20, 'remaining': 580},
              },
            });
          case '/api/workers/me/referral':
            return _json({
              'code': 'P7NQ9RLT',
              'referred': 3,
              'rewarded': 2,
              'monthly': {'limit': 5, 'used': 2, 'remaining': 3},
            });
          default:
            return _json({
              'highlightedUntil': '2026-11-20T10:00:00.000Z',
              'idempotent': false,
              'chargedAmount': 10,
            });
        }
      });
      final wallet = HttpWalletRepository(api: h.api);
      final catalog = await wallet.catalog();
      expect(catalog.costs.single.actionKey, 'APPLICATION_EXTRA');
      expect(catalog.costs.single.freeRemaining, 4);
      expect(catalog.items.last.isCost, isFalse);

      final rewards = await wallet.rewards();
      expect(rewards.item('PROFILE_COMPLETE')?.missingSections, ['bio']);
      expect(rewards.item('DOCUMENT_VERIFIED')?.documents.single.verified, isTrue);
      expect(rewards.item('REFERRAL')?.monthly?.remaining, 4);
      expect(rewards.dailyCap?.remaining, 80);
      expect(rewards.monthlyCap?.limit, 600);

      final referral = await wallet.referral();
      expect(referral.code, 'P7NQ9RLT');
      expect(referral.monthly?.remaining, 3);

      final highlight = await wallet.highlightProfile();
      expect(h.calls.last.method, 'POST');
      expect(h.calls.last.url.path, '/api/workers/me/profile/highlight');
      expect(highlight.chargedAmount, 10);
      expect(highlight.idempotent, isFalse);
      expect(highlight.highlightedUntil, DateTime.utc(2026, 11, 20, 10));
    });
  });

  group('Errores de la API', () {
    test('409 INSUFFICIENT_CURRENCY conserva costo y saldo', () async {
      final h = _client((_) => _json({'error': 'INSUFFICIENT_CURRENCY', 'cost': 10, 'balance': 4}, 409));
      final error = await HttpJobsRepository(api: h.api).prioritize('a1').then<Object>((_) => '', onError: (e) => e);
      expect(error, isA<ApiException>());
      final exception = error as ApiException;
      expect(exception.status, 409);
      expect(exception.code, 'INSUFFICIENT_CURRENCY');
      expect(exception.details, {'cost': 10, 'balance': 4});
      final info = describeJobsError(exception, currency: 'Chambitas');
      expect(info.kind, JobsErrorKind.insufficient);
      expect(info.message, contains('10 Chambitas'));
      expect(info.message, contains('te faltan 6 Chambitas'));
      expect(info.message, contains('No se cobró nada'));
      expect(info.message, isNot(contains('INSUFFICIENT')));
    });

    test('409 DAILY_SPEND_CAP_REACHED explica el tope sin código crudo', () {
      final info = describeJobsError(
        const ApiException(
          409,
          'DAILY_SPEND_CAP_REACHED',
          details: {'cost': 10, 'dailyCap': 200, 'spentToday': 195},
        ),
        currency: 'Chambitas',
      );
      expect(info.kind, JobsErrorKind.dailyCap);
      expect(info.message, contains('195 Chambitas'));
      expect(info.message, contains('200 Chambitas'));
      expect(info.message, contains('mañana'));
      expect(info.message, isNot(contains('DAILY_SPEND')));
    });

    test('503 con Retry-After permite reintentar y respeta el tiempo', () async {
      final h = _client(
        (_) => _json(
          {'error': 'SERIALIZATION_RETRY_EXHAUSTED', 'retryable': true},
          503,
          {'retry-after': '1'},
        ),
      );
      final error = await HttpWalletRepository(api: h.api).balance().then<Object>((_) => '', onError: (e) => e);
      final exception = error as ApiException;
      expect(exception.status, 503);
      expect(exception.retryAfterSeconds, 1);
      final info = describeJobsError(exception);
      expect(info.kind, JobsErrorKind.retry);
      expect(info.canRetry, isTrue);
      expect(info.retryAfterSeconds, 1);
      expect(info.message, contains('No se aplicó ningún cambio'));
    });

    test('un Retry-After absurdo se acota y uno inválido se ignora', () {
      final high = ApiClient.errorFrom(
        http.Response('{}', 503, headers: {'retry-after': '99999'}),
      );
      expect(high.retryAfterSeconds, 60);
      final junk = ApiClient.errorFrom(
        http.Response('no es json', 503, headers: {'retry-after': 'mañana'}),
      );
      expect(junk.retryAfterSeconds, isNull);
      expect(junk.code, 'HTTP_503');
    });

    test('sin conexión y tiempo agotado se distinguen de un error del servidor', () async {
      final client = ApiClient(
        client: MockClient((_) => throw http.ClientException('sin red')),
        baseUrl: 'http://api.test/api',
      );
      final error = await HttpWalletRepository(api: client).balance().then<Object>((_) => '', onError: (e) => e);
      expect((error as ApiException).isNetwork, isTrue);
      expect(describeJobsError(error).kind, JobsErrorKind.network);
      expect(describeJobsError(error).canRetry, isTrue);
    });

    test('401 se reporta como sesión vencida', () {
      final info = describeJobsError(const ApiException(401, 'INVALID_SESSION'));
      expect(info.kind, JobsErrorKind.session);
    });

    test('una respuesta 200 que no es un objeto JSON es INVALID_RESPONSE', () async {
      final h = _client((_) => http.Response('[]', 200));
      await expectLater(
        HttpWalletRepository(api: h.api).balance(),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'INVALID_RESPONSE')),
      );
    });

    test('ningún código de la API se muestra tal cual al usuario', () {
      for (final code in const [
        'ALREADY_APPLIED',
        'APPLICATION_HAS_ACCEPTED_OFFER',
        'INVALID_SCREENING_ANSWERS',
        'POSTING_NOT_PUBLISHED',
        'PRIORITY_NOT_AVAILABLE',
        'OFFER_NOT_PENDING',
        'INVALID_STATE_TRANSITION',
        'SOMETHING_NEW',
      ]) {
        for (final status in [400, 404, 409, 500]) {
          final message = describeJobsError(ApiException(status, code)).message;
          expect(message, isNot(contains(code)), reason: '$status $code');
          expect(message.trim(), isNotEmpty);
        }
      }
    });
  });

  group('Modelos', () {
    test('un valor desconocido de un enum no rompe el análisis', () {
      final application = JobApplication.fromJson(
        applicationJson('a1', status: 'ALGO_NUEVO'),
      );
      expect(application.status, ApplicationStatus.unknown);
      expect(modalityLabel(Modality.parse('???')), 'Modalidad por definir');
    });

    test('la oferta vigente y la constancia salen de la postulación', () {
      final application = JobApplication.fromJson(
        applicationJson(
          'a1',
          status: 'ACCEPTED',
          currentOfferId: 'o2',
          offers: [
            offerJson('o1', status: 'SUPERSEDED'),
            offerJson(
              'o2',
              version: 2,
              status: 'ACCEPTED',
              snapshot: {
                'acceptedAt': '2026-10-20T15:00:00.000Z',
                'offerVersion': 2,
                'company': {'id': 'c', 'name': 'Acme', 'legalName': 'Acme S.A.C.', 'ruc': '20555555551'},
                'worker': {'id': 'w', 'name': 'Ana', 'identifier': '12345678'},
                'posting': {'id': 'p', 'title': 'Cajero', 'location': 'Lima'},
                'conditions': {
                  'salaryCents': 250000,
                  'currency': 'PEN',
                  'contractType': 'INDEFINITE',
                  'startDate': '2026-11-02',
                  'note': null,
                },
                'document': null,
              },
            ),
          ],
        ),
      );
      expect(application.currentOffer?.version, 2);
      expect(application.hasAcceptedOffer, isTrue);
      expect(application.canRespondToOffer, isFalse);
      final receipt = application.currentOffer!.receipt!;
      expect(receipt.companyRuc, '20555555551');
      expect(receipt.startDate, '2026-11-02');
      expect(formatCalendarDate('2026-12-01T00:00:00.000Z'), '1 dic. 2026');
    });

    test('el rechazo automático se explica con el motivo de la postulación', () {
      // La API no entrega al trabajador el `detail` de un rechazo.
      final event = JobEvent.fromJson({
        'id': 'e',
        'type': 'REJECTED',
        'actorRole': 'BUSINESS',
        'fromStatus': 'OFFER',
        'toStatus': 'REJECTED',
        'detail': null,
        'createdAt': '2026-10-20T15:00:00.000Z',
      });
      expect(eventLabel(event), contains('decidió no continuar'));
      expect(
        eventLabel(event, autoClosedReason: 'POSTING_CLOSED'),
        contains('puesto se cerró'),
      );
      expect(
        eventLabel(event, autoClosedReason: 'POSTING_FILLED'),
        contains('puesto se cubrió'),
      );
    });

    test('formatos de moneda y sueldo', () {
      expect(formatCoins(1250, 'Chambitas'), '1.250 Chambitas');
      expect(formatCoins(5, ''), '5 monedas');
      expect(formatSoles(150000), 'S/ 1.500');
      expect(formatSoles(150050), 'S/ 1.500,50');
      expect(safePdfFileName('../../etc/pass:wd.PDF'), 'passwd.pdf');
    });
  });

  group('HttpJobEventsSource (SSE)', () {
    http.StreamedResponse sse(Stream<String> chunks, [int status = 200]) =>
        http.StreamedResponse(chunks.map(utf8.encode), status);

    test('emite un aviso por cada evento job y descarta lo demás', () async {
      final controller = StreamController<String>();
      final requests = <http.BaseRequest>[];
      final mock = MockClient.streaming((request, _) async {
        requests.add(request);
        return sse(controller.stream);
      });
      final source = HttpJobEventsSource(
        api: ApiClient(client: mock, baseUrl: 'http://api.test/api', token: 'tok'),
      );
      final received = <JobEventNotification>[];
      final subscription = source.watch().listen(received.add);
      controller
        ..add('retry: 2000\n\n')
        ..add(': keep-alive\n\n')
        ..add('event: job\ndata: {"type":"OFFER_ISSUED","applicationId":"a1",')
        ..add('"postingId":"p1","status":"OFFER"}\n\n')
        ..add('event: otro\ndata: {"applicationId":"zzz"}\n\n');
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(requests.single.url.path, '/api/job-events');
      expect(requests.single.headers['Authorization'], 'Bearer tok');
      expect(requests.single.headers['Accept'], 'text/event-stream');
      expect(received, hasLength(1));
      expect(received.single.applicationId, 'a1');
      expect(received.single.status, ApplicationStatus.offer);
      await subscription.cancel();
      await controller.close();
    });

    test('un 401 emite el error de sesión y no reintenta', () async {
      var attempts = 0;
      final mock = MockClient.streaming((request, _) async {
        attempts++;
        return sse(const Stream<String>.empty(), 401);
      });
      final source = HttpJobEventsSource(
        api: ApiClient(client: mock, baseUrl: 'http://api.test/api', token: 'tok'),
        initialBackoff: const Duration(milliseconds: 5),
      );
      final errors = <Object>[];
      final done = Completer<void>();
      source.watch().listen((_) {}, onError: errors.add, onDone: done.complete);
      await done.future.timeout(const Duration(seconds: 2));
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(attempts, 1);
      expect(errors.single, isA<ApiException>().having((e) => e.isUnauthorized, '401', isTrue));
    });

    test('si la conexión se corta se reconecta sola', () async {
      var attempts = 0;
      final mock = MockClient.streaming((request, _) async {
        attempts++;
        if (attempts == 1) throw http.ClientException('corte');
        return sse(
          Stream.value(
            'event: job\ndata: {"type":"HIRED","applicationId":"a9","postingId":"p","status":"HIRED"}\n\n',
          ),
        );
      });
      final source = HttpJobEventsSource(
        api: ApiClient(client: mock, baseUrl: 'http://api.test/api', token: 'tok'),
        initialBackoff: const Duration(milliseconds: 5),
        maxBackoff: const Duration(milliseconds: 10),
      );
      final first = Completer<JobEventNotification>();
      final subscription = source.watch().listen((event) {
        if (!first.isCompleted) first.complete(event);
      });
      final event = await first.future.timeout(const Duration(seconds: 2));
      expect(event.applicationId, 'a9');
      expect(attempts, greaterThanOrEqualTo(2));
      await subscription.cancel();
    });

    test('el retroceso es exponencial y acotado', () {
      Duration at(int attempt) => HttpJobEventsSource.backoffFor(
        attempt,
        initial: const Duration(seconds: 1),
        max: const Duration(seconds: 30),
      );
      expect(at(0), const Duration(seconds: 1));
      expect(at(1), const Duration(seconds: 2));
      expect(at(3), const Duration(seconds: 8));
      expect(at(20), const Duration(seconds: 30));
    });
  });
}
