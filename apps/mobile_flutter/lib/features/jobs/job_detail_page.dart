import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../wallet/wallet_models.dart';
import 'application_detail_page.dart';
import 'apply_sheet.dart';
import 'jobs_errors.dart';
import 'jobs_format.dart';
import 'jobs_models.dart';
import 'jobs_services.dart';
import 'jobs_widgets.dart';

/// Detalle de un puesto fijo con el botón para postular.
class JobDetailPage extends StatefulWidget {
  const JobDetailPage({
    super.key,
    required this.services,
    required this.posting,
    this.onApplied,
  });

  final JobsServices services;

  /// Lo que ya se conoce del puesto (de la lista); se refresca al abrir.
  final JobPosting posting;
  final ValueChanged<MyApplicationRef>? onApplied;

  @override
  State<JobDetailPage> createState() => _JobDetailPageState();
}

class _JobDetailPageState extends State<JobDetailPage> {
  late JobPosting _posting = widget.posting;
  JobsErrorInfo? _loadError;
  bool _gone = false;
  bool _applied = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final fresh = await widget.services.jobs.posting(widget.posting.id);
      if (!mounted) return;
      setState(() {
        _posting = fresh;
        _loadError = null;
        _gone = false;
      });
    } catch (error) {
      if (!mounted) return;
      final info = describeJobsError(error);
      setState(() {
        _loadError = info;
        _gone = info.kind == JobsErrorKind.notFound;
      });
    }
  }

  Future<void> _apply({bool reapplying = false}) async {
    final result = await showApplySheet(
      context,
      services: widget.services,
      posting: _posting,
      reapplying: reapplying,
    );
    if (result == null || !mounted) return;
    final ref = MyApplicationRef(
      id: result.application.id,
      status: result.application.status,
    );
    setState(() {
      _applied = true;
      _posting = _withApplication(ref);
    });
    widget.onApplied?.call(ref);
    final currency = widget.services.walletController.currencyName;
    final message = result.idempotent
        ? 'Ya tenías esta postulación.'
        : result.reopened
        ? 'Volviste a postular. No se cobró de nuevo.'
        : result.chargedAmount > 0
        ? 'Postulación enviada. Se descontaron ${formatCoins(result.chargedAmount, currency)}.'
        : 'Postulación enviada. No tuvo costo.';
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  JobPosting _withApplication(MyApplicationRef ref) => JobPosting(
    id: _posting.id,
    title: _posting.title,
    description: _posting.description,
    responsibilities: _posting.responsibilities,
    requirements: _posting.requirements,
    benefits: _posting.benefits,
    modality: _posting.modality,
    workload: _posting.workload,
    salary: _posting.salary,
    location: _posting.location,
    contractType: _posting.contractType,
    expectedStartDate: _posting.expectedStartDate,
    vacanciesRemaining: _posting.vacanciesRemaining,
    screeningQuestions: _posting.screeningQuestions,
    publishedAt: _posting.publishedAt,
    isHighlighted: _posting.isHighlighted,
    companyName: _posting.companyName,
    myApplication: ref,
  );

  void _openApplication(String id) {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ApplicationDetailPage(
          services: widget.services,
          applicationId: id,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final posting = _posting;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Detalle del puesto'),
        actions: [
          IconButton(
            tooltip: 'Actualizar puesto',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 820),
            child: Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                    children: [
                      if (_loadError != null) ...[
                        StatePanel(
                          icon: _gone ? Icons.work_off_outlined : Icons.cloud_off_rounded,
                          title: _gone
                              ? 'Este puesto ya no está disponible'
                              : 'No pudimos actualizar el puesto',
                          message: _gone
                              ? 'La empresa pudo cerrarlo o ya se cubrieron las vacantes.'
                              : _loadError!.message,
                          actionLabel: _gone ? null : 'Reintentar',
                          onAction: _gone ? null : _refresh,
                        ),
                        const SizedBox(height: 14),
                      ],
                      _Header(posting: posting),
                      const SizedBox(height: 14),
                      SectionCard(
                        title: 'Datos del puesto',
                        icon: Icons.fact_check_outlined,
                        child: Column(
                          children: [
                            FactRow(label: 'Sueldo mensual', value: formatSalaryRange(posting.salary)),
                            FactRow(label: 'Jornada', value: workloadLabel(posting.workload)),
                            FactRow(label: 'Modalidad', value: modalityLabel(posting.modality)),
                            FactRow(label: 'Ubicación', value: posting.location),
                            FactRow(label: 'Contrato', value: contractTypeLabel(posting.contractType)),
                            FactRow(
                              label: 'Fecha de ingreso',
                              value: formatCalendarDate(posting.expectedStartDate),
                            ),
                            FactRow(
                              label: 'Vacantes libres',
                              value: '${posting.vacanciesRemaining}',
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                      SectionCard(
                        title: 'Descripción',
                        icon: Icons.description_outlined,
                        child: LongText(posting.description),
                      ),
                      if (_has(posting.responsibilities)) ...[
                        const SizedBox(height: 14),
                        SectionCard(
                          title: 'Responsabilidades',
                          icon: Icons.checklist_rounded,
                          child: LongText(posting.responsibilities!),
                        ),
                      ],
                      if (_has(posting.requirements)) ...[
                        const SizedBox(height: 14),
                        SectionCard(
                          title: 'Requisitos',
                          icon: Icons.rule_rounded,
                          child: LongText(posting.requirements!),
                        ),
                      ],
                      if (_has(posting.benefits)) ...[
                        const SizedBox(height: 14),
                        SectionCard(
                          title: 'Beneficios',
                          icon: Icons.card_giftcard_rounded,
                          child: LongText(posting.benefits!),
                        ),
                      ],
                      if (posting.screeningQuestions.isNotEmpty) ...[
                        const SizedBox(height: 14),
                        SectionCard(
                          title: 'Preguntas de la empresa',
                          subtitle:
                              'Las responderás al postular (${posting.screeningQuestions.length}).',
                          icon: Icons.help_outline_rounded,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              for (final question in posting.screeningQuestions)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Text('• $question', style: TextStyle(color: palette.ink)),
                                ),
                            ],
                          ),
                        ),
                      ],
                      if (posting.myApplication == null ||
                          posting.myApplication!.status == ApplicationStatus.withdrawn) ...[
                        const SizedBox(height: 14),
                        _CostHint(services: widget.services, postingId: posting.id),
                      ],
                    ],
                  ),
                ),
                _ActionBar(
                  posting: posting,
                  gone: _gone,
                  justApplied: _applied,
                  onApply: () => _apply(),
                  onReapply: () => _apply(reapplying: true),
                  onOpenApplication: _openApplication,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  bool _has(String? value) => value != null && value.trim().isNotEmpty;
}

class _Header extends StatelessWidget {
  const _Header({required this.posting});

  final JobPosting posting;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(
          color: posting.isHighlighted ? AppColors.gold : palette.border,
          width: posting.isHighlighted ? 2 : 1,
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (posting.isHighlighted)
            const Padding(
              padding: EdgeInsets.only(bottom: 10),
              child: StatusPill(label: 'Puesto destacado', color: AppColors.gold, icon: Icons.star_rounded),
            ),
          Semantics(
            header: true,
            child: Text(
              posting.title,
              style: TextStyle(color: palette.ink, fontSize: 22, fontWeight: FontWeight.w900),
            ),
          ),
          const SizedBox(height: 4),
          Text(posting.companyName, style: TextStyle(color: palette.muted, fontSize: 15)),
          const SizedBox(height: 10),
          Text(
            formatSalaryRange(posting.salary),
            style: TextStyle(color: palette.ink, fontSize: 18, fontWeight: FontWeight.w900),
          ),
        ],
      ),
    );
  }
}

