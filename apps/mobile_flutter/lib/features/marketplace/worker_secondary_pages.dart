import 'dart:async';

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../discovery/discovery_models.dart';
import 'marketplace_data.dart';
import 'marketplace_repository.dart';

class WorkerApplicationsPage extends StatefulWidget {
  const WorkerApplicationsPage({super.key, required this.repository});

  final WorkerMarketplaceRepository repository;

  @override
  State<WorkerApplicationsPage> createState() => _WorkerApplicationsPageState();
}

class _WorkerApplicationsPageState extends State<WorkerApplicationsPage> {
  late Future<_ApplicationsData> _loading;
  Timer? _refreshTimer;
  final Set<String> _confirmed = {};
  final Set<String> _checkedIn = {};
  final Set<String> _checkedOut = {};
  final Set<String> _cancelled = {};

  @override
  void initState() {
    super.initState();
    _loading = _load();
    // Decisions are made from the business panel, so there is no local user
    // action that can invalidate this view. Poll while the shell keeps this
    // page alive in its IndexedStack to reflect accept/reject decisions
    // without requiring a full reload.
    _refreshTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted) return;
      setState(() => _loading = _load());
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _SecondaryPage(
    title: 'Mis postulaciones',
    subtitle: 'Sigue cada proceso sin perder ninguna actualización',
    child: FutureBuilder<_ApplicationsData>(
      future: _loading,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return _MessageState(
            title: 'No pudimos cargar tus postulaciones',
            message: 'Verifica tu conexión e inténtalo nuevamente.',
            onRetry: () => setState(() => _loading = _load()),
          );
        }
        final data = snapshot.data;
        if (data == null || data.states.isEmpty) {
          return const _ApplicationsEmpty();
        }
        final accepted = data.states.values
            .where((state) => state == ApplicationState.accepted)
            .length;
        final finished = data.shifts.where((shift) => shift.checkedOut).length;
        return Column(
          children: [
            _WorkerJourney(accepted: accepted, finished: finished),
            const SizedBox(height: 16),
            ...data.states.entries.map((entry) {
              final shift = data.shifts
                  .where((item) => item.id == entry.key)
                  .firstOrNull;
              if (shift == null) return const SizedBox.shrink();
              final presentation = _cancelled.contains(shift.id)
                  ? _applicationPresentation(ApplicationState.closed)
                  : _applicationPresentation(entry.value);
              final confirmed =
                  shift.assignmentConfirmed || _confirmed.contains(shift.id);
              final checkedIn =
                  shift.checkedIn || _checkedIn.contains(shift.id);
              final checkedOut =
                  shift.checkedOut || _checkedOut.contains(shift.id);
              return _ApplicationCard(
                shift: shift,
                company: shift.company,
                role: shift.title,
                status: presentation.label,
                statusColor: presentation.color,
                progress: presentation.progress,
                nextStep: _operationalNextStep(
                  entry.value,
                  confirmed: confirmed,
                  checkedIn: checkedIn,
                  checkedOut: checkedOut,
                ),
                schedule: shift.schedule,
                location: shift.location,
                pay: shift.workerPayCents,
                confirmed: confirmed,
                checkedIn: checkedIn,
                checkedOut: checkedOut,
                onConfirm:
                    entry.value == ApplicationState.accepted && !confirmed
                    ? () => _confirm(shift.id)
                    : null,
                onCheckIn:
                    entry.value == ApplicationState.accepted &&
                        confirmed &&
                        !checkedIn
                    ? () => _checkIn(shift)
                    : null,
                onCheckOut: checkedIn && !checkedOut
                    ? () => _checkOut(shift.id)
                    : null,
                onCancel:
                    (entry.value == ApplicationState.submitted ||
                            entry.value == ApplicationState.accepted) &&
                        !checkedIn &&
                        !checkedOut &&
                        !_cancelled.contains(shift.id)
                    ? () => _cancel(shift.id)
                    : null,
              );
            }).toList(),
          ],
        );
      },
    ),
  );

  Future<_ApplicationsData> _load() async {
    // Cargamos primero los estados: el repositorio HTTP conserva los turnos
    // aceptados aunque ya no aparezcan en el feed público de oportunidades.
    final states = await widget.repository.applicationStates();
    return _ApplicationsData(
      shifts: await widget.repository.availableShifts(),
      states: states,
    );
  }

  Future<void> _confirm(String shiftId) async {
    try {
      await widget.repository.confirmAssignment(shiftId);
      if (!mounted) return;
      setState(() => _confirmed.add(shiftId));
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Asistencia confirmada.')));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No pudimos confirmar la asignación.')),
        );
      }
    }
  }

  Future<void> _checkIn(Shift shift) async {
    final credential = shift.checkInCredential;
    if (credential == null || credential.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Aún no hay una credencial de check-in disponible.'),
        ),
      );
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Confirmar llegada'),
        content: Text(
          '¿Ya estás en ${shift.location} para iniciar el turno de ${shift.company}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Todavía no'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Sí, registrar llegada'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await widget.repository.checkIn(shift.id, credential);
      if (!mounted) return;
      setState(() => _checkedIn.add(shift.id));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Llegada registrada correctamente.')),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No pudimos registrar el check-in.')),
        );
      }
    }
  }

  Future<void> _checkOut(String shiftId) async {
    try {
      await widget.repository.checkOut(shiftId);
      if (!mounted) return;
      setState(() => _checkedOut.add(shiftId));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Salida registrada correctamente.')),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No pudimos finalizar el turno.')),
        );
      }
    }
  }

  Future<void> _cancel(String shiftId) async {
    final reasonController = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cancelar postulación'),
        content: TextField(
          controller: reasonController,
          autofocus: true,
          maxLength: 500,
          decoration: const InputDecoration(labelText: 'Motivo'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Volver'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, reasonController.text),
            child: const Text('Cancelar'),
          ),
        ],
      ),
    );
    reasonController.dispose();
    if (reason == null || reason.trim().length < 3) return;
    try {
      await widget.repository.cancelApplication(shiftId, reason);
      if (!mounted) return;
      setState(() => _cancelled.add(shiftId));
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Postulación cancelada.')));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No pudimos cancelar la postulación.')),
        );
      }
    }
  }
}

