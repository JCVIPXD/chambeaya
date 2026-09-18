import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/responsive/app_breakpoints.dart';
import '../../theme/app_theme.dart';
import '../../widgets/animated_reveal.dart';
import '../marketplace/marketplace_data.dart';
import '../marketplace/marketplace_repository.dart';
import 'discovery_controller.dart';
import 'discovery_models.dart';
import 'widgets/client_demo_banner.dart';
import 'widgets/discovery_header.dart';
import 'widgets/job_card.dart';
import 'widgets/job_detail_panel.dart';
import 'widgets/job_filter_controls.dart';
import 'widgets/job_search_bar.dart';
import 'search_alert_store.dart';

class WorkerDiscoveryPage extends StatefulWidget {
  WorkerDiscoveryPage({
    super.key,
    required this.repository,
    this.onApplicationChanged,
    this.workerName,
    SearchAlertStore? alertStore,
  }) : alertStore = alertStore ?? InMemorySearchAlertStore();

  final WorkerMarketplaceRepository repository;
  final VoidCallback? onApplicationChanged;
  final String? workerName;
  final SearchAlertStore alertStore;

  @override
  State<WorkerDiscoveryPage> createState() => _WorkerDiscoveryPageState();
}

class _WorkerDiscoveryPageState extends State<WorkerDiscoveryPage> {
  late Future<_DiscoveryBootstrap> _loading;
  DiscoveryController? _controller;
  StreamSubscription<List<Shift>>? _shiftSubscription;
  ClientDemoScenario _scenario = ClientDemoScenario.normal;
  ShiftSearchFilter? _alertFilter;
  bool _isAvailable = true;
  bool _availabilitySaving = false;
  bool _availabilityHydrated = false;

  @override
  void initState() {
    super.initState();
    _loading = _loadDiscovery();
  }

  Future<_DiscoveryBootstrap> _loadDiscovery() async {
    final shiftsFuture = widget.repository.availableShifts();
    final savedFuture = widget.repository.savedShiftIds();
    final applicationsFuture = widget.repository.applicationStates();
    final availabilityFuture = widget.repository.workerAvailability();
    return _DiscoveryBootstrap(
      shifts: await shiftsFuture,
      savedShiftIds: await savedFuture,
      applicationStates: await applicationsFuture,
      alertFilter: await widget.alertStore.read(),
      isAvailable: await availabilityFuture,
    );
  }

  Future<void> _setAvailability(bool value) async {
    if (_availabilitySaving) return;
    final previous = _isAvailable;
    setState(() {
      _isAvailable = value;
      _availabilitySaving = true;
    });
    try {
      await widget.repository.updateAvailability(value);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isAvailable = previous);
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(
          content: Text('No pudimos actualizar tu disponibilidad.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _availabilitySaving = false);
    }
  }

  Future<void> _saveAlert() async {
    final filter = _controller?.state.filter;
    if (filter == null || !filter.hasActiveFilters) {
      if (mounted) {
        if (Scaffold.maybeOf(context) != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Activa al menos un filtro para crear una alerta.'),
            ),
          );
        }
      }
      return;
    }
    await widget.alertStore.save(filter);
    if (!mounted) return;
    setState(() => _alertFilter = filter);
    if (Scaffold.maybeOf(context) != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Alerta guardada. Te avisaremos cuando aparezcan coincidencias.',
          ),
        ),
      );
    }
  }

  Future<void> _clearAlert() async {
    await widget.alertStore.clear();
    if (!mounted) return;
    setState(() => _alertFilter = null);
  }

  @override
  void dispose() {
    _shiftSubscription?.cancel();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Material(
    color: context.palette.background,
    child: FutureBuilder<_DiscoveryBootstrap>(
      future: _loading,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const _DiscoveryLoading();
        }
        if (snapshot.hasError) {
          return _DiscoveryError(
            // Block body: `setState` asserts (debug) if its callback returns
            // the `Future` that an arrow-bodied assignment would return.
            onRetry: () => setState(() {
              _loading = _loadDiscovery();
            }),
          );
        }
        final data = snapshot.data!;
        if (!_availabilityHydrated) {
          _isAvailable = data.isAvailable;
          _availabilityHydrated = true;
        }
        _alertFilter ??= data.alertFilter;
        if (_controller == null) {
          _controller = DiscoveryController(
            shifts: data.shifts,
            repository: widget.repository,
            initialFilter: data.alertFilter ?? const ShiftSearchFilter(),
            savedShiftIds: data.savedShiftIds,
            applicationStates: data.applicationStates,
            onApplicationChanged: widget.onApplicationChanged,
          );
          _shiftSubscription = widget.repository.watchAvailableShifts().listen((
            shifts,
          ) {
            _controller?.replaceShifts(shifts);
            widget.repository.applicationStates().then(
              (states) => _controller?.replaceApplicationStates(states),
            );
          });
        }
        return AnimatedBuilder(
          animation: _controller!,
          builder: (context, _) => _DiscoveryContent(
            controller: _controller!,
            usesLiveFeed: widget.repository.usesLiveFeed,
            scenario: _scenario,
            onScenarioChanged: (value) => setState(() => _scenario = value),
            hasSavedAlert: _alertFilter != null,
            onSaveAlert: _saveAlert,
            onClearAlert: _clearAlert,
            isAvailable: _isAvailable,
            availabilitySaving: _availabilitySaving,
            onAvailabilityChanged: _setAvailability,
            workerName: widget.workerName,
          ),
        );
      },
    ),
  );
}