/// Costo de postular, consultado sin efectos. Si la consulta falla no se
/// muestra nada y postular sigue disponible (nunca se bloquea por esto).
class _CostHint extends StatefulWidget {
  const _CostHint({required this.services, required this.postingId});

  final JobsServices services;
  final String postingId;

  @override
  State<_CostHint> createState() => _CostHintState();
}

class _CostHintState extends State<_CostHint> {
  late final Future<Quote?> _quote = _load();

  Future<Quote?> _load() async {
    try {
      final quote = await widget.services.wallet.quote(
        ActionKeys.applicationExtra,
        targetId: widget.postingId,
      );
      widget.services.walletController.adoptCurrencyName(quote.currency);
      return quote;
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Quote?>(
    future: _quote,
    builder: (context, snapshot) {
      final quote = snapshot.data;
      if (quote == null) return const SizedBox.shrink();
      final currency = quote.currency.isEmpty
          ? widget.services.walletController.currencyName
          : quote.currency;
      final String text;
      if (quote.isFree) {
        text = quote.reason == QuoteReason.freeQuota && quote.freeQuota != null
            ? 'Esta postulación es gratis. Te quedan ${quote.freeQuota!.remaining} '
                  'postulaciones gratuitas este mes.'
            : 'Esta postulación no te cuesta nada.';
      } else {
        text =
            'Ya usaste tus postulaciones gratuitas de este mes: esta cuesta '
            '${formatCoins(quote.cost, currency)} y tienes ${formatCoins(quote.balance, currency)}. '
            'Te pediremos confirmar antes de cobrar.';
      }
      return Semantics(
        container: true,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: context.palette.accentSoft,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.savings_outlined, color: AppColors.teal),
              const SizedBox(width: 10),
              Expanded(child: Text(text, style: TextStyle(color: context.palette.ink))),
            ],
          ),
        ),
      );
    },
  );
}

class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.posting,
    required this.gone,
    required this.justApplied,
    required this.onApply,
    required this.onReapply,
    required this.onOpenApplication,
  });

  final JobPosting posting;
  final bool gone;
  final bool justApplied;
  final VoidCallback onApply;
  final VoidCallback onReapply;
  final ValueChanged<String> onOpenApplication;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final mine = posting.myApplication;
    Widget child;
    if (gone) {
      child = const Text('Este puesto ya no recibe postulaciones.');
    } else if (mine == null) {
      child = FilledButton(
        key: const Key('apply-button'),
        onPressed: onApply,
        child: const Text('Postular'),
      );
    } else if (mine.status == ApplicationStatus.withdrawn) {
      child = FilledButton(
        key: const Key('reapply-button'),
        onPressed: onReapply,
        child: const Text('Volver a postular'),
      );
    } else if (mine.status == ApplicationStatus.rejected) {
      child = Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'La empresa ya tomó una decisión sobre tu postulación, por eso no '
            'puedes volver a postular a este puesto.',
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: () => onOpenApplication(mine.id),
            child: const Text('Ver mi postulación'),
          ),
        ],
      );
    } else {
      child = FilledButton(
        key: const Key('view-application-button'),
        onPressed: () => onOpenApplication(mine.id),
        child: Text(
          justApplied
              ? 'Ver mi postulación'
              : 'Ver mi postulación (${applicationStatusLabel(mine.status)})',
        ),
      );
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: child,
    );
  }
}
