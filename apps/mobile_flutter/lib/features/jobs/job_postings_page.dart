import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/responsive/app_breakpoints.dart';
import '../../theme/app_theme.dart';
import '../wallet/wallet_page.dart';
import 'job_detail_page.dart';
import 'job_postings_controller.dart';
import 'jobs_format.dart';
import 'jobs_models.dart';
import 'jobs_services.dart';
import 'jobs_widgets.dart';
import 'posting_card.dart';

/// Descubrir puestos fijos: búsqueda, filtros, destacados y paginación.
class JobPostingsPage extends StatefulWidget {
  const JobPostingsPage({
    super.key,
    required this.services,
    this.onApplicationChanged,
    this.debounce = const Duration(milliseconds: 400),
  });

  final JobsServices services;

  /// Avisa que el trabajador postuló (para refrescar "Mis postulaciones").
  final VoidCallback? onApplicationChanged;
  final Duration debounce;

  @override
  State<JobPostingsPage> createState() => _JobPostingsPageState();
}

class _JobPostingsPageState extends State<JobPostingsPage> {
  late final JobPostingsController _controller;
  final _scroll = ScrollController();
  final _search = TextEditingController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _controller = JobPostingsController(widget.services.jobs)..loadFirst();
    _scroll.addListener(_onScroll);
    widget.services.walletController.addListener(_onWallet);
    if (widget.services.walletController.balance == null) {
      widget.services.walletController.refresh();
    }
  }

  void _onWallet() {
    if (mounted) setState(() {});
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    if (_scroll.position.extentAfter < 480) _controller.loadMore();
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(widget.debounce, () {
      _controller.setFilter(_controller.filter.copyWith(query: value));
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    widget.services.walletController.removeListener(_onWallet);
    _scroll.dispose();
    _search.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _openFilters() async {
    final result = await showModalBottomSheet<JobSearchFilter>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _FilterSheet(initial: _controller.filter),
    );
    if (result != null) await _controller.setFilter(result);
  }

  Future<void> _openDetail(JobPosting posting) => Navigator.of(context).push<void>(
    MaterialPageRoute(
      builder: (_) => JobDetailPage(
        services: widget.services,
        posting: posting,
        onApplied: (application) {
          if (!mounted) return;
          _controller.markApplied(posting.id, application);
          widget.onApplicationChanged?.call();
        },
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final wallet = widget.services.walletController;
    return Material(
      color: palette.background,
      child: SafeArea(
        child: ListenableBuilder(
          listenable: _controller,
          builder: (context, _) {
            final columns =
                classifyLayout(MediaQuery.sizeOf(context).width) == AppLayoutClass.mobile ? 1 : 2;
            final items = _controller.items;
            return RefreshIndicator(
              onRefresh: _controller.loadFirst,
              child: ListView(
                controller: _scroll,
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
                children: [
                  Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 1000),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Semantics(
                                  header: true,
                                  child: Text(
                                    'Puestos fijos',
                                    style: TextStyle(
                                      color: palette.ink,
                                      fontSize: 28,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                ),
                              ),
                              if (wallet.balance != null)
                                BalanceChip(
                                  text: formatCoins(wallet.balance!, wallet.currencyName),
                                  onTap: () => openWalletPage(context, widget.services),
                                ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Empleos formales de tiempo completo o parcial',
                            style: TextStyle(color: palette.muted, fontSize: 14),
                          ),
                          const SizedBox(height: 16),
                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _search,
                                  textInputAction: TextInputAction.search,
                                  onChanged: _onQueryChanged,
                                  onSubmitted: (value) {
                                    _debounce?.cancel();
                                    _controller.setFilter(_controller.filter.copyWith(query: value));
                                  },
                                  decoration: const InputDecoration(
                                    labelText: 'Buscar puestos',
                                    hintText: 'Cargo, empresa o palabra clave',
                                    prefixIcon: Icon(Icons.search_rounded),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Tooltip(
                                message: 'Filtros',
                                child: IconButton.filledTonal(
                                  onPressed: _openFilters,
                                  icon: Badge(
                                    isLabelVisible: _controller.filter.hasActiveFilters,
                                    smallSize: 8,
                                    child: const Icon(Icons.tune_rounded),
                                  ),
                                  style: IconButton.styleFrom(minimumSize: const Size(52, 52)),
                                ),
                              ),
                            ],
                          ),
                          if (_controller.filter.hasActiveFilters) ...[
                            const SizedBox(height: 10),
                            _ActiveFilters(
                              filter: _controller.filter,
                              onChanged: _controller.setFilter,
                            ),
                          ],
                          const SizedBox(height: 18),
                          _body(items, columns),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _body(List<JobPosting> items, int columns) {
    if (_controller.loading && items.isEmpty) {
      return const LoadingPanel(label: 'Cargando puestos');
    }
    final error = _controller.error;
    if (error != null) {
      return StatePanel(
        icon: Icons.cloud_off_rounded,
        title: 'No pudimos cargar los puestos',
        message: error.message,
        actionLabel: 'Reintentar',
        onAction: _controller.loadFirst,
      );
    }
    if (_controller.isEmpty) {
      return StatePanel(
        icon: Icons.search_off_rounded,
        title: 'No encontramos puestos',
        message: _controller.filter.hasActiveFilters || _controller.filter.query.isNotEmpty
            ? 'Prueba quitando algún filtro o cambiando la búsqueda.'
            : 'Todavía no hay puestos publicados. Vuelve a revisar pronto.',
        actionLabel: _controller.filter.hasActiveFilters || _controller.filter.query.isNotEmpty
            ? 'Quitar filtros'
            : null,
        onAction: () {
          _search.clear();
          _controller.setFilter(const JobSearchFilter());
        },
      );
    }
    final rows = <Widget>[];
    for (var i = 0; i < items.length; i += columns) {
      final slice = items.skip(i).take(columns).toList();
      rows.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var j = 0; j < columns; j++) ...[
                  if (j > 0) const SizedBox(width: 14),
                  Expanded(
                    child: j < slice.length
                        ? PostingCard(
                            posting: slice[j],
                            onTap: () => _openDetail(slice[j]),
                          )
                        : const SizedBox.shrink(),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ...rows,
        if (_controller.loadingMore) const LoadingPanel(label: 'Cargando más puestos'),
        if (_controller.moreError != null)
          StatePanel(
            icon: Icons.cloud_off_rounded,
            title: 'No pudimos cargar más puestos',
            message: _controller.moreError!.message,
            actionLabel: 'Reintentar',
            onAction: _controller.loadMore,
          )
        else if (_controller.hasMore && !_controller.loadingMore)
          Center(
            child: OutlinedButton(
              onPressed: _controller.loadMore,
              child: const Text('Cargar más puestos'),
            ),
          ),
      ],
    );
  }
}

/// Saldo del trabajador como botón (abre la billetera).
class BalanceChip extends StatelessWidget {
  const BalanceChip({super.key, required this.text, required this.onTap});

  final String text;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Semantics(
      button: true,
      label: 'Tu saldo: $text. Abrir billetera',
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: palette.accentSoft,
            border: Border.all(color: AppColors.teal),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.account_balance_wallet_outlined, size: 18, color: AppColors.teal),
              const SizedBox(width: 6),
              Text(
                text,
                style: TextStyle(color: palette.ink, fontWeight: FontWeight.w900),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActiveFilters extends StatelessWidget {
  const _ActiveFilters({required this.filter, required this.onChanged});

  final JobSearchFilter filter;
  final ValueChanged<JobSearchFilter> onChanged;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
      if (filter.modality != null)
        InputChip(
          label: Text(modalityLabel(filter.modality!)),
          onDeleted: () => onChanged(filter.copyWith(clearModality: true)),
          deleteButtonTooltipMessage: 'Quitar filtro de modalidad',
        ),
      if (filter.workload != null)
        InputChip(
          label: Text(workloadLabel(filter.workload!)),
          onDeleted: () => onChanged(filter.copyWith(clearWorkload: true)),
          deleteButtonTooltipMessage: 'Quitar filtro de jornada',
        ),
      if (filter.contractType != null)
        InputChip(
          label: Text(contractTypeLabel(filter.contractType!)),
          onDeleted: () => onChanged(filter.copyWith(clearContractType: true)),
          deleteButtonTooltipMessage: 'Quitar filtro de contrato',
        ),
      if (filter.minSalarySoles != null)
        InputChip(
          label: Text('Desde ${formatSoles(filter.minSalarySoles! * 100)}'),
          onDeleted: () => onChanged(filter.copyWith(clearMinSalary: true)),
          deleteButtonTooltipMessage: 'Quitar filtro de sueldo',
        ),
      if (filter.location.trim().isNotEmpty)
        InputChip(
          label: Text(filter.location.trim()),
          onDeleted: () => onChanged(filter.copyWith(location: '')),
          deleteButtonTooltipMessage: 'Quitar filtro de ubicación',
        ),
    ],
  );
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.initial});

  final JobSearchFilter initial;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late JobSearchFilter _filter = widget.initial;
  late final TextEditingController _salary = TextEditingController(
    text: widget.initial.minSalarySoles?.toString() ?? '',
  );
  late final TextEditingController _location = TextEditingController(
    text: widget.initial.location,
  );

  @override
  void dispose() {
    _salary.dispose();
    _location.dispose();
    super.dispose();
  }

  Widget _group<T>({
    required String title,
    required List<T> values,
    required T? selected,
    required String Function(T) label,
    required ValueChanged<T?> onSelected,
  }) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.only(top: 14, bottom: 8),
        child: Text(title, style: Theme.of(context).textTheme.titleMedium),
      ),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final value in values)
            ChoiceChip(
              label: Text(label(value)),
              selected: selected == value,
              onSelected: (on) => onSelected(on ? value : null),
            ),
        ],
      ),
    ],
  );

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        0,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text('Filtros', style: Theme.of(context).textTheme.titleLarge),
            ),
            _group<Modality>(
              title: 'Modalidad',
              values: const [Modality.onsite, Modality.remote, Modality.hybrid],
              selected: _filter.modality,
              label: modalityLabel,
              onSelected: (value) => setState(
                () => _filter = value == null
                    ? _filter.copyWith(clearModality: true)
                    : _filter.copyWith(modality: value),
              ),
            ),
            _group<Workload>(
              title: 'Jornada',
              values: const [Workload.fullTime, Workload.partTime],
              selected: _filter.workload,
              label: workloadLabel,
              onSelected: (value) => setState(
                () => _filter = value == null
                    ? _filter.copyWith(clearWorkload: true)
                    : _filter.copyWith(workload: value),
              ),
            ),
            _group<ContractType>(
              title: 'Tipo de contrato',
              values: const [
                ContractType.indefinite,
                ContractType.fixedTerm,
                ContractType.internship,
                ContractType.other,
              ],
              selected: _filter.contractType,
              label: contractTypeLabel,
              onSelected: (value) => setState(
                () => _filter = value == null
                    ? _filter.copyWith(clearContractType: true)
                    : _filter.copyWith(contractType: value),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _salary,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Sueldo mínimo mensual (S/)',
                hintText: 'Por ejemplo 1500',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _location,
              decoration: const InputDecoration(
                labelText: 'Ubicación',
                hintText: 'Distrito o ciudad',
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context, const JobSearchFilter()),
                    child: const Text('Limpiar'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: () {
                      final salary = int.tryParse(_salary.text.trim());
                      Navigator.pop(
                        context,
                        JobSearchFilter(
                          query: _filter.query,
                          modality: _filter.modality,
                          workload: _filter.workload,
                          contractType: _filter.contractType,
                          minSalarySoles: salary != null && salary > 0 ? salary : null,
                          location: _location.text.trim(),
                        ),
                      );
                    },
                    child: const Text('Aplicar filtros'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}