class _DiscoveryBootstrap {
  const _DiscoveryBootstrap({
    required this.shifts,
    required this.savedShiftIds,
    required this.applicationStates,
    required this.alertFilter,
    required this.isAvailable,
  });

  final List<Shift> shifts;
  final Set<String> savedShiftIds;
  final Map<String, ApplicationState> applicationStates;
  final ShiftSearchFilter? alertFilter;
  final bool isAvailable;
}

class _DiscoveryContent extends StatelessWidget {
  const _DiscoveryContent({
    required this.controller,
    required this.usesLiveFeed,
    required this.scenario,
    required this.onScenarioChanged,
    required this.hasSavedAlert,
    required this.onSaveAlert,
    required this.onClearAlert,
    required this.isAvailable,
    required this.availabilitySaving,
    required this.onAvailabilityChanged,
    this.workerName,
  });

  final DiscoveryController controller;
  final bool usesLiveFeed;
  final ClientDemoScenario scenario;
  final ValueChanged<ClientDemoScenario> onScenarioChanged;
  final bool hasSavedAlert;
  final VoidCallback onSaveAlert;
  final VoidCallback onClearAlert;
  final bool isAvailable;
  final bool availabilitySaving;
  final ValueChanged<bool> onAvailabilityChanged;
  final String? workerName;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final width = media.size.width;
    final layout = classifyLayout(width);
    final useTabletGrid =
        layout == AppLayoutClass.tablet &&
        width >= 760 &&
        media.textScaler.scale(1) <= 1.3;
    final shifts = scenario == ClientDemoScenario.empty
        ? const <Shift>[]
        : controller.filteredShifts;
    if (layout == AppLayoutClass.desktop) {
      return Column(
        children: [
          _TopBar(
            onQueryChanged: controller.setQuery,
            onOpenFilters: () => _showFilterSheet(
              context,
              controller,
              onSaveAlert: onSaveAlert,
              hasSavedAlert: hasSavedAlert,
              onClearAlert: onClearAlert,
            ),
            isAvailable: isAvailable,
            availabilitySaving: availabilitySaving,
            onAvailabilityChanged: onAvailabilityChanged,
            workerName: workerName,
          ),
          Expanded(
            child: Row(
              children: [
                SizedBox(
                  width: 438,
                  child: _ResultsColumn(
                    controller: controller,
                    usesLiveFeed: usesLiveFeed,
                    shifts: shifts,
                    scenario: scenario,
                    onScenarioChanged: onScenarioChanged,
                    showHeader: false,
                    onSaveAlert: onSaveAlert,
                    hasSavedAlert: hasSavedAlert,
                    onClearAlert: onClearAlert,
                    isAvailable: isAvailable,
                    onAvailabilityChanged: onAvailabilityChanged,
                    workerName: workerName,
                  ),
                ),
                VerticalDivider(width: 1, color: context.palette.border),
                Expanded(child: _Detail(controller: controller)),
              ],
            ),
          ),
        ],
      );
    }
    return _ResultsColumn(
      controller: controller,
      usesLiveFeed: usesLiveFeed,
      shifts: shifts,
      scenario: scenario,
      onScenarioChanged: onScenarioChanged,
      showHeader: true,
      grid: useTabletGrid,
      onSaveAlert: onSaveAlert,
      hasSavedAlert: hasSavedAlert,
      onClearAlert: onClearAlert,
      isAvailable: isAvailable,
      onAvailabilityChanged: onAvailabilityChanged,
      workerName: workerName,
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.onQueryChanged,
    required this.onOpenFilters,
    required this.isAvailable,
    required this.availabilitySaving,
    required this.onAvailabilityChanged,
    this.workerName,
  });
  final ValueChanged<String> onQueryChanged;
  final VoidCallback onOpenFilters;
  final bool isAvailable;
  final bool availabilitySaving;
  final ValueChanged<bool> onAvailabilityChanged;
  final String? workerName;

  String get _displayName => (workerName == null || workerName!.trim().isEmpty)
      ? 'Ana'
      : workerName!.trim().split(RegExp(r'\s+')).first;
  String get _initials {
    final parts = (workerName ?? 'Ana García').trim().split(RegExp(r'\s+'));
    return parts.take(2).map((part) => part[0].toUpperCase()).join();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Container(
      height: 86,
      padding: const EdgeInsets.symmetric(horizontal: 28),
      color: palette.surface,
      child: Row(
        children: [
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Oportunidades para ti',
                  style: TextStyle(
                    color: palette.ink,
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  'Turnos seleccionados según tu perfil y disponibilidad',
                  style: TextStyle(color: palette.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          SizedBox(
            width: 390,
            child: JobSearchBar(
              onChanged: onQueryChanged,
              onOpenFilters: onOpenFilters,
            ),
          ),
          const SizedBox(width: 12),
          Tooltip(
            message: isAvailable
                ? 'Disponible para nuevos turnos'
                : 'No disponible para nuevos turnos',
            child: Switch.adaptive(
              value: isAvailable,
              onChanged: availabilitySaving ? null : onAvailabilityChanged,
            ),
          ),
          IconButton(
            tooltip: 'Notificaciones',
            onPressed: () {},
            icon: Badge(
              smallSize: 7,
              backgroundColor: AppColors.gold,
              child: Icon(Icons.notifications_none_rounded, color: palette.ink),
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
            decoration: BoxDecoration(
              color: palette.surfaceMuted,
              border: Border.all(color: palette.border),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 17,
                  backgroundColor: palette.accentSoft,
                  child: Text(
                    _initials,
                    style: TextStyle(
                      color: palette.ink,
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _displayName,
                  style: TextStyle(
                    color: palette.ink,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ResultsColumn extends StatelessWidget {
  const _ResultsColumn({
    required this.controller,
    required this.usesLiveFeed,
    required this.shifts,
    required this.scenario,
    required this.onScenarioChanged,
    required this.showHeader,
    required this.onSaveAlert,
    required this.hasSavedAlert,
    required this.onClearAlert,
    required this.isAvailable,
    required this.onAvailabilityChanged,
    this.workerName,
    this.grid = false,
  });
  final DiscoveryController controller;
  final bool usesLiveFeed;
  final List<Shift> shifts;
  final ClientDemoScenario scenario;
  final ValueChanged<ClientDemoScenario> onScenarioChanged;
  final bool showHeader;
  final VoidCallback onSaveAlert;
  final bool hasSavedAlert;
  final VoidCallback onClearAlert;
  final bool grid;
  final bool isAvailable;
  final ValueChanged<bool> onAvailabilityChanged;
  final String? workerName;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 18, 20, 100),
    children: [
      if (showHeader) ...[
        DiscoveryHeader(
          isAvailable: isAvailable,
          onAvailabilityChanged: onAvailabilityChanged,
          workerName: workerName,
        ),
        const SizedBox(height: 20),
        JobSearchBar(
          onChanged: controller.setQuery,
          onOpenFilters: () => _showFilterSheet(
            context,
            controller,
            onSaveAlert: onSaveAlert,
            hasSavedAlert: hasSavedAlert,
            onClearAlert: onClearAlert,
          ),
        ),
        const SizedBox(height: 12),
      ],
      if (!showHeader) ...[
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Explora turnos',
                    style: TextStyle(
                      color: context.palette.ink,
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Actualizados para ti',
                    style: TextStyle(
                      color: context.palette.muted,
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ),
            const _LiveBadge(),
          ],
        ),
        const SizedBox(height: 14),
      ],
      AnimatedSwitcher(
        duration: const Duration(milliseconds: 240),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        child: usesLiveFeed
            ? const LiveMarketplaceBanner(key: ValueKey('live-feed'))
            : ClientDemoBanner(
                key: ValueKey(scenario),
                scenario: scenario,
                onScenarioChanged: onScenarioChanged,
              ),
      ),
      const SizedBox(height: 14),
      JobFilterControls(
        controller: controller,
        onSaveAlert: onSaveAlert,
        hasSavedAlert: hasSavedAlert,
        onClearAlert: onClearAlert,
      ),
      if (controller.state.errorMessage case final message?) ...[
        const SizedBox(height: 12),
        _ErrorNotice(message: message),
      ],
      const SizedBox(height: 20),
      Row(
        children: [
          Expanded(
            child: Text(
              showHeader
                  ? 'Oportunidades para ti'
                  : controller.shifts.any((shift) => shift.match != null)
                  ? 'Mejores coincidencias'
                  : 'Turnos disponibles',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: showHeader
                  ? Theme.of(context).textTheme.titleLarge
                  : TextStyle(
                      color: context.palette.ink,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
            ),
          ),
          const SizedBox(width: 8),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            transitionBuilder: (child, animation) => FadeTransition(
              opacity: animation,
              child: SlideTransition(
                position: Tween<Offset>(
                  begin: const Offset(0, .18),
                  end: Offset.zero,
                ).animate(animation),
                child: child,
              ),
            ),
            child: Text(
              '${shifts.length} resultados',
              key: ValueKey(shifts.length),
              style: TextStyle(color: context.palette.muted, fontSize: 12),
            ),
          ),
        ],
      ),
      const SizedBox(height: 13),
      if (scenario == ClientDemoScenario.error)
        const _InlineState(
          icon: Icons.cloud_off_outlined,
          title: 'No pudimos actualizar los empleos',
          message:
              'Este escenario simula una conexión interrumpida. Cambia a resultados normales para continuar.',
        )
      else if (shifts.isEmpty)
        _InlineState(
          icon: Icons.search_off_rounded,
          title: 'No encontramos resultados',
          message: 'Prueba limpiando filtros o buscando otro distrito.',
          action: controller.clearFilters,
        )
      else if (grid)
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            // JobCard has variable content (including the employer-provided
            // title and status chips). A fixed aspect ratio made the card
            // shorter than its contents on tablet widths and caused the
            // visible "BOTTOM OVERFLOWED" debug banner.
            mainAxisExtent: 356,
          ),
          itemCount: shifts.length,
          itemBuilder: (_, index) =>
              _animatedJobCard(context, shifts[index], index),
        )
      else
        ...shifts.indexed.map(
          (entry) => _animatedJobCard(context, entry.$2, entry.$1),
        ),
    ],
  );

  Widget _animatedJobCard(BuildContext context, Shift shift, int index) =>
      AnimatedReveal(
        key: ValueKey('shift-card-${shift.id}'),
        delay: Duration(milliseconds: (index * 45).clamp(0, 260).toInt()),
        child: _jobCard(context, shift),
      );

  Widget _jobCard(BuildContext context, Shift shift) => JobCard(
    shift: shift,
    selected: controller.state.selectedShiftId == shift.id,
    saved: controller.state.savedShiftIds.contains(shift.id),
    applicationState:
        controller.state.applicationStates[shift.id] ??
        ApplicationState.notApplied,
    onSelected: () {
      controller.selectShift(shift.id);
      if (classifyLayout(MediaQuery.sizeOf(context).width) !=
          AppLayoutClass.desktop) {
        showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (_) => FractionallySizedBox(
            heightFactor: .88,
            child: AnimatedBuilder(
              animation: controller,
              builder: (_, _) => _Detail(controller: controller),
            ),
          ),
        );
      }
    },
    onToggleSaved: () => controller.toggleSaved(shift.id),
  );
}

class _LiveBadge extends StatelessWidget {
  const _LiveBadge();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
    decoration: BoxDecoration(
      color: context.palette.accentSoft,
      borderRadius: BorderRadius.circular(20),
    ),
    child: const Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.circle, color: AppColors.teal, size: 7),
        SizedBox(width: 5),
        Text(
          'EN VIVO',
          style: TextStyle(
            color: AppColors.tealDark,
            fontSize: 8,
            fontWeight: FontWeight.w900,
            letterSpacing: .5,
          ),
        ),
      ],
    ),
  );
}

class _ErrorNotice extends StatelessWidget {
  const _ErrorNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF4E5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded, color: Color(0xFF9A5B00)),
          const SizedBox(width: 8),
          Expanded(child: Text(message)),
        ],
      ),
    ),
  );
}

