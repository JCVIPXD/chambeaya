import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../wallet/cost_flow.dart';
import '../wallet/wallet_models.dart';
import '../wallet/wallet_page.dart';
import 'application_widgets.dart';
import 'apply_sheet.dart';
import 'jobs_errors.dart';
import 'jobs_format.dart';
import 'jobs_models.dart';
import 'jobs_services.dart';
import 'jobs_widgets.dart';
import 'pdf_saver.dart';

/// Detalle de una postulación: etapa, línea de tiempo, entrevista, ofertas con
/// sus versiones, constancia y las acciones que permite su estado.
class ApplicationDetailPage extends StatefulWidget {
  const ApplicationDetailPage({
    super.key,
    required this.services,
    required this.applicationId,
    this.initial,
    this.liveEvents,
    this.onChanged,
    this.pdfSaver = savePdfWithPicker,
  });

  final JobsServices services;
  final String applicationId;
  final JobApplication? initial;

  /// Avisos en vivo ya filtrados por la pantalla que los abrió (opcional).
  final Stream<JobEventNotification>? liveEvents;

  /// Se llama cada vez que cambia la postulación (para refrescar la lista).
  final ValueChanged<JobApplication>? onChanged;
  final PdfSaver pdfSaver;

  @override
  State<ApplicationDetailPage> createState() => _ApplicationDetailPageState();
}

class _ApplicationDetailPageState extends State<ApplicationDetailPage> {
  JobApplication? _application;
  JobsErrorInfo? _loadError;
  JobsErrorInfo? _actionError;
  bool _loading = false;
  String? _busy;
  String? _downloadingOffer;
  StreamSubscription<JobEventNotification>? _live;

  JobsServices get _services => widget.services;
  String get _currency => _services.walletController.currencyName;

  @override
  void initState() {
    super.initState();
    _application = widget.initial;
    _load(silent: widget.initial != null);
    _live = widget.liveEvents?.listen((event) {
      if (event.applicationId == widget.applicationId) _load(silent: true);
    });
  }