class _ApplicationsData {
  const _ApplicationsData({required this.shifts, required this.states});
  final List<Shift> shifts;
  final Map<String, ApplicationState> states;
}

class _WorkerJourney extends StatelessWidget {
  const _WorkerJourney({required this.accepted, required this.finished});

  final int accepted;
  final int finished;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: AppColors.tealSoft,
      border: Border.all(color: const Color(0xFFBFEFE4)),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Tu ruta en CumpleNow',
          style: TextStyle(color: AppColors.navy, fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 4),
        Text(
          accepted == 0
              ? 'Postula y espera una selección para continuar.'
              : '$accepted turno${accepted == 1 ? '' : 's'} seleccionado${accepted == 1 ? '' : 's'} · $finished finalizado${finished == 1 ? '' : 's'}',
          style: const TextStyle(color: AppColors.muted, fontSize: 11),
        ),
        const SizedBox(height: 14),
        Row(
          children: const [
            _JourneyStep(label: 'Postula', active: true),
            _JourneyConnector(),
            _JourneyStep(label: 'Confirma', active: true),
            _JourneyConnector(),
            _JourneyStep(label: 'Cumple', active: true),
            _JourneyConnector(),
            _JourneyStep(label: 'Cobra', active: false),
          ],
        ),
      ],
    ),
  );
}

class _JourneyStep extends StatelessWidget {
  const _JourneyStep({required this.label, required this.active});
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        CircleAvatar(
          radius: 11,
          backgroundColor: active ? AppColors.teal : Colors.white,
          child: Icon(
            active ? Icons.check_rounded : Icons.payments_outlined,
            color: active ? Colors.white : AppColors.muted,
            size: 14,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: active ? AppColors.navy : AppColors.muted,
            fontSize: 9,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    ),
  );
}

class _JourneyConnector extends StatelessWidget {
  const _JourneyConnector();

  @override
  Widget build(BuildContext context) =>
      const Expanded(child: Divider(color: AppColors.teal, thickness: 1));
}