void _showFilterSheet(
  BuildContext context,
  DiscoveryController controller, {
  VoidCallback? onSaveAlert,
  bool hasSavedAlert = false,
  VoidCallback? onClearAlert,
}) => showModalBottomSheet<void>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (_) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) => SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Filtros de búsqueda',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            JobFilterControls(
              controller: controller,
              expanded: true,
              onSaveAlert: onSaveAlert,
              hasSavedAlert: hasSavedAlert,
              onClearAlert: onClearAlert,
            ),
          ],
        ),
      ),
    ),
  ),
);

class _Detail extends StatelessWidget {
  const _Detail({required this.controller});
  final DiscoveryController controller;

  @override
  Widget build(BuildContext context) {
    final shift = controller.selectedShift;
    if (shift == null) {
      return const Center(
        child: Text('Selecciona un turno para ver sus detalles.'),
      );
    }
    return JobDetailPanel(
      shift: shift,
      saved: controller.state.savedShiftIds.contains(shift.id),
      applicationState:
          controller.state.applicationStates[shift.id] ??
          ApplicationState.notApplied,
      onToggleSaved: () => controller.toggleSaved(shift.id),
      onApply: () => _apply(context, shift),
    );
  }

  Future<void> _apply(BuildContext context, Shift shift) async {
    if (shift.screeningQuestions.isEmpty) {
      await controller.applyToShift(shift.id);
      return;
    }
    final draftAnswers = <String, String>{};
    final answers = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Completa tu postulación'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'La empresa revisará estas respuestas junto con tu perfil.',
              ),
              const SizedBox(height: 16),
              for (final question in shift.screeningQuestions) ...[
                TextField(
                  onChanged: (value) => draftAnswers[question] = value,
                  maxLength: 1000,
                  minLines: 2,
                  maxLines: 4,
                  decoration: InputDecoration(
                    labelText: question,
                    alignLabelWithHint: true,
                  ),
                ),
                const SizedBox(height: 8),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Volver'),
          ),
          FilledButton(
            onPressed: () {
              final values = {
                for (final question in shift.screeningQuestions)
                  question: draftAnswers[question]?.trim() ?? '',
              };
              if (values.values.any((answer) => answer.isEmpty)) return;
              Navigator.pop(dialogContext, values);
            },
            child: const Text('Enviar postulación'),
          ),
        ],
      ),
    );
    if (answers != null && context.mounted) {
      await controller.applyToShift(shift.id, answers: answers);
    }
  }
}

class _InlineState extends StatelessWidget {
  const _InlineState({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });
  final IconData icon;
  final String title;
  final String message;
  final VoidCallback? action;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      color: context.palette.surface,
      border: Border.all(color: context.palette.border),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      children: [
        Icon(icon, color: AppColors.teal, size: 42),
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
        if (action != null)
          TextButton.icon(
            onPressed: action,
            icon: const Icon(Icons.restart_alt_rounded),
            label: const Text('Limpiar filtros'),
          ),
      ],
    ),
  );
}

class _DiscoveryLoading extends StatelessWidget {
  const _DiscoveryLoading();
  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      label: 'Cargando oportunidades',
      child: const CircularProgressIndicator(),
    ),
  );
}

class _DiscoveryError extends StatelessWidget {
  const _DiscoveryError({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: _InlineState(
        icon: Icons.cloud_off_outlined,
        title: 'No pudimos cargar los empleos',
        message: 'La conexión con el servicio local no está disponible.',
        action: onRetry,
      ),
    ),
  );
}
