import 'dart:async';

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'application_detail_page.dart';
import 'application_widgets.dart';
import 'jobs_errors.dart';
import 'jobs_format.dart';
import 'jobs_models.dart';
import 'jobs_services.dart';
import 'jobs_widgets.dart';
import 'my_applications_controller.dart';
import 'pdf_saver.dart';

/// Mis postulaciones a puestos fijos, por etapa, con avisos en vivo.
///
/// La conexión SSE vive solo mientras esta pantalla está montada: se abre al
/// entrar, se reconecta sola con retroceso, se detiene si la sesión venció
/// (401) y se cierra al salir.
class MyApplicationsPage extends StatefulWidget {
  const MyApplicationsPage({
    super.key,
    required this.services,
    this.revision = 0,
    this.pdfSaver = savePdfWithPicker,
  });

  final JobsServices services;

  /// Cambia cuando otra pantalla creó o modificó una postulación.
  final int revision;
  final PdfSaver pdfSaver;

  @override
  State<MyApplicationsPage> createState() => _MyApplicationsPageState();
}

class _MyApplicationsPageState extends State<MyApplicationsPage> {
  late final MyApplicationsController _controller;
  final _scroll = ScrollController();
  final _live = StreamController<JobEventNotification>.broadcast();
  StreamSubscription<JobEventNotification>? _subscription;
  bool _sessionExpired = false;

  static const _stages = <ApplicationStatus?>[
    null,
    ApplicationStatus.applied,
    ApplicationStatus.shortlisted,
    ApplicationStatus.interview,
    ApplicationStatus.offer,
    ApplicationStatus.accepted,
    ApplicationStatus.hired,
    ApplicationStatus.rejected,
    ApplicationStatus.withdrawn,
  ];

  @override
  void initState() {
    super.initState();
    _controller = MyApplicationsController(widget.services.jobs)..load();
    _scroll.addListener(() {
      if (_scroll.hasClients && _scroll.position.extentAfter < 480) {
        _controller.loadMore();
      }
    });
    _connect();
  }

  void _connect() {
    _subscription = widget.services.events.watch().listen(
      (event) {
        _controller.applyNotification(event);
        if (!_live.isClosed) _live.add(event);
      },
      onError: (Object error) {
        // 401: la sesión venció. El flujo se cierra solo y no se reintenta.
        if (error is Exception && describeJobsError(error).kind == JobsErrorKind.session) {
          if (mounted) setState(() => _sessionExpired = true);
        }
      },
      cancelOnError: false,
    );
  }