({String label, Color color, double progress, String nextStep})
_applicationPresentation(ApplicationState state) => switch (state) {
  ApplicationState.submitted => (
    label: 'Postulación enviada',
    color: const Color(0xFF4F46E5),
    progress: .3,
    nextStep: 'Espera la decisión de la empresa',
  ),
  ApplicationState.reviewing => (
    label: 'En revisión',
    color: AppColors.gold,
    progress: .55,
    nextStep: 'La empresa está revisando tu postulación',
  ),
  ApplicationState.accepted => (
    label: 'Seleccionado',
    color: AppColors.teal,
    progress: 1,
    nextStep: 'Confirma que asistirás al turno',
  ),
  ApplicationState.closed => (
    label: 'Proceso cerrado',
    color: AppColors.muted,
    progress: 1,
    nextStep: 'Puedes seguir buscando nuevas oportunidades',
  ),
  ApplicationState.notApplied => (
    label: 'Sin postular',
    color: AppColors.muted,
    progress: 0,
    nextStep: 'Completa tu postulación para continuar',
  ),
};

String _operationalNextStep(
  ApplicationState state, {
  required bool confirmed,
  required bool checkedIn,
  required bool checkedOut,
}) {
  if (state != ApplicationState.accepted) {
    return _applicationPresentation(state).nextStep;
  }
  if (checkedOut) return 'Turno finalizado; revisa el estado de tu pago';
  if (checkedIn) return 'Cuando termines tus tareas, registra tu salida';
  if (confirmed) return 'Registra tu llegada al llegar a la sede';
  return 'Confirma que asistirás al turno';
}

class _ApplicationsEmpty extends StatelessWidget {
  const _ApplicationsEmpty();
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(28),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppColors.border),
      borderRadius: BorderRadius.circular(16),
    ),
    child: const Column(
      children: [
        Icon(Icons.work_history_outlined, color: AppColors.teal, size: 44),
        SizedBox(height: 12),
        Text(
          'Aún no tienes postulaciones',
          style: TextStyle(color: AppColors.navy, fontWeight: FontWeight.w800),
        ),
        SizedBox(height: 6),
        Text(
          'Explora oportunidades y postula al turno que mejor encaje contigo.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.muted),
        ),
      ],
    ),
  );
}

class WorkerMessagesPage extends StatefulWidget {
  const WorkerMessagesPage({super.key, required this.repository});
  final WorkerMarketplaceRepository repository;

  @override
  State<WorkerMessagesPage> createState() => _WorkerMessagesPageState();
}

class _WorkerMessagesPageState extends State<WorkerMessagesPage> {
  late Future<List<WorkerConversationRecord>> _loading;
  Timer? _refreshTimer;
  var _refreshing = false;
  @override
  void initState() {
    super.initState();
    _refreshing = true;
    _loading = widget.repository.workerConversations().whenComplete(() {
      _refreshing = false;
    });
    _refreshTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (mounted) _poll();
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _poll() async {
    if (_refreshing) return;
    _refreshing = true;
    try {
      final conversations = await widget.repository.workerConversations();
      if (mounted) {
        setState(() => _loading = Future.value(conversations));
      }
    } catch (_) {
    } finally {
      _refreshing = false;
    }
  }

  @override
  Widget build(BuildContext context) => _SecondaryPage(
    title: 'Conversaciones',
    subtitle: 'Comunicación directa y segura con empresas verificadas',
    trailing: IconButton.filledTonal(
      tooltip: 'Actualizar mensajes',
      onPressed: () => _poll(),
      icon: const Icon(Icons.refresh_rounded),
    ),
    child: FutureBuilder<List<WorkerConversationRecord>>(
      future: _loading,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return _MessageState(
            onRetry: () => setState(
              () => _loading = widget.repository.workerConversations(),
            ),
            title: 'No pudimos cargar tus mensajes',
            message: 'Revisa tu conexión e inténtalo nuevamente.',
          );
        }
        final conversations =
            snapshot.data ?? const <WorkerConversationRecord>[];
        if (conversations.isEmpty) {
          return const _MessageState(
            title: 'Aún no tienes conversaciones',
            message:
                'Cuando te postules a un turno, podrás coordinar directamente con la empresa.',
          );
        }
        return Column(
          children: conversations.map((conversation) {
            return _ConversationTile(
              record: conversation,
              onTap: () {
                showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => _ConversationSheet(
                    repository: widget.repository,
                    conversationId: conversation.id,
                  ),
                );
              },
            );
          }).toList(),
        );
      },
    ),
  );
}

