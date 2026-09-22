import 'dart:async';

import 'package:flutter/foundation.dart' show ValueListenable, listEquals;
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
  static const _pollInterval = Duration(seconds: 3);

  /// A single failed background refresh is usually a network blip that the
  /// next tick (3 s later) fixes: a notice that appeared and vanished that
  /// fast would be a flicker of its own, so it only shows from the second
  /// consecutive failure.
  static const _failuresBeforeNotice = 2;

  // What is on screen. `null` only until the first load succeeds: that (and the
  // explicit "Reintentar") is the only time a loading indicator is shown. Every
  // later refresh is silent: the previous data stays on screen until the
  // response arrives, and the list is rebuilt only if the data really changed.
  _ApplicationsData? _data;
  // The first load (or a "Reintentar") failed and there is nothing to keep on
  // screen. While it is true a later tick that succeeds recovers silently.
  var _loadFailed = false;
  // Consecutive failed refreshes while data is on screen (see
  // [_failuresBeforeNotice]).
  var _refreshFailures = 0;
  // Sequence number of the newest request: a response is applied only if no
  // newer request started meanwhile (a "Reintentar" or the reload that follows
  // an action), so a slow, older answer can never overwrite fresher data.
  var _requestId = 0;
  // A request with the newest id is still in flight: ticks do not stack
  // another one on top of it.
  var _requestPending = false;
  // False while the shell keeps this page mounted but hidden (`IndexedStack`
  // with `TickerMode(enabled: false)` on the other tabs): nobody sees the
  // result, so the poll is skipped.
  var _tabVisible = true;
  ValueListenable<TickerModeData>? _tickerMode;
  Timer? _refreshTimer;
  final Set<String> _confirmed = {};
  final Set<String> _checkedIn = {};
  final Set<String> _checkedOut = {};
  final Set<String> _cancelled = {};

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
    // Decisions are made from the business panel, so there is no local user
    // action that can invalidate this view. Poll while the shell keeps this
    // page alive in its IndexedStack to reflect accept/reject decisions
    // without requiring a full reload.
    _refreshTimer = Timer.periodic(_pollInterval, (_) => _poll());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // `getValuesNotifier` does not subscribe this widget to rebuilds: the
    // visibility only gates the timer, it changes nothing that is painted.
    final notifier = TickerMode.getValuesNotifier(context);
    if (!identical(notifier, _tickerMode)) {
      _tickerMode?.removeListener(_onTickerModeChanged);
      _tickerMode = notifier..addListener(_onTickerModeChanged);
      _tabVisible = notifier.value.enabled;
    }
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _tickerMode?.removeListener(_onTickerModeChanged);
    super.dispose();
  }

  void _onTickerModeChanged() {
    final visible = _tickerMode?.value.enabled ?? true;
    if (visible == _tabVisible) return;
    _tabVisible = visible;
    // Back on screen after being hidden: catch up now instead of showing
    // data up to one interval stale.
    if (visible) _poll();
  }

  void _poll() {
    if (!mounted || !_tabVisible || _requestPending) return;
    unawaited(_refresh());
  }

  /// Loads the applications and, if this is still the newest request and the
  /// page is still there, applies the outcome. Never toggles a loading state
  /// by itself: the initial `_data == null` is the loading state.
  Future<void> _refresh() async {
    final requestId = ++_requestId;
    _requestPending = true;
    final _ApplicationsData data;
    try {
      data = await _load();
    } catch (error) {
      if (mounted && requestId == _requestId) _showFailure(error);
      return;
    } finally {
      if (requestId == _requestId) _requestPending = false;
    }
    // Outside the `try`: an error raised while applying the data must not be
    // mistaken for a failed request.
    if (!mounted || requestId != _requestId) return;
    _showData(data);
  }

  void _showData(_ApplicationsData data) {
    final hadNotice = _refreshFailures >= _failuresBeforeNotice;
    _refreshFailures = 0;
    final changed = _data != data;
    // Same data, nothing else to update: no `setState`, so nothing rebuilds
    // and nothing can flicker.
    if (!changed && !hadNotice && !_loadFailed) return;
    setState(() {
      if (changed) _data = data;
      _loadFailed = false;
    });
  }

  void _showFailure(Object error) {
    // Not silent (an empty `catch` once hid a frozen list), but not visible
    // either: the list on screen stays and the next tick retries.
    debugPrint('WorkerApplicationsPage: no se pudo actualizar: $error');
    if (_data == null) {
      if (!_loadFailed) setState(() => _loadFailed = true);
      return;
    }
    _refreshFailures++;
    if (_refreshFailures == _failuresBeforeNotice) setState(() {});
  }

  @override
  Widget build(BuildContext context) => _SecondaryPage(
    title: 'Mis postulaciones',
    subtitle: 'Sigue cada proceso sin perder ninguna actualización',
    child: _buildContent(),
  );

  Widget _buildContent() {
    final data = _data;
    if (data == null) {
      if (_loadFailed) {
        return _MessageState(
          title: 'No pudimos cargar tus postulaciones',
          message: 'Verifica tu conexión e inténtalo nuevamente.',
          // Block body: `setState` asserts (debug) if its callback returns a
          // `Future`.
          onRetry: () {
            setState(() {
              _loadFailed = false;
            });
            unawaited(_refresh());
          },
        );
      }
      return const Center(child: CircularProgressIndicator());
    }
    if (data.states.isEmpty) {
      return const _ApplicationsEmpty();
    }
    final accepted = data.states.values
        .where((state) => state == ApplicationState.accepted)
        .length;
    final finished = data.shifts.where((shift) => shift.checkedOut).length;
    return Column(
      children: [
        if (_refreshFailures >= _failuresBeforeNotice) ...[
          const _RefreshFailedNotice(
            message:
                'No pudimos actualizar tus postulaciones. Reintentaremos en '
                'unos segundos.',
          ),
          const SizedBox(height: 12),
        ],
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
          final checkedIn = shift.checkedIn || _checkedIn.contains(shift.id);
          final checkedOut = shift.checkedOut || _checkedOut.contains(shift.id);
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
            onConfirm: entry.value == ApplicationState.accepted && !confirmed
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
        }),
      ],
    );
  }

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
    } catch (error) {
      _handleActionError(
        error,
        genericMessage:
            'No pudimos confirmar la asignación. Inténtalo otra vez.',
      );
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
    } catch (error) {
      _handleActionError(
        error,
        genericMessage: 'No pudimos registrar el check-in. Inténtalo otra vez.',
      );
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
    } catch (error) {
      _handleActionError(
        error,
        genericMessage: 'No pudimos finalizar el turno. Inténtalo otra vez.',
      );
    }
  }

  /// Maneja los errores de `confirmAssignment`/`checkIn`/`checkOut`: cuando el
  /// servidor confirma que el turno ya no existe/está disponible (vencido,
  /// cancelado) -código propagado ahora por [MarketplaceApiException] en vez
  /// de perderse detrás de un `StateError` genérico-, no basta con mostrar un
  /// mensaje que invite a reintentar contra una acción que el servidor
  /// siempre va a rechazar: se explica el motivo real y se recarga de
  /// inmediato (en vez de esperar el sondeo periódico de 3 s) para que la
  /// tarjeta se retire o se marque como cerrada tan pronto como sea posible.
  /// La recarga es silenciosa (la lista actual se queda hasta que llegue la
  /// nueva) y tiene prioridad: descarta la respuesta de cualquier sondeo
  /// anterior que siga en vuelo.
  /// Cualquier otro error (de red, credencial inválida, etc.) conserva el
  /// mensaje genérico previo.
  void _handleActionError(Object error, {required String genericMessage}) {
    if (!mounted) return;
    // `CHECK_IN_TOO_EARLY`: la ventana de check-in (30 min antes de que
    // empiece el turno) todavía no abrió. No es "el turno ya no existe" -no
    // se fuerza recarga, el trabajador puede reintentar más tarde- así que
    // amerita un mensaje propio en vez de caer en el genérico "Inténtalo
    // otra vez" (ver MEDIO-2 de CN-20260918-002).
    if (error is MarketplaceApiException && error.code == 'CHECK_IN_TOO_EARLY') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Todavía no puedes registrar tu llegada: la ventana de check-in abre 30 minutos antes del inicio del turno.',
          ),
        ),
      );
      return;
    }
    // `ASSIGNMENT_NOT_ACTIONABLE`: el servidor ya resolvió esta asignación
    // como `NO_SHOW`/`ABANDONED` (ventana de check-in cerrada por tardanza, o
    // check-in sin check-out ya vencido). A diferencia de `CHECK_IN_TOO_EARLY`
    // esto sí es un cierre permanente para esta asignación, así que se
    // recarga de inmediato igual que en el caso "el turno ya no existe".
    if (error is MarketplaceApiException &&
        error.code == 'ASSIGNMENT_NOT_ACTIONABLE') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Ya no puedes hacer esto: la ventana de tu turno se cerró (llegada fuera de tiempo o salida pendiente vencida). Actualizamos tu lista.',
          ),
        ),
      );
      unawaited(_refresh());
      return;
    }
    if (error is MarketplaceApiException && error.isShiftGone) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Este turno ya no está disponible: venció, fue cancelado o ya no existe. Actualizamos tu lista.',
          ),
        ),
      );
      unawaited(_refresh());
      return;
    }
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(genericMessage)));
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

  /// By value, and order-sensitive: the cards are drawn in the iteration order
  /// of [states], so the same entries in another order is a real change.
  @override
  bool operator ==(Object other) =>
      other is _ApplicationsData &&
      listEquals(shifts, other.shifts) &&
      _sameEntriesInOrder(states, other.states);

  @override
  int get hashCode => Object.hash(
    Object.hashAll(shifts),
    Object.hashAll(states.entries.map((e) => Object.hash(e.key, e.value))),
  );

  static bool _sameEntriesInOrder(
    Map<String, ApplicationState> a,
    Map<String, ApplicationState> b,
  ) {
    if (a.length != b.length) return false;
    final left = a.entries.iterator;
    final right = b.entries.iterator;
    while (left.moveNext() && right.moveNext()) {
      if (left.current.key != right.current.key ||
          left.current.value != right.current.value) {
        return false;
      }
    }
    return true;
  }
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
      color: context.palette.accentSoft,
      border: Border.all(color: AppColors.teal.withValues(alpha: .3)),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Tu ruta en Chambeaya',
          style: TextStyle(
            color: context.palette.ink,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          accepted == 0
              ? 'Postula y espera una selección para continuar.'
              : '$accepted turno${accepted == 1 ? '' : 's'} seleccionado${accepted == 1 ? '' : 's'} · $finished finalizado${finished == 1 ? '' : 's'}',
          style: TextStyle(color: context.palette.muted, fontSize: 11),
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
          backgroundColor: active ? AppColors.teal : context.palette.surface,
          child: Icon(
            active ? Icons.check_rounded : Icons.payments_outlined,
            color: active ? Colors.white : context.palette.muted,
            size: 14,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: active ? context.palette.ink : context.palette.muted,
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
      color: context.palette.surface,
      border: Border.all(color: context.palette.border),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      children: [
        const Icon(
          Icons.work_history_outlined,
          color: AppColors.teal,
          size: 44,
        ),
        const SizedBox(height: 12),
        Text(
          'Aún no tienes postulaciones',
          style: TextStyle(
            color: context.palette.ink,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Explora oportunidades y postula al turno que mejor encaje contigo.',
          textAlign: TextAlign.center,
          style: TextStyle(color: context.palette.muted),
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
  // True while the last background refresh failed. The list already on screen
  // is kept as is; the flag only drives a discreet notice and is cleared by
  // the next successful refresh.
  var _refreshFailed = false;
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
        // Block body (see `WorkerApplicationsPage`): returning the `Future`
        // from an arrow body trips `setState`'s debug assertion before the
        // rebuild is scheduled, and the `catch` below swallowed it, so the
        // list silently stopped refreshing.
        setState(() {
          _loading = Future.value(conversations);
          _refreshFailed = false;
        });
      }
    } catch (error) {
      // A failed refresh must not break the screen or wipe the list already
      // shown, and it must not be silent either (an empty `catch` once hid a
      // frozen list). Keep the data, log it and flag the notice; the timer
      // keeps retrying and the next success clears the flag.
      debugPrint('WorkerMessagesPage: no se pudo actualizar: $error');
      if (mounted && !_refreshFailed) {
        setState(() {
          _refreshFailed = true;
        });
      }
    } finally {
      _refreshing = false;
    }
  }

  @override
  Widget build(BuildContext context) => _SecondaryPage(
    title: 'Conversaciones',
    subtitle:
        'Mensajes directos con las empresas de tus turnos y postulaciones',
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
            onRetry: () => setState(() {
              _loading = widget.repository.workerConversations();
              // A poll that failed while this error screen was showing raised
              // the flag; this retry supersedes it, so a successful reload must
              // not keep the "could not refresh" notice on top of fresh data.
              _refreshFailed = false;
            }),
            title: 'No pudimos cargar tus mensajes',
            message: 'Revisa tu conexión e inténtalo nuevamente.',
          );
        }
        final conversations =
            snapshot.data ?? const <WorkerConversationRecord>[];
        final Widget content;
        if (conversations.isEmpty) {
          content = const _MessageState(
            title: 'Aún no tienes conversaciones',
            message: 'Cuando te postules a un turno, podrás coordinar directamente con la empresa.',
          );
        } else {
          content = Column(
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
        }
        if (!_refreshFailed) return content;
        return Column(
          children: [
            const _RefreshFailedNotice(),
            const SizedBox(height: 12),
            content,
          ],
        );
      },
    ),
  );
}

