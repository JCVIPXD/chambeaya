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
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    label: '${shift.title} en ${shift.company}',
    child: InkWell(
      onTap: onSelected,
      borderRadius: BorderRadius.circular(16),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(
            color: selected ? AppColors.teal : AppColors.border,
            width: selected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    shift.title,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                if (shift.urgent)
                  const _StatusPill(label: 'URGENTE', color: Color(0xFFD9344B)),
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
                    icon: Icon(
                      saved
                          ? Icons.bookmark_rounded
                          : Icons.bookmark_border_rounded,
                      color: saved ? AppColors.teal : AppColors.muted,
                    ),
                  ),
                ),
              ],
            ),
            Text(
              '${shift.company} · Empresa verificada',
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
            const SizedBox(height: 11),
            Row(
              children: [
                const Icon(
                  Icons.location_on_outlined,
                  color: AppColors.teal,
                  size: 17,
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    shift.location,
                    style: const TextStyle(
                      color: AppColors.navy,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 7),
            Row(
              children: [
                const Icon(
                  Icons.schedule_outlined,
                  color: AppColors.teal,
                  size: 17,
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    shift.schedule,
                    style: const TextStyle(
                      color: AppColors.navy,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            Row(
              children: [
                Text(
                  formatPenCents(shift.workerPayCents),
                  style: const TextStyle(
                    color: AppColors.teal,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const Spacer(),
                if (applicationState == ApplicationState.submitted)
                  const _StatusPill(label: 'POSTULADO', color: AppColors.gold)
                else
                  _StatusPill(
                    label: '${shift.match}% MATCH',
                    color: AppColors.teal,
                  ),
              ],
            ),
          ],
        ),
      ),
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
