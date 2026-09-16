import 'package:cumple_now_mobile/features/profile/talent_invitation_repository.dart';
import 'package:cumple_now_mobile/features/profile/worker_invitations_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows an explicit empty state when there are no invitations', (
    tester,
  ) async {
    final repository = _FakeInvitationRepository(invitations: const []);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: WorkerInvitationsPage(repository: repository)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Aún no tienes invitaciones'), findsOneWidget);
  });

  testWidgets('shows an explicit error state and can retry', (tester) async {
    final repository = _FakeInvitationRepository(shouldFailList: true);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: WorkerInvitationsPage(repository: repository)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No pudimos cargar tus invitaciones.'), findsOneWidget);

    repository.shouldFailList = false;
    repository.invitations = [_pending];
    await tester.tap(find.text('Reintentar'));
    await tester.pumpAndSettle();

    expect(find.text('Restaurante La Mar'), findsOneWidget);
  });

  testWidgets(
    'shows the company and message as plain text and offers Aceptar/Rechazar '
    'only for a pending invitation',
    (tester) async {
      final repository = _FakeInvitationRepository(
        invitations: [_pending, _declined],
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerInvitationsPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      // Pending invitation: company, message and both actions.
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(
        find.text('Nos gustaría contar contigo este fin de semana.'),
        findsOneWidget,
      );
      expect(find.text('Pendiente'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Aceptar'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Rechazar'), findsOneWidget);

      // Already-answered invitation: only its status, no action buttons.
      expect(find.text('Eventos Perú'), findsOneWidget);
      expect(find.text('Rechazada'), findsOneWidget);
    },
  );

  testWidgets(
    'accepting a pending invitation only reflects success after the real '
    'server response',
    (tester) async {
      final repository = _FakeInvitationRepository(
        invitations: [_pending],
        respondDelay: const Duration(milliseconds: 200),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerInvitationsPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(FilledButton, 'Aceptar'));
      // Before the fake repository's delayed future resolves, the card must
      // not yet claim success: no optimistic update.
      await tester.pump();
      expect(find.text('Pendiente'), findsOneWidget);
      expect(repository.acceptCalls, ['invitation-pending']);

      await tester.pump(const Duration(milliseconds: 250));

      expect(find.text('Aceptada'), findsOneWidget);
      expect(find.text('Invitación aceptada.'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Aceptar'), findsNothing);
    },
  );

  testWidgets(
    'shows the specific server reason when a response fails and reloads',
    (tester) async {
      final repository = _FakeInvitationRepository(invitations: [_pending]);
      repository.declineError = const TalentInvitationResponseError(
        'INVITATION_EXPIRED',
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerInvitationsPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(OutlinedButton, 'Rechazar'));
      await tester.pumpAndSettle();

      expect(find.text('Esta invitación ya venció.'), findsOneWidget);
    },
  );
}

final _pending = TalentInvitation(
  id: 'invitation-pending',
  status: 'PENDING',
  message: 'Nos gustaría contar contigo este fin de semana.',
  expiresAt: DateTime.now().add(const Duration(days: 5)),
  respondedAt: null,
  createdAt: DateTime.now().subtract(const Duration(days: 1)),
  shift: null,
  companyId: 'company-la-mar',
  companyName: 'Restaurante La Mar',
);

final _declined = TalentInvitation(
  id: 'invitation-declined',
  status: 'DECLINED',
  message: null,
  expiresAt: DateTime.now().subtract(const Duration(days: 2)),
  respondedAt: DateTime.now().subtract(const Duration(days: 3)),
  createdAt: DateTime.now().subtract(const Duration(days: 6)),
  shift: null,
  companyId: 'company-eventos',
  companyName: 'Eventos Perú',
);

class _FakeInvitationRepository implements TalentInvitationRepository {
  _FakeInvitationRepository({
    List<TalentInvitation> invitations = const [],
    this.shouldFailList = false,
    this.respondDelay = Duration.zero,
  }) : invitations = List.of(invitations);

  List<TalentInvitation> invitations;
  bool shouldFailList;
  Duration respondDelay;
  TalentInvitationResponseError? declineError;
  final List<String> acceptCalls = [];

  @override
  Future<List<TalentInvitation>> list() async {
    if (shouldFailList) throw StateError('network down');
    return List.of(invitations);
  }

  @override
  Future<TalentInvitation> accept(String id) async {
    acceptCalls.add(id);
    if (respondDelay > Duration.zero) await Future.delayed(respondDelay);
    final index = invitations.indexWhere((item) => item.id == id);
    final current = invitations[index];
    final updated = TalentInvitation(
      id: current.id,
      status: 'ACCEPTED',
      message: current.message,
      expiresAt: current.expiresAt,
      respondedAt: DateTime.now(),
      createdAt: current.createdAt,
      shift: current.shift,
      companyId: current.companyId,
      companyName: current.companyName,
    );
    invitations[index] = updated;
    return updated;
  }

  @override
  Future<TalentInvitation> decline(String id) async {
    if (respondDelay > Duration.zero) await Future.delayed(respondDelay);
    if (declineError != null) throw declineError!;
    final index = invitations.indexWhere((item) => item.id == id);
    final current = invitations[index];
    final updated = TalentInvitation(
      id: current.id,
      status: 'DECLINED',
      message: current.message,
      expiresAt: current.expiresAt,
      respondedAt: DateTime.now(),
      createdAt: current.createdAt,
      shift: current.shift,
      companyId: current.companyId,
      companyName: current.companyName,
    );
    invitations[index] = updated;
    return updated;
  }
}