  @override
  void dispose() {
    _live?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final fresh = await _services.jobs.application(widget.applicationId);
      if (!mounted) return;
      setState(() {
        _application = fresh;
        _loadError = null;
        _loading = false;
      });
      widget.onChanged?.call(fresh);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (!silent || _application == null) {
          _loadError = describeJobsError(error, currency: _currency);
        }
      });
    }
  }

  void _adopt(JobApplication application) {
    if (!mounted) return;
    setState(() {
      _application = application;
      _actionError = null;
      _busy = null;
    });
    widget.onChanged?.call(application);
  }

  void _fail(Object error) {
    if (!mounted) return;
    final info = describeJobsError(error, currency: _currency);
    setState(() {
      _busy = null;
      _actionError = info;
    });
    // Un conflicto de estado significa que la postulación cambió: se actualiza.
    if (info.kind == JobsErrorKind.conflict || info.kind == JobsErrorKind.notFound) {
      _load(silent: true);
    }
  }

  Future<bool> _confirm({
    required String title,
    required String message,
    required String confirmLabel,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(child: Text(message)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return result == true;
  }

  Future<void> _withdraw(JobApplication application) async {
    final accepted = application.status == ApplicationStatus.accepted;
    final ok = await _confirm(
      title: 'Retirar postulación',
      message: accepted
          ? 'Ya aceptaste una oferta. Si te retiras, la empresa deja de contar contigo '
                'y no podrás volver a postular a este puesto (la constancia se conserva).'
          : 'Dejarás de participar en este proceso. Si el puesto sigue abierto, '
                'podrás volver a postular más adelante sin que se cobre de nuevo.',
      confirmLabel: 'Retirarme',
    );
    if (!ok || !mounted) return;
    setState(() {
      _busy = 'withdraw';
      _actionError = null;
    });
    try {
      _adopt(await _services.jobs.withdraw(application.id));
    } catch (error) {
      _fail(error);
    }
  }

  Future<void> _accept(JobApplication application, JobOffer offer) async {
    final ok = await _confirm(
      title: 'Aceptar oferta',
      message:
          'Aceptarás ${formatSoles(offer.salaryCents)} al mes, ${contractTypeLabel(offer.contractType)}, '
          'con ingreso el ${formatCalendarDate(offer.startDate)}.\n\n'
          'Se guardará una constancia con estas condiciones y la empresa verá '
          'tu nombre y tu DNI en ella. Aceptar no cuesta nada.',
      confirmLabel: 'Aceptar oferta',
    );
    if (!ok || !mounted) return;
    setState(() {
      _busy = 'accept';
      _actionError = null;
    });
    try {
      _adopt(await _services.jobs.acceptOffer(application.id, offer.id));
    } catch (error) {
      _fail(error);
    }
  }

  Future<void> _decline(JobApplication application, JobOffer offer) async {
    final ok = await _confirm(
      title: 'Rechazar oferta',
      message:
          'Si rechazas la oferta, tu postulación quedará retirada. Podrás volver '
          'a postular mientras el puesto siga abierto, sin que se cobre de nuevo.',
      confirmLabel: 'Rechazar oferta',
    );
    if (!ok || !mounted) return;
    setState(() {
      _busy = 'decline';
      _actionError = null;
    });
    try {
      _adopt(await _services.jobs.declineOffer(application.id, offer.id));
    } catch (error) {
      _fail(error);
    }
  }

  Future<void> _prioritize(JobApplication application) async {
    setState(() {
      _busy = 'priority';
      _actionError = null;
    });
    try {
      final result = await confirmCosts(
        context,
        wallet: _services.wallet,
        currencyName: _currency,
        title: 'Postulación con prioridad',
        requests: [
          CostRequest(
            actionKey: ActionKeys.applicationPriority,
            label: 'Prioridad',
            targetId: application.id,
          ),
        ],
        onOpenWallet: () => openWalletPage(context, _services),
        onCurrency: _services.walletController.adoptCurrencyName,
      );
      if (!mounted) return;
      if (!result.proceed) {
        setState(() => _busy = null);
        return;
      }
      final updated = await _services.jobs.prioritize(application.id);
      _services.walletController.refresh();
      _adopt(updated);
    } catch (error) {
      _fail(error);
    }
  }

  Future<void> _reapply(JobApplication application) async {
    setState(() {
      _busy = 'reapply';
      _actionError = null;
    });
    try {
      final posting = await _services.jobs.posting(application.posting.id);
      if (!mounted) return;
      setState(() => _busy = null);
      final result = await showApplySheet(
        context,
        services: _services,
        posting: posting,
        reapplying: true,
      );
      if (result != null) _adopt(result.application);
    } catch (error) {
      _fail(error);
    }
  }

  Future<void> _download(JobApplication application, JobOffer offer) async {
    setState(() {
      _downloadingOffer = offer.id;
      _actionError = null;
    });
    try {
      final name = safePdfFileName(offer.document?.name, fallback: 'oferta-v${offer.version}');
      final pdf = await _services.jobs.offerDocument(
        application.id,
        offer.id,
        fallbackName: name,
      );
      final saved = await widget.pdfSaver(
        safePdfFileName(pdf.fileName),
        Uint8List.fromList(pdf.bytes),
      );
      if (!mounted) return;
      setState(() => _downloadingOffer = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(saved ? 'PDF guardado.' : 'Descarga cancelada.')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _downloadingOffer = null);
      _fail(error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final application = _application;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mi postulación'),
        actions: [
          IconButton(
            tooltip: 'Actualizar postulación',
            onPressed: _loading ? null : () => _load(),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 820),
            child: application == null
                ? ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      if (_loading || _loadError == null)
                        const LoadingPanel(label: 'Cargando postulación')
                      else
                        StatePanel(
                          icon: Icons.cloud_off_rounded,
                          title: 'No pudimos cargar tu postulación',
                          message: _loadError!.message,
                          actionLabel: 'Reintentar',
                          onAction: _load,
                        ),
                    ],
                  )
                : _content(application),
          ),
        ),
      ),
    );
  }

  Widget _content(JobApplication application) {
    final palette = context.palette;
    final offers = application.offers.reversed.toList();
    final receipts = application.offers
        .where((offer) => offer.receipt != null)
        .map((offer) => offer.receipt!)
        .toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
      children: [
        if (_loadError != null) ...[
          ErrorNotice(info: _loadError!, onRetry: _load),
          const SizedBox(height: 12),
        ],
        _Header(application: application),
        const SizedBox(height: 14),
        _StatusMessage(application: application),
        if (_actionError != null) ...[
          const SizedBox(height: 14),
          ErrorNotice(
            info: _actionError!,
            onOpenWallet: () => openWalletPage(context, _services),
          ),
        ],
        const SizedBox(height: 14),
        _Actions(
          application: application,
          busy: _busy,
          onWithdraw: () => _withdraw(application),
          onAccept: () => _accept(application, application.currentOffer!),
          onDecline: () => _decline(application, application.currentOffer!),
          onPrioritize: () => _prioritize(application),
          onReapply: () => _reapply(application),
        ),
        if (application.interview != null) ...[
          const SizedBox(height: 14),
          SectionCard(
            title: 'Entrevista',
            icon: Icons.event_available_outlined,
            child: Column(
              children: [
                FactRow(
                  label: 'Fecha y hora',
                  value: formatDateTime(application.interview!.scheduledAt),
                ),
                FactRow(
                  label: 'Modalidad',
                  value: interviewModeLabel(application.interview!.mode),
                ),
                if (application.interview!.note != null &&
                    application.interview!.note!.trim().isNotEmpty)
                  FactRow(label: 'Nota de la empresa', value: application.interview!.note!),
              ],
            ),
          ),
        ],
        if (offers.isNotEmpty) ...[
          const SizedBox(height: 14),
          SectionCard(
            title: offers.length == 1 ? 'Oferta' : 'Ofertas (${offers.length} versiones)',
            subtitle: 'La más reciente es la vigente.',
            icon: Icons.mark_email_read_outlined,
            child: Column(
              children: [
                for (var i = 0; i < offers.length; i++) ...[
                  if (i > 0) const SizedBox(height: 10),
                  OfferCard(
                    offer: offers[i],
                    isCurrent: offers[i].id == application.currentOfferId,
                    downloading: _downloadingOffer == offers[i].id,
                    onDownload: () => _download(application, offers[i]),
                  ),
                ],
              ],
            ),
          ),
        ],
        for (final receipt in receipts) ...[
          const SizedBox(height: 14),
          ReceiptCard(receipt: receipt),
        ],
        const SizedBox(height: 14),
        SectionCard(
          title: 'Línea de tiempo',
          icon: Icons.timeline_rounded,
          child: EventTimeline(events: application.events),
        ),
        if (application.screeningAnswers.isNotEmpty) ...[
          const SizedBox(height: 14),
          SectionCard(
            title: 'Tus respuestas a la empresa',
            icon: Icons.question_answer_outlined,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final answer in application.screeningAnswers) ...[
                  Text(answer.question, style: TextStyle(color: palette.muted, fontSize: 13)),
                  const SizedBox(height: 2),
                  Text(
                    answer.answer,
                    style: TextStyle(color: palette.ink, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 10),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.application});

  final JobApplication application;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final posting = application.posting;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              StatusPill(
                label: applicationStatusLabel(application.status),
                color: statusColor(application.status),
              ),
              if (application.isPriority)
                const StatusPill(
                  label: 'Con prioridad',
                  color: AppColors.gold,
                  icon: Icons.bolt_rounded,
                ),
            ],
          ),
          const SizedBox(height: 10),
          Semantics(
            header: true,
            child: Text(
              posting.title,
              style: TextStyle(color: palette.ink, fontSize: 21, fontWeight: FontWeight.w900),
            ),
          ),
          const SizedBox(height: 2),
          Text(posting.companyName, style: TextStyle(color: palette.muted)),
          const SizedBox(height: 4),
          Text(
            '${formatSalaryRange(posting.salary)} · ${workloadLabel(posting.workload)} · ${modalityLabel(posting.modality)}',
            style: TextStyle(color: palette.muted, fontSize: 13),
          ),
          const SizedBox(height: 14),
          StageProgress(status: application.status),
        ],
      ),
    );
  }
}