/// Discreet notice shown above the conversations (or applications) while
/// background refreshes are failing. It keeps the last list visible instead of
/// replacing it with the full-screen error state.
class _RefreshFailedNotice extends StatelessWidget {
  const _RefreshFailedNotice({
    this.message =
        'No pudimos actualizar tus mensajes. Reintentaremos en unos segundos.',
  });
  final String message;
  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: context.palette.surfaceMuted,
        border: Border.all(color: context.palette.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.cloud_off_rounded, size: 18, color: context.palette.muted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: context.palette.muted, fontSize: 13),
            ),
          ),
        ],
      ),
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
      color: context.palette.surface,
      border: Border.all(color: context.palette.border),
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
          style: TextStyle(color: context.palette.muted),
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
                      backgroundColor: context.palette.accentSoft,
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
                            style: TextStyle(
                              color: context.palette.muted,
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
                              ? context.palette.accentSoft
                              : context.palette.surfaceMuted,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Text(
                          message.body,
                          style: TextStyle(
                            color: context.palette.ink,
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
    color: context.palette.background,
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
                      style: TextStyle(
                        color: context.palette.ink,
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
                style: TextStyle(color: context.palette.muted, fontSize: 14),
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
      color: context.palette.surface,
      border: Border.all(color: context.palette.border),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              backgroundColor: context.palette.accentSoft,
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
                    style: TextStyle(
                      color: context.palette.muted,
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
              style: TextStyle(color: context.palette.muted, fontSize: 11),
            ),
            Text(
              location,
              style: TextStyle(color: context.palette.muted, fontSize: 11),
            ),
            Text(
              'S/ ${(pay / 100).toStringAsFixed(2)}',
              style: TextStyle(
                color: context.palette.ink,
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
            backgroundColor: context.palette.border,
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
                style: TextStyle(
                  color: context.palette.ink,
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
                  icon: Icon(Icons.close_rounded, color: context.palette.muted),
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
      color: context.palette.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: context.palette.border),
        borderRadius: BorderRadius.circular(15),
      ),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: context.palette.accentSoft,
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
          style: TextStyle(
            color: context.palette.ink,
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
              style: TextStyle(color: context.palette.muted, fontSize: 10),
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
