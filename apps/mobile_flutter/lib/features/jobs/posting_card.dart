import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'jobs_format.dart';
import 'jobs_models.dart';
import 'jobs_widgets.dart';

/// Tarjeta de un puesto en la lista. El puesto destacado se distingue con
/// borde dorado, una etiqueta con ícono y texto (no solo color) y una
/// descripción para el lector de pantalla.
class PostingCard extends StatelessWidget {
  const PostingCard({super.key, required this.posting, required this.onTap});

  final JobPosting posting;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final mine = posting.myApplication;
    final semanticsLabel = [
      if (posting.isHighlighted) 'Puesto destacado',
      posting.title,
      posting.companyName,
      formatSalaryRange(posting.salary),
      modalityLabel(posting.modality),
      workloadLabel(posting.workload),
      posting.location,
      if (mine != null) 'Ya postulaste: ${applicationStatusLabel(mine.status)}',
    ].join(', ');
    return Semantics(
      button: true,
      label: semanticsLabel,
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: palette.surface,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            key: Key('posting-card-${posting.id}'),
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(
                color: posting.isHighlighted ? AppColors.gold : palette.border,
                width: posting.isHighlighted ? 2 : 1,
              ),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (posting.isHighlighted || mine != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        if (posting.isHighlighted)
                          const StatusPill(
                            label: 'Destacado',
                            color: AppColors.gold,
                            icon: Icons.star_rounded,
                          ),
                        if (mine != null)
                          StatusPill(
                            label: 'Postulaste: ${applicationStatusLabel(mine.status)}',
                            color: AppColors.teal,
                            icon: Icons.check_circle_outline_rounded,
                          ),
                      ],
                    ),
                  ),
                // Textos de la empresa: siempre como texto plano.
                Text(posting.title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 2),
                Text(
                  posting.companyName,
                  style: TextStyle(color: palette.muted, fontSize: 13),
                ),
                const SizedBox(height: 10),
                Text(
                  formatSalaryRange(posting.salary),
                  style: TextStyle(
                    color: palette.ink,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    _Meta(icon: Icons.business_center_outlined, text: workloadLabel(posting.workload)),
                    _Meta(icon: Icons.home_work_outlined, text: modalityLabel(posting.modality)),
                    _Meta(icon: Icons.place_outlined, text: posting.location),
                    _Meta(
                      icon: Icons.groups_outlined,
                      text: posting.vacanciesRemaining == 1
                          ? '1 vacante'
                          : '${posting.vacanciesRemaining} vacantes',
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 260),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: palette.muted),
          const SizedBox(width: 4),
          Flexible(
            child: Text(text, style: TextStyle(color: palette.muted, fontSize: 12.5)),
          ),
        ],
      ),
    );
  }
}
