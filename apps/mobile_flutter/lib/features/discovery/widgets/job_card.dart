import 'package:flutter/material.dart';

import '../../../core/formatters/currency_formatter.dart';
import '../../../theme/app_theme.dart';
import '../../marketplace/marketplace_data.dart';
import '../discovery_models.dart';

class JobCard extends StatelessWidget {
  const JobCard({
    super.key,
    required this.shift,
    required this.selected,
    required this.saved,
    required this.applicationState,
    required this.onSelected,
    required this.onToggleSaved,
  });

  final Shift shift;
  final bool selected;
  final bool saved;
  final ApplicationState applicationState;
  final VoidCallback onSelected;
  final VoidCallback onToggleSaved;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Semantics(
      button: true,
      selected: selected,
      label: '${shift.title} en ${shift.company}',
      child: InkWell(
        onTap: onSelected,
        borderRadius: BorderRadius.circular(16),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
            color: selected
                ? Color.alphaBlend(
                    AppColors.teal.withValues(alpha: .06),
                    palette.surface,
                  )
                : palette.surface,
            border: Border.all(
              color: selected ? AppColors.teal : palette.border,
              width: selected ? 2 : 1,
            ),
            borderRadius: BorderRadius.circular(18),
            boxShadow: [
              BoxShadow(
                color: selected
                    ? AppColors.teal.withValues(alpha: .12)
                    : palette.shadow,
                blurRadius: selected ? 18 : 12,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _CompanyMark(company: shift.company),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          shift.title,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                shift.company,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: palette.muted,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            const SizedBox(width: 4),
                            const Icon(
                              Icons.verified_rounded,
                              color: AppColors.teal,
                              size: 14,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (shift.urgent)
                    const _StatusPill(
                      label: 'URGENTE',
                      color: Color(0xFFD9344B),
                    ),
                  Semantics(
                    label: saved ? 'Empleo guardado' : 'Guardar empleo',
                    button: true,
                    child: IconButton(
                      constraints: const BoxConstraints(
                        minWidth: 48,
                        minHeight: 48,
                      ),
                      onPressed: onToggleSaved,
                      tooltip: saved ? 'Empleo guardado' : 'Guardar empleo',
                      icon: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 220),
                        transitionBuilder: (child, animation) =>
                            ScaleTransition(
                              scale: animation,
                              child: FadeTransition(
                                opacity: animation,
                                child: child,
                              ),
                            ),
                        child: Icon(
                          saved
                              ? Icons.bookmark_rounded
                              : Icons.bookmark_border_rounded,
                          key: ValueKey(saved),
                          color: saved ? AppColors.teal : palette.muted,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _InfoRow(icon: Icons.location_on_outlined, value: shift.location),
              const SizedBox(height: 7),
              _InfoRow(icon: Icons.schedule_outlined, value: shift.schedule),
              const Divider(height: 23),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          formatPenCents(shift.workerPayCents),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.tealDark,
                            fontSize: 19,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          'pago por turno',
                          style: TextStyle(color: palette.muted, fontSize: 9),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (applicationState != ApplicationState.submitted &&
                      shift.match != null)
                    _MatchIndicator(match: shift.match),
                  if (applicationState == ApplicationState.submitted)
                    const _StatusPill(
                      label: 'POSTULADO',
                      color: AppColors.gold,
                    ),
                ],
              ),
              const SizedBox(height: 11),
              const Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _BenefitChip(
                    icon: Icons.lock_outline_rounded,
                    label: 'Pago informado',
                  ),
                  _BenefitChip(
                    icon: Icons.flash_on_rounded,
                    label: 'Respuesta rápida',
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CompanyMark extends StatelessWidget {
  const _CompanyMark({required this.company});
  final String company;

  @override
  Widget build(BuildContext context) => Container(
    width: 40,
    height: 40,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: context.palette.surfaceMuted,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      company.characters.first.toUpperCase(),
      style: TextStyle(
        color: context.palette.ink,
        fontSize: 16,
        fontWeight: FontWeight.w900,
      ),
    ),
  );
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.value});
  final IconData icon;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: 27,
        height: 27,
        decoration: BoxDecoration(
          color: context.palette.accentSoft,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: AppColors.tealDark, size: 15),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: Text(
          value,
          style: TextStyle(
            color: context.palette.ink,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    ],
  );
}

class _MatchIndicator extends StatelessWidget {
  const _MatchIndicator({required this.match});
  final int? match;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      SizedBox(
        width: 32,
        height: 32,
        child: CircularProgressIndicator(
          value: match! / 100,
          strokeWidth: 4,
          backgroundColor: context.palette.accentSoft,
          color: AppColors.teal,
        ),
      ),
      const SizedBox(width: 7),
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${match!}%',
            style: TextStyle(
              color: context.palette.ink,
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            'compatible',
            style: TextStyle(color: context.palette.muted, fontSize: 8),
          ),
        ],
      ),
    ],
  );
}

class _BenefitChip extends StatelessWidget {
  const _BenefitChip({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
    decoration: BoxDecoration(
      color: context.palette.surfaceMuted,
      border: Border.all(color: context.palette.border),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: context.palette.muted, size: 12),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            color: context.palette.muted,
            fontSize: 8,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .12),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Text(
      label,
      style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w900),
    ),
  );
}
