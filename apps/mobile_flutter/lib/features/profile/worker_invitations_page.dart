import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'talent_invitation_repository.dart';

/// Lets the worker see the invitations companies sent to their talent
/// profile and respond to the ones still `PENDING`. Every "Aceptar"/
/// "Rechazar" action is a real call to
/// `POST /api/workers/me/talent-invitations/:id/{accept,decline}`; the card
/// only reflects the server's response, never an optimistic guess.
class WorkerInvitationsPage extends StatefulWidget {
  const WorkerInvitationsPage({super.key, required this.repository});

  final TalentInvitationRepository repository;

  @override
  State<WorkerInvitationsPage> createState() => _WorkerInvitationsPageState();
}

class _WorkerInvitationsPageState extends State<WorkerInvitationsPage> {
  List<TalentInvitation>? _invitations;
  var _isLoading = true;
  String? _error;
  final Set<String> _responding = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final invitations = await widget.repository.list();
      if (!mounted) return;
      setState(() {
        _invitations = invitations;
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _error = 'No pudimos cargar tus invitaciones.';
      });
    }
  }

  Future<void> _respond(TalentInvitation invitation, bool accept) async {
    if (_responding.contains(invitation.id)) return;
    setState(() => _responding.add(invitation.id));
    try {
      final updated = accept
          ? await widget.repository.accept(invitation.id)
          : await widget.repository.decline(invitation.id);
      if (!mounted) return;
      setState(() {
        _responding.remove(invitation.id);
        final current = _invitations;
        if (current != null) {
          _invitations = [
            for (final item in current)
              if (item.id == updated.id) updated else item,
          ];
        }
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            accept ? 'Invitación aceptada.' : 'Invitación rechazada.',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _responding.remove(invitation.id));
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_responseErrorMessage(error))));
      // The server is the only source of truth for whether the response
      // went through. On failure, reload instead of leaving a stale card:
      // the invitation may have just expired or already been answered from
      // another session.
      await _load();
    }
  }

  String _responseErrorMessage(Object error) {
    if (error is TalentInvitationResponseError) {
      switch (error.code) {
        case 'INVITATION_EXPIRED':
          return 'Esta invitación ya venció.';
        case 'INVITATION_NOT_PENDING':
          return 'Esta invitación ya fue respondida antes.';
        case 'INVITATION_NOT_FOUND':
          return 'Esta invitación ya no está disponible.';
      }
    }
    return 'No se pudo enviar tu respuesta. Inténtalo nuevamente.';
  }

  @override
  Widget build(BuildContext context) => _InvitationsScaffold(
    onRefresh: _isLoading ? null : _load,
    child: _buildBody(),
  );

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return _InvitationsMessage(
        title: _error!,
        message: 'Verifica tu conexión e inténtalo nuevamente.',
        onRetry: _load,
      );
    }
    final invitations = _invitations ?? const <TalentInvitation>[];
    if (invitations.isEmpty) {
      return const _InvitationsMessage(
        title: 'Aún no tienes invitaciones',
        message:
            'Cuando una empresa te invite desde el directorio de talento, la verás aquí.',
      );
    }
    return Column(
      children: invitations
          .map(
            (invitation) => _InvitationCard(
              invitation: invitation,
              responding: _responding.contains(invitation.id),
              onAccept: invitation.isRespondable
                  ? () => _respond(invitation, true)
                  : null,
              onDecline: invitation.isRespondable
                  ? () => _respond(invitation, false)
                  : null,
            ),
          )
          .toList(),
    );
  }
}

({String label, Color color}) _statusPresentation(String status) =>
    switch (status) {
      'PENDING' => (label: 'Pendiente', color: AppColors.gold),
      'ACCEPTED' => (label: 'Aceptada', color: AppColors.teal),
      'DECLINED' => (label: 'Rechazada', color: AppColors.muted),
      'EXPIRED' => (label: 'Vencida', color: AppColors.muted),
      'CANCELLED' => (label: 'Cancelada', color: AppColors.muted),
      _ => (label: status, color: AppColors.muted),
    };

String _formatDate(DateTime value) =>
    '${value.day.toString().padLeft(2, '0')}/'
    '${value.month.toString().padLeft(2, '0')}/'
    '${value.year}';

class _InvitationCard extends StatelessWidget {
  const _InvitationCard({
    required this.invitation,
    required this.responding,
    required this.onAccept,
    required this.onDecline,
  });

  final TalentInvitation invitation;
  final bool responding;
  final VoidCallback? onAccept;
  final VoidCallback? onDecline;

  @override
  Widget build(BuildContext context) {
    final presentation = _statusPresentation(invitation.status);
    final shift = invitation.shift;
    final message = invitation.message?.trim();
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                backgroundColor: AppColors.tealSoft,
                child: Text(
                  invitation.companyName.isEmpty
                      ? '?'
                      : invitation.companyName.characters.first.toUpperCase(),
                  style: const TextStyle(
                    color: AppColors.teal,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // The company name comes straight from the server as
                    // plain text; rendered with Text (never as markup/HTML).
                    Text(
                      invitation.companyName,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (shift != null) ...[
                      const SizedBox(height: 3),
                      Text(
                        shift.title,
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                decoration: BoxDecoration(
                  color: presentation.color.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Text(
                  presentation.label,
                  style: TextStyle(
                    color: presentation.color,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          if (message != null && message.isNotEmpty) ...[
            const SizedBox(height: 12),
            // Same rule: the invitation message is worker-facing plain
            // text, never interpreted as markup.
            Text(
              message,
              style: const TextStyle(color: AppColors.navy, fontSize: 13),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            invitation.status == 'PENDING'
                ? 'Vence el ${_formatDate(invitation.expiresAt)}'
                : 'Recibida el ${_formatDate(invitation.createdAt)}',
            style: const TextStyle(color: AppColors.muted, fontSize: 11),
          ),
          if (onAccept != null || onDecline != null) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: responding ? null : onAccept,
                  icon: responding
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check_circle_outline_rounded),
                  label: const Text('Aceptar'),
                ),
                OutlinedButton.icon(
                  onPressed: responding ? null : onDecline,
                  icon: const Icon(Icons.close_rounded),
                  label: const Text('Rechazar'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _InvitationsMessage extends StatelessWidget {
  const _InvitationsMessage({
    required this.title,
    required this.message,
    this.onRetry,
  });

  final String title;
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(28),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppColors.border),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      children: [
        const Icon(Icons.mail_outline_rounded, color: AppColors.teal, size: 38),
        const SizedBox(height: 12),
        Text(
          title,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 6),
        Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.muted),
        ),
        if (onRetry != null)
          TextButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'),
          ),
      ],
    ),
  );
}

class _InvitationsScaffold extends StatelessWidget {
  const _InvitationsScaffold({required this.child, this.onRefresh});

  final Widget child;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) => Material(
    color: AppColors.background,
    child: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 920),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 28, 24, 110),
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Invitaciones',
                      style: TextStyle(
                        color: AppColors.navy,
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  IconButton.filledTonal(
                    tooltip: 'Actualizar invitaciones',
                    onPressed: onRefresh,
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'Empresas que te invitaron directamente desde el directorio de talento',
                style: TextStyle(color: AppColors.muted, fontSize: 14),
              ),
              const SizedBox(height: 24),
              child,
            ],
          ),
        ),
      ),
    ),
  );
}