  @override
  void didUpdateWidget(MyApplicationsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.revision != widget.revision) _controller.load(silent: true);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _live.close();
    _scroll.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _open(JobApplication application) {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ApplicationDetailPage(
          services: widget.services,
          applicationId: application.id,
          initial: application,
          liveEvents: _live.stream,
          pdfSaver: widget.pdfSaver,
          onChanged: _controller.replace,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Material(
      color: palette.background,
      child: SafeArea(
        child: ListenableBuilder(
          listenable: _controller,
          builder: (context, _) => RefreshIndicator(
            onRefresh: _controller.load,
            child: ListView(
              controller: _scroll,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
              children: [
                Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 900),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(
                          header: true,
                          child: Text(
                            'Mis postulaciones',
                            style: TextStyle(
                              color: palette.ink,
                              fontSize: 28,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Sigue cada proceso de selección, etapa por etapa',
                          style: TextStyle(color: palette.muted, fontSize: 14),
                        ),
                        if (_sessionExpired) ...[
                          const SizedBox(height: 12),
                          const ErrorNotice(
                            info: JobsErrorInfo(
                              kind: JobsErrorKind.session,
                              message:
                                  'Tu sesión venció, así que los avisos en vivo se detuvieron. '
                                  'Vuelve a ingresar para seguir recibiéndolos.',
                            ),
                          ),
                        ],
                        const SizedBox(height: 14),
                        SizedBox(
                          height: 52,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: _stages.length,
                            separatorBuilder: (_, _) => const SizedBox(width: 8),
                            itemBuilder: (context, index) {
                              final stage = _stages[index];
                              return Center(
                                child: ChoiceChip(
                                  key: Key('stage-${stage?.apiValue ?? 'ALL'}'),
                                  label: Text(stage == null ? 'Todas' : applicationStatusLabel(stage)),
                                  selected: _controller.stage == stage,
                                  onSelected: (_) => _controller.setStage(stage),
                                ),
                              );
                            },
                          ),
                        ),
                        SwitchListTile(
                          key: const Key('history-switch'),
                          contentPadding: EdgeInsets.zero,
                          value: _controller.history,
                          onChanged: _controller.setHistory,
                          title: const Text('Mostrar historial'),
                          subtitle: const Text(
                            'Incluye las postulaciones que terminaron porque el puesto se cerró o se cubrió.',
                          ),
                        ),
                        const SizedBox(height: 8),
                        _list(context),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _list(BuildContext context) {
    final items = _controller.items;
    if (_controller.loading && items.isEmpty) {
      return const LoadingPanel(label: 'Cargando postulaciones');
    }
    if (_controller.error != null) {
      return StatePanel(
        icon: Icons.cloud_off_rounded,
        title: 'No pudimos cargar tus postulaciones',
        message: _controller.error!.message,
        actionLabel: 'Reintentar',
        onAction: _controller.load,
      );
    }
    if (_controller.isEmpty) {
      final filtered = _controller.stage != null;
      return StatePanel(
        icon: Icons.work_history_outlined,
        title: filtered ? 'No hay postulaciones en esta etapa' : 'Aún no tienes postulaciones',
        message: filtered
            ? 'Prueba con otra etapa o con "Todas".'
            : 'Cuando postules a un puesto, lo verás aquí con cada novedad.',
        actionLabel: filtered ? 'Ver todas' : null,
        onAction: filtered ? () => _controller.setStage(null) : null,
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final application in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _ApplicationCard(application: application, onTap: () => _open(application)),
          ),
        if (_controller.loadingMore) const LoadingPanel(label: 'Cargando más postulaciones'),
        if (_controller.moreError != null)
          StatePanel(
            icon: Icons.cloud_off_rounded,
            title: 'No pudimos cargar más',
            message: _controller.moreError!.message,
            actionLabel: 'Reintentar',
            onAction: _controller.loadMore,
          )
        else if (_controller.hasMore && !_controller.loadingMore)
          Center(
            child: OutlinedButton(
              onPressed: _controller.loadMore,
              child: const Text('Cargar más postulaciones'),
            ),
          ),
      ],
    );
  }
}

class _ApplicationCard extends StatelessWidget {
  const _ApplicationCard({required this.application, required this.onTap});

  final JobApplication application;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final posting = application.posting;
    final pendingOffer = application.canRespondToOffer;
    final summary = [
      posting.title,
      posting.companyName,
      applicationStatusLabel(application.status),
      if (pendingOffer) 'Tienes una oferta pendiente',
      if (application.isAutoClosed) autoClosedLabel(application.autoClosedReason!),
    ].join(', ');
    return Semantics(
      button: true,
      label: summary,
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: palette.surface,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            key: Key('application-${application.id}'),
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(color: pendingOffer ? AppColors.gold : palette.border, width: pendingOffer ? 2 : 1),
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
                      const StatusPill(label: 'Con prioridad', color: AppColors.gold, icon: Icons.bolt_rounded),
                    if (pendingOffer)
                      const StatusPill(label: 'Oferta por responder', color: AppColors.gold, icon: Icons.mark_email_unread_outlined),
                  ],
                ),
                const SizedBox(height: 10),
                Text(posting.title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 2),
                Text(posting.companyName, style: TextStyle(color: palette.muted, fontSize: 13)),
                const SizedBox(height: 12),
                StageProgress(status: application.status),
                const SizedBox(height: 8),
                Text(
                  application.isAutoClosed
                      ? autoClosedLabel(application.autoClosedReason!)
                      : 'Actualizada el ${formatDate(application.updatedAt)}',
                  style: TextStyle(color: palette.muted, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