class _StatusMessage extends StatelessWidget {
  const _StatusMessage({required this.application});

  final JobApplication application;

  String get _text {
    if (application.isAutoClosed) {
      return '${autoClosedLabel(application.autoClosedReason!)}: tu postulación '
          'terminó sin una decisión sobre ti. Puedes buscar otros puestos.';
    }
    return switch (application.status) {
      ApplicationStatus.applied =>
        'Enviaste tu postulación. La empresa la revisará y te avisaremos aquí.',
      ApplicationStatus.shortlisted => 'La empresa te preseleccionó. Sigue atento a las novedades.',
      ApplicationStatus.interview => 'La empresa programó una entrevista contigo. Revisa los datos abajo.',
      ApplicationStatus.offer when application.canRespondToOffer =>
        'Tienes una oferta pendiente. Revisa las condiciones y respóndela.',
      ApplicationStatus.offer => 'La empresa está preparando una oferta para ti.',
      ApplicationStatus.accepted =>
        'Aceptaste la oferta. La empresa confirmará tu contratación y se conservó tu constancia.',
      ApplicationStatus.hired => 'Felicitaciones, la empresa confirmó tu contratación.',
      ApplicationStatus.rejected =>
        'La empresa decidió no continuar con tu postulación. No puedes volver a postular a este puesto.',
      ApplicationStatus.withdrawn when application.hasAcceptedOffer =>
        'Retiraste esta postulación después de aceptar una oferta. La constancia se '
            'conserva y no puedes volver a postular a este puesto.',
      ApplicationStatus.withdrawn =>
        'Retiraste tu postulación. Si el puesto sigue abierto puedes volver a postular '
            'sin que se cobre de nuevo.',
      ApplicationStatus.unknown => 'Tu postulación está en proceso.',
    };
  }

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    liveRegion: true,
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.palette.accentSoft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(_text, style: TextStyle(color: context.palette.ink, height: 1.4)),
    ),
  );
}

