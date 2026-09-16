import 'dart:convert';

import 'package:cumple_now_mobile/features/profile/talent_invitation_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  test(
    'HTTP repository lists invitations with the worker session token',
    () async {
      final client = _ScriptedClient({
        '/api/workers/me/talent-invitations': (request) =>
            http.StreamedResponse(
              Stream.value(
                utf8.encode(
                  jsonEncode([
                    {
                      'id': 'invitation-1',
                      'status': 'PENDING',
                      'message': 'Queremos contar contigo',
                      'expiresAt': '2026-09-23T00:00:00.000Z',
                      'respondedAt': null,
                      'createdAt': '2026-09-16T00:00:00.000Z',
                      'shift': {
                        'id': 'shift-1',
                        'title': 'Mozo de salón',
                        'startsAt': '2026-09-20T18:00:00.000Z',
                        'endsAt': '2026-09-21T00:00:00.000Z',
                      },
                      'companyId': 'company-1',
                      'companyName': 'Restaurante La Mar',
                    },
                    {
                      'id': 'invitation-2',
                      'status': 'DECLINED',
                      'message': null,
                      'expiresAt': '2026-09-10T00:00:00.000Z',
                      'respondedAt': '2026-09-09T00:00:00.000Z',
                      'createdAt': '2026-09-02T00:00:00.000Z',
                      'shift': null,
                      'companyId': 'company-2',
                      'companyName': 'Eventos Perú',
                    },
                  ]),
                ),
              ),
              200,
              headers: {'content-type': 'application/json'},
              request: request,
            ),
      });
      final repository = HttpTalentInvitationRepository(
        client: client,
        baseUri: Uri.parse('http://localhost:4000'),
        token: 'worker-token',
      );

      final invitations = await repository.list();

      expect(client.lastAuthorization, 'Bearer worker-token');
      expect(invitations, hasLength(2));
      expect(invitations.first.id, 'invitation-1');
      expect(invitations.first.status, 'PENDING');
      expect(invitations.first.isRespondable, isTrue);
      expect(invitations.first.shift?.title, 'Mozo de salón');
      expect(invitations.last.status, 'DECLINED');
      expect(invitations.last.isRespondable, isFalse);
      expect(invitations.last.shift, isNull);
      expect(invitations.last.message, isNull);
    },
  );

  test(
    'HTTP repository accepts a pending invitation and returns the server response',
    () async {
      final client = _ScriptedClient({
        '/api/workers/me/talent-invitations/invitation-1/accept': (request) =>
            http.StreamedResponse(
              Stream.value(
                utf8.encode(
                  jsonEncode({
                    'id': 'invitation-1',
                    'status': 'ACCEPTED',
                    'message': null,
                    'expiresAt': '2026-09-23T00:00:00.000Z',
                    'respondedAt': '2026-09-16T12:00:00.000Z',
                    'createdAt': '2026-09-16T00:00:00.000Z',
                    'shift': null,
                    'companyId': 'company-1',
                    'companyName': 'Restaurante La Mar',
                  }),
                ),
              ),
              200,
              headers: {'content-type': 'application/json'},
              request: request,
            ),
      });
      final repository = HttpTalentInvitationRepository(
        client: client,
        baseUri: Uri.parse('http://localhost:4000'),
        token: 'worker-token',
      );

      final updated = await repository.accept('invitation-1');

      expect(client.lastMethod, 'POST');
      expect(updated.status, 'ACCEPTED');
      expect(updated.respondedAt, isNotNull);
    },
  );

  test(
    'HTTP repository surfaces the server error code when a response fails',
    () async {
      final client = _ScriptedClient({
        '/api/workers/me/talent-invitations/invitation-1/decline': (request) =>
            http.StreamedResponse(
              Stream.value(
                utf8.encode(jsonEncode({'error': 'INVITATION_EXPIRED'})),
              ),
              409,
              headers: {'content-type': 'application/json'},
              request: request,
            ),
      });
      final repository = HttpTalentInvitationRepository(
        client: client,
        baseUri: Uri.parse('http://localhost:4000'),
        token: 'worker-token',
      );

      await expectLater(
        repository.decline('invitation-1'),
        throwsA(
          isA<TalentInvitationResponseError>().having(
            (error) => error.code,
            'code',
            'INVITATION_EXPIRED',
          ),
        ),
      );
    },
  );

  test(
    'demo repository seeds a pending invitation that can be accepted once',
    () async {
      final repository = DemoTalentInvitationRepository();

      final initial = await repository.list();
      expect(initial, hasLength(1));
      expect(initial.single.status, 'PENDING');

      final accepted = await repository.accept(initial.single.id);
      expect(accepted.status, 'ACCEPTED');

      final afterwards = await repository.list();
      expect(afterwards.single.status, 'ACCEPTED');
      expect(afterwards.single.isRespondable, isFalse);

      await expectLater(
        repository.accept(initial.single.id),
        throwsA(isA<TalentInvitationResponseError>()),
      );
    },
  );
}

class _ScriptedClient extends http.BaseClient {
  _ScriptedClient(this.responses);
  final Map<String, http.StreamedResponse Function(http.BaseRequest)> responses;
  String? lastAuthorization;
  String? lastMethod;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    lastAuthorization = request.headers['Authorization'];
    lastMethod = request.method;
    final handler = responses[request.url.path];
    if (handler == null) {
      return http.StreamedResponse(
        Stream.value(utf8.encode('{"error":"NOT_FOUND"}')),
        404,
        request: request,
      );
    }
    return handler(request);
  }
}