class _MessageState extends StatelessWidget {
  const _MessageState({
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
        const Icon(Icons.forum_outlined, color: AppColors.teal, size: 38),
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

class _ConversationSheet extends StatefulWidget {
  const _ConversationSheet({
    required this.repository,
    required this.conversationId,
  });
  final WorkerMarketplaceRepository repository;
  final String conversationId;
  @override
  State<_ConversationSheet> createState() => _ConversationSheetState();
}

class _ConversationSheetState extends State<_ConversationSheet> {
  WorkerConversationRecord? _conversation;
  final _composer = TextEditingController();
  Timer? _refreshTimer;
  var _loading = true;
  var _sending = false;
  var _refreshing = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
    _refreshTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (mounted && !_loading && !_sending) _load();
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _composer.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (_refreshing) return;
    _refreshing = true;
    if (mounted) setState(() => _error = null);
    try {
      final value = await widget.repository.workerConversation(
        widget.conversationId,
      );
      if (mounted) {
        setState(() {
          _conversation = value;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'No pudimos cargar la conversación.';
        });
      }
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _send() async {
    final body = _composer.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await widget.repository.sendWorkerMessage(widget.conversationId, body);
      _composer.clear();
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(
          const SnackBar(content: Text('No se pudo enviar el mensaje.')),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final content = _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
        ? _MessageState(
            title: _error!,
            message: 'Verifica tu conexión e inténtalo nuevamente.',
            onRetry: _load,
          )
        : _conversation == null
        ? const _MessageState(
            title: 'Conversación no disponible',
            message: 'La conversación ya no está disponible.',
          )
        : Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 12, 12),
                child: Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: AppColors.tealSoft,
                      child: Text(
                        _conversation!.company.characters.first.toUpperCase(),
                        style: const TextStyle(
                          color: AppColors.teal,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _conversation!.company,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          Text(
                            _conversation!.subject,
                            style: const TextStyle(
                              color: AppColors.muted,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Cerrar conversación',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.all(18),
                  itemCount: _conversation!.messages.length,
                  itemBuilder: (_, index) {
                    final message = _conversation!.messages[index];
                    final mine = message.sender == 'WORKER';
                    return Align(
                      alignment: mine
                          ? Alignment.centerRight
                          : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 9),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 13,
                          vertical: 10,
                        ),
                        constraints: const BoxConstraints(maxWidth: 330),
                        decoration: BoxDecoration(
                          color: mine
                              ? AppColors.tealSoft
                              : AppColors.surfaceMuted,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Text(
                          message.body,
                          style: const TextStyle(
                            color: AppColors.navy,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 8, 14, 14),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _composer,
                        minLines: 1,
                        maxLines: 4,
                        textInputAction: TextInputAction.newline,
                        decoration: const InputDecoration(
                          hintText: 'Escribe un mensaje…',
                          labelText: 'Mensaje',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      onPressed: _sending ? null : _send,
                      icon: _sending
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send_rounded),
                    ),
                  ],
                ),
              ),
            ],
          );
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .78,
          child: content,
        ),
      ),
    );
  }
}

class _SecondaryPage extends StatelessWidget {
  const _SecondaryPage({
    required this.title,
    required this.subtitle,
    required this.child,
    this.trailing,
  });