class _Actions extends StatelessWidget {
  const _Actions({
    required this.application,
    required this.busy,
    required this.onWithdraw,
    required this.onAccept,
    required this.onDecline,
    required this.onPrioritize,
    required this.onReapply,
  });

  final JobApplication application;
  final String? busy;
  final VoidCallback onWithdraw;
  final VoidCallback onAccept;
  final VoidCallback onDecline;
  final VoidCallback onPrioritize;
  final VoidCallback onReapply;

  Widget _spinner() => const SizedBox(
    width: 18,
    height: 18,
    child: CircularProgressIndicator(strokeWidth: 2),
  );

  @override
  Widget build(BuildContext context) {
    final disabled = busy != null;
    final postingOpen = application.posting.status == PostingStatus.published;
    final canReapply =
        application.status == ApplicationStatus.withdrawn &&
        !application.hasAcceptedOffer &&
        !application.isAutoClosed;
    final buttons = <Widget>[
      if (application.canRespondToOffer) ...[
        FilledButton.icon(
          key: const Key('accept-offer'),
          onPressed: disabled ? null : onAccept,
          icon: busy == 'accept' ? _spinner() : const Icon(Icons.check_circle_outline_rounded),
          label: const Text('Aceptar oferta'),
        ),
        OutlinedButton.icon(
          key: const Key('decline-offer'),
          onPressed: disabled ? null : onDecline,
          icon: busy == 'decline' ? _spinner() : const Icon(Icons.close_rounded),
          label: const Text('Rechazar oferta'),
        ),
      ],
      if (application.status == ApplicationStatus.applied &&
          !application.isPriority &&
          postingOpen)
        OutlinedButton.icon(
          key: const Key('prioritize'),
          onPressed: disabled ? null : onPrioritize,
          icon: busy == 'priority' ? _spinner() : const Icon(Icons.bolt_rounded),
          label: const Text('Dar prioridad a mi postulación'),
        ),
      if (canReapply)
        FilledButton.icon(
          key: const Key('reapply'),
          onPressed: disabled ? null : onReapply,
          icon: busy == 'reapply' ? _spinner() : const Icon(Icons.replay_rounded),
          label: const Text('Volver a postular'),
        ),
      if (application.status.isOpen)
        OutlinedButton.icon(
          key: const Key('withdraw'),
          onPressed: disabled ? null : onWithdraw,
          icon: busy == 'withdraw' ? _spinner() : const Icon(Icons.logout_rounded),
          label: const Text('Retirar mi postulación'),
        ),
    ];
    if (buttons.isEmpty) return const SizedBox.shrink();
    return Wrap(spacing: 10, runSpacing: 10, children: buttons);
  }
}
