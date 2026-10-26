import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'jobs_format.dart';
import 'jobs_models.dart';
import 'jobs_widgets.dart';

/// Color de marca de cada etapa (solo tiñe; el texto siempre lleva el nombre).
Color statusColor(ApplicationStatus status) => switch (status) {
  ApplicationStatus.hired || ApplicationStatus.accepted => AppColors.teal,
  ApplicationStatus.offer => AppColors.gold,
  ApplicationStatus.rejected => const Color(0xFFD9344B),
  ApplicationStatus.withdrawn => AppColors.muted,
  _ => AppColors.navy,
};

/// Barra de avance por etapas del embudo. Una postulación terminada (rechazada
/// o retirada) no muestra avance: su estado lo dice la etiqueta.
class StageProgress extends StatelessWidget {
  const StageProgress({super.key, required this.status});

  final ApplicationStatus status;

  @override
  Widget build(BuildContext context) {
    final index = funnelStages.indexOf(status);
    if (index < 0) return const SizedBox.shrink();
    final palette = context.palette;
    return Semantics(
      label: 'Etapa ${index + 1} de ${funnelStages.length}: ${applicationStatusLabel(status)}',
      excludeSemantics: true,
      child: Row(
        children: [
          for (var i = 0; i < funnelStages.length; i++) ...[
            if (i > 0) const SizedBox(width: 4),
            Expanded(
              child: Container(
                height: 6,
                decoration: BoxDecoration(
                  color: i <= index ? AppColors.teal : palette.border,
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Línea de tiempo de una postulación, del evento más reciente al más antiguo.
class EventTimeline extends StatelessWidget {
  const EventTimeline({super.key, required this.events});

  final List<JobEvent> events;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final ordered = events.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    if (ordered.isEmpty) {
      return Text('Todavía no hay movimientos.', style: TextStyle(color: palette.muted));
    }
    return Column(
      children: [
        for (var i = 0; i < ordered.length; i++)
          Semantics(
            container: true,
            label: '${eventLabel(ordered[i])}, ${formatDateTime(ordered[i].createdAt)}',
            excludeSemantics: true,
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    width: 22,
                    child: Column(
                      children: [
                        Container(
                          margin: const EdgeInsets.only(top: 5),
                          width: 12,
                          height: 12,
                          decoration: BoxDecoration(
                            color: i == 0 ? AppColors.teal : palette.border,
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.teal),
                          ),
                        ),
                        if (i < ordered.length - 1)
                          Expanded(child: Container(width: 2, color: palette.border)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            eventLabel(ordered[i]),
                            style: TextStyle(
                              color: palette.ink,
                              fontWeight: i == 0 ? FontWeight.w800 : FontWeight.w600,
                            ),
                          ),
                          Text(
                            formatDateTime(ordered[i].createdAt),
                            style: TextStyle(color: palette.muted, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Condiciones de una versión de oferta. Los textos de la empresa (nota y
/// nombre del documento) se muestran siempre como texto plano.
class OfferCard extends StatelessWidget {
  const OfferCard({
    super.key,
    required this.offer,
    required this.isCurrent,
    this.onDownload,
    this.downloading = false,
  });

  final JobOffer offer;
  final bool isCurrent;
  final VoidCallback? onDownload;
  final bool downloading;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final pending = offer.status == OfferStatus.pending;
    return Container(
      key: Key('offer-${offer.id}'),
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isCurrent ? palette.accentSoft : palette.surfaceMuted,
        border: Border.all(color: isCurrent ? AppColors.teal : palette.border),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Oferta versión ${offer.version}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              StatusPill(
                label: offerStatusLabel(offer.status),
                color: pending ? AppColors.gold : AppColors.teal,
              ),
            ],
          ),
          const SizedBox(height: 8),
          FactRow(label: 'Sueldo mensual', value: formatSoles(offer.salaryCents)),
          FactRow(label: 'Contrato', value: contractTypeLabel(offer.contractType)),
          FactRow(label: 'Fecha de ingreso', value: formatCalendarDate(offer.startDate)),
          if (offer.note != null && offer.note!.trim().isNotEmpty)
            FactRow(label: 'Nota de la empresa', value: offer.note!),
          FactRow(label: 'Enviada', value: formatDate(offer.createdAt)),
          if (offer.document != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(Icons.picture_as_pdf_outlined, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  // Nombre elegido por la empresa: solo texto.
                  child: Text(
                    offer.document!.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: palette.ink),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              key: Key('download-offer-${offer.id}'),
              onPressed: downloading ? null : onDownload,
              icon: downloading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.download_rounded),
              label: Text(downloading ? 'Descargando' : 'Descargar PDF de la oferta'),
            ),
          ],
        ],
      ),
    );
  }
}

/// Constancia de la aceptación de una oferta: condiciones congeladas.
class ReceiptCard extends StatelessWidget {
  const ReceiptCard({super.key, required this.receipt});

  final AcceptanceReceipt receipt;

  @override
  Widget build(BuildContext context) => SectionCard(
    title: 'Constancia de aceptación',
    subtitle:
        'Quedó registrada el ${formatDateTime(receipt.acceptedAt)} y ya no se puede modificar.',
    icon: Icons.verified_outlined,
    child: Column(
      children: [
        FactRow(label: 'Empresa', value: receipt.companyName),
        if (receipt.companyLegalName != null)
          FactRow(label: 'Razón social', value: receipt.companyLegalName!),
        if (receipt.companyRuc.isNotEmpty) FactRow(label: 'RUC', value: receipt.companyRuc),
        FactRow(label: 'Puesto', value: receipt.postingTitle),
        FactRow(label: 'Lugar', value: receipt.postingLocation),
        FactRow(label: 'Sueldo mensual', value: formatSoles(receipt.salaryCents)),
        FactRow(label: 'Contrato', value: contractTypeLabel(receipt.contractType)),
        FactRow(label: 'Fecha de ingreso', value: formatCalendarDate(receipt.startDate)),
        FactRow(label: 'Versión de la oferta', value: '${receipt.offerVersion}'),
        if (receipt.note != null && receipt.note!.trim().isNotEmpty)
          FactRow(label: 'Nota', value: receipt.note!),
        if (receipt.document != null) ...[
          FactRow(label: 'Documento', value: receipt.document!.name),
          if (receipt.document!.sha256 != null)
            FactRow(
              label: 'Huella (SHA-256)',
              value: receipt.document!.sha256!.length > 16
                  ? '${receipt.document!.sha256!.substring(0, 16)}…'
                  : receipt.document!.sha256!,
            ),
        ],
      ],
    ),
  );
}