  final String title;
  final String subtitle;
  final Widget child;
  final Widget? trailing;

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
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.navy,
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  ?trailing,
                ],
              ),
              const SizedBox(height: 6),
              Text(
                subtitle,
                style: const TextStyle(color: AppColors.muted, fontSize: 14),
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

class _ApplicationCard extends StatelessWidget {
  const _ApplicationCard({
    required this.shift,
    required this.company,
    required this.role,
    required this.status,
    required this.statusColor,
    required this.progress,
    required this.nextStep,
    required this.schedule,
    required this.location,
    required this.pay,
    this.confirmed = false,
    this.checkedIn = false,
    this.checkedOut = false,
    this.onConfirm,
    this.onCheckIn,
    this.onCheckOut,
    this.onCancel,
  });
  final Shift shift;
  final String company;
  final String role;
  final String status;
  final Color statusColor;
  final double progress;
  final String nextStep;
  final bool confirmed;
  final bool checkedIn;
  final bool checkedOut;
  final VoidCallback? onConfirm;
  final VoidCallback? onCheckIn;
  final VoidCallback? onCheckOut;
  final VoidCallback? onCancel;
  final String schedule;
  final String location;
  final int pay;

  @override
  Widget build(BuildContext context) => Container(
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
                company.substring(0, 1),
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
                  Text(role, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 3),
                  Text(
                    company,
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text(
                status,
                style: TextStyle(
                  color: statusColor,
                  fontSize: 10,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 12,
          runSpacing: 6,
          children: [
            Text(
              schedule,
              style: const TextStyle(color: AppColors.muted, fontSize: 11),
            ),
            Text(
              location,
              style: const TextStyle(color: AppColors.muted, fontSize: 11),
            ),
            Text(
              'S/ ${(pay / 100).toStringAsFixed(2)}',
              style: const TextStyle(
                color: AppColors.navy,
                fontSize: 11,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 7,
            backgroundColor: AppColors.border,
            color: statusColor,
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            const Icon(
              Icons.next_plan_outlined,
              size: 17,
              color: AppColors.teal,
            ),
            const SizedBox(width: 7),
            Expanded(
              child: Text(
                nextStep,
                style: const TextStyle(
                  color: AppColors.navy,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        if (onConfirm != null ||
            onCheckIn != null ||
            onCheckOut != null ||
            onCancel != null ||
            confirmed ||
            checkedIn ||
            checkedOut) ...[
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (onConfirm != null)
                FilledButton.icon(
                  onPressed: onConfirm,
                  icon: const Icon(Icons.check_circle_outline_rounded),
                  label: const Text('Confirmar asistencia'),
                ),
              if (onCheckIn != null)
                FilledButton.icon(
                  onPressed: onCheckIn,
                  icon: const Icon(Icons.login_rounded),
                  label: const Text('Confirmar llegada'),
                ),
              if (onCheckOut != null)
                FilledButton.icon(
                  onPressed: onCheckOut,
                  icon: const Icon(Icons.logout_rounded),
                  label: const Text('Registrar salida'),
                ),
              if (onCancel != null)
                IconButton(
                  onPressed: onCancel,
                  tooltip: 'Cancelar postulación',
                  icon: const Icon(Icons.close_rounded, color: AppColors.muted),
                ),
              if (checkedOut)
                const Text(
                  'Turno finalizado',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    color: AppColors.teal,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                )
              else if (checkedIn)
                const Text(
                  'Llegada registrada',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    color: AppColors.teal,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                )
              else if (confirmed &&
                  onCheckIn == null &&
                  onCheckOut == null &&
                  !checkedOut)
                const Text(
                  'Asistencia confirmada',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    color: AppColors.teal,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
            ],
          ),
        ],
      ],
    ),
  );
}

String _timeLabel(DateTime value) {
  final now = DateTime.now();
  if (now.difference(value).inHours < 24) {
    return '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
  }
  return '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')}';
}

class _ConversationTile extends StatelessWidget {
  const _ConversationTile({required this.record, required this.onTap});
  final WorkerConversationRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: AppColors.border),
        borderRadius: BorderRadius.circular(15),
      ),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: AppColors.tealSoft,
          child: Text(
            record.company.characters.first.toUpperCase(),
            style: const TextStyle(
              color: AppColors.teal,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        title: Text(
          record.company,
          style: const TextStyle(
            color: AppColors.navy,
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: Text(
          record.messages.isEmpty ? record.subject : record.messages.first.body,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              _timeLabel(record.updatedAt),
              style: const TextStyle(color: AppColors.muted, fontSize: 10),
            ),
            if (record.messages.any(
              (message) =>
                  message.sender == 'BUSINESS' && message.readAt == null,
            )) ...[
              const SizedBox(height: 5),
              CircleAvatar(
                radius: 10,
                backgroundColor: AppColors.teal,
                child: Text(
                  '!',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}
