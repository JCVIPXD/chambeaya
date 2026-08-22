import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/responsive/app_breakpoints.dart';
import '../../theme/app_theme.dart';
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

class WorkerDiscoveryPage extends StatefulWidget {
  const WorkerDiscoveryPage({
    super.key,
    required this.repository,
    this.onApplicationChanged,
  });

  final WorkerMarketplaceRepository repository;
  final VoidCallback? onApplicationChanged;

  @override
  State<WorkerDiscoveryPage> createState() => _WorkerDiscoveryPageState();
}

class _WorkerDiscoveryPageState extends State<WorkerDiscoveryPage> {
  late Future<_DiscoveryBootstrap> _loading;
  DiscoveryController? _controller;
  StreamSubscription<List<Shift>>? _shiftSubscription;
  ClientDemoScenario _scenario = ClientDemoScenario.normal;

  @override
  void initState() {
    super.initState();
    _loading = _loadDiscovery();
  }

  Future<_DiscoveryBootstrap> _loadDiscovery() async {
    final shiftsFuture = widget.repository.availableShifts();
    final savedFuture = widget.repository.savedShiftIds();
    final applicationsFuture = widget.repository.applicationStates();
    return _DiscoveryBootstrap(
      shifts: await shiftsFuture,
      savedShiftIds: await savedFuture,
      applicationStates: await applicationsFuture,
    );
  }

  @override
  void dispose() {
    _shiftSubscription?.cancel();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Material(
    color: AppColors.background,
    child: FutureBuilder<_DiscoveryBootstrap>(
      future: _loading,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const _DiscoveryLoading();
        }
        if (snapshot.hasError) {
          return _DiscoveryError(
            onRetry: () => setState(() => _loading = _loadDiscovery()),
          );
        }
        final data = snapshot.data!;
        if (_controller == null) {
          _controller = DiscoveryController(
            shifts: data.shifts,
            repository: widget.repository,
            savedShiftIds: data.savedShiftIds,
            applicationStates: data.applicationStates,
            onApplicationChanged: widget.onApplicationChanged,
          );
          _shiftSubscription = widget.repository.watchAvailableShifts().listen(
            (shifts) => _controller?.replaceShifts(shifts),
          );
        }
        return AnimatedBuilder(
          animation: _controller!,
          builder: (context, _) => _DiscoveryContent(
            controller: _controller!,
            usesLiveFeed: widget.repository.usesLiveFeed,
            scenario: _scenario,
            onScenarioChanged: (value) => setState(() => _scenario = value),
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
  });

  final List<Shift> shifts;
  final Set<String> savedShiftIds;
  final Map<String, ApplicationState> applicationStates;
}

class _DiscoveryContent extends StatelessWidget {
  const _DiscoveryContent({
    required this.controller,
    required this.usesLiveFeed,
    required this.scenario,
    required this.onScenarioChanged,
  });

  final DiscoveryController controller;
  final bool usesLiveFeed;
  final ClientDemoScenario scenario;
  final ValueChanged<ClientDemoScenario> onScenarioChanged;

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
            onOpenFilters: () => _showFilterSheet(context, controller),
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
                  ),
                ),
                const VerticalDivider(width: 1, color: AppColors.border),
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
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onQueryChanged, required this.onOpenFilters});
  final ValueChanged<String> onQueryChanged;
  final VoidCallback onOpenFilters;

  @override
  Widget build(BuildContext context) => Container(
    height: 86,
    padding: const EdgeInsets.symmetric(horizontal: 28),
    color: Colors.white,
    child: Row(
      children: [
        const Expanded(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Oportunidades para ti',
                style: TextStyle(
                  color: AppColors.navy,
                  fontSize: 21,
                  fontWeight: FontWeight.w900,
                ),
              ),
              SizedBox(height: 3),
              Text(
                'Turnos seleccionados según tu perfil y disponibilidad',
                style: TextStyle(color: AppColors.muted, fontSize: 11),
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
        IconButton(
          tooltip: 'Notificaciones',
          onPressed: () {},
          icon: Badge(
            smallSize: 7,
            backgroundColor: AppColors.gold,
            child: const Icon(
              Icons.notifications_none_rounded,
              color: AppColors.navy,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
          decoration: BoxDecoration(
            color: AppColors.surfaceMuted,
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(24),
          ),
          child: const Row(
            children: [
              CircleAvatar(
                radius: 17,
                backgroundColor: AppColors.navySoft,
                child: Text(
                  'AG',
                  style: TextStyle(
                    color: AppColors.navy,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              SizedBox(width: 8),
              Text(
                'Ana',
                style: TextStyle(
                  color: AppColors.navy,
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

class _ResultsColumn extends StatelessWidget {
  const _ResultsColumn({
    required this.controller,
    required this.usesLiveFeed,
    required this.shifts,
    required this.scenario,
    required this.onScenarioChanged,
    required this.showHeader,
    this.grid = false,
  });
  final DiscoveryController controller;
  final bool usesLiveFeed;
  final List<Shift> shifts;
  final ClientDemoScenario scenario;
  final ValueChanged<ClientDemoScenario> onScenarioChanged;
  final bool showHeader;
  final bool grid;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 18, 20, 100),
    children: [
      if (showHeader) ...[
        const DiscoveryHeader(),
        const SizedBox(height: 20),
        JobSearchBar(
          onChanged: controller.setQuery,
          onOpenFilters: () => _showFilterSheet(context, controller),
        ),
        const SizedBox(height: 12),
      ],
      if (!showHeader) ...[
        const Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Explora turnos',
                    style: TextStyle(
                      color: AppColors.navy,
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Actualizados para ti',
                    style: TextStyle(color: AppColors.muted, fontSize: 10),
                  ),
                ],
              ),
            ),
            _LiveBadge(),
          ],
        ),
        const SizedBox(height: 14),
      ],
      if (usesLiveFeed)
        const LiveMarketplaceBanner()
      else
        ClientDemoBanner(
          scenario: scenario,
          onScenarioChanged: onScenarioChanged,
        ),
      const SizedBox(height: 14),
      JobFilterControls(controller: controller),
      if (controller.state.errorMessage case final message?) ...[
        const SizedBox(height: 12),
        _ErrorNotice(message: message),
      ],
      const SizedBox(height: 20),
      Row(
        children: [
          Expanded(
            child: Text(
              showHeader ? 'Oportunidades para ti' : 'Mejores coincidencias',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: showHeader
                  ? Theme.of(context).textTheme.titleLarge
                  : const TextStyle(
                      color: AppColors.navy,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${shifts.length} resultados',
            style: const TextStyle(color: AppColors.muted, fontSize: 12),
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
            childAspectRatio: 1.35,
          ),
          itemCount: shifts.length,
          itemBuilder: (_, index) => _jobCard(context, shifts[index]),
        )
      else
        ...shifts.map((shift) => _jobCard(context, shift)),
    ],
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
      color: AppColors.tealSoft,
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

void _showFilterSheet(BuildContext context, DiscoveryController controller) =>
    showModalBottomSheet<void>(
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
                JobFilterControls(controller: controller, expanded: true),
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
      onApply: () => controller.applyToShift(shift.id),
    );
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
      color: Colors.white,
      border: Border.all(color: AppColors.border),
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
          style: const TextStyle(color: AppColors.muted),
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
