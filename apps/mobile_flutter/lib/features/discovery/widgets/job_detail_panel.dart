import 'package:flutter/material.dart';

import '../../../core/formatters/currency_formatter.dart';
import '../../../theme/app_theme.dart';
import '../../marketplace/marketplace_data.dart';
import '../discovery_models.dart';

class JobDetailPanel extends StatelessWidget {
  const JobDetailPanel({
    super.key,
    required this.shift,
    required this.saved,
    required this.applicationState,
    required this.onToggleSaved,
    required this.onApply,
  });

  final Shift shift;
  final bool saved;
  final ApplicationState applicationState;
  final VoidCallback onToggleSaved;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    final applied = applicationState != ApplicationState.notApplied;
    return Container(
      color: Colors.white,
      child: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(28, 28, 28, 12),
              children: [
                const Text(
                  'Detalle del turno',
                  style: TextStyle(
                    color: AppColors.muted,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            shift.title,
                            style: const TextStyle(
                              color: AppColors.navy,
                              fontSize: 26,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            shift.company,
                            style: const TextStyle(
                              color: AppColors.navy,
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          const Row(
                            children: [
                              Icon(
                                Icons.verified_rounded,
                                color: AppColors.teal,
                                size: 17,
                              ),
                              SizedBox(width: 5),
                              Text(
                                'Empresa verificada',
                                style: TextStyle(
                                  color: AppColors.muted,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Semantics(
                      label: saved ? 'Empleo guardado' : 'Guardar empleo',
                      button: true,
                      child: IconButton.outlined(
                        onPressed: onToggleSaved,
                        tooltip: saved ? 'Empleo guardado' : 'Guardar empleo',
                        icon: Icon(
                          saved
                              ? Icons.bookmark_rounded
                              : Icons.bookmark_border_rounded,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    _Fact(
                      icon: Icons.payments_outlined,
                      label: 'Pago',
                      value: formatPenCents(shift.workerPayCents),
                    ),
                    _Fact(
                      icon: Icons.schedule_outlined,
                      label: 'Horario',
                      value: shift.schedule,
                    ),
                    _Fact(
                      icon: Icons.location_on_outlined,
                      label: 'Ubicación',
                      value: shift.location,
                    ),
                    _Fact(
                      icon: Icons.auto_awesome_outlined,
                      label: 'Compatibilidad',
                      value: '${shift.match}%',
                    ),
                  ],
                ),
                const SizedBox(height: 26),
                Text(
                  'Sobre este trabajo',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 10),
                const Text(
                  'Buscamos una persona responsable y orientada al servicio para apoyar al equipo durante este turno. La empresa confirma el horario, las tareas y el pago antes de aceptar.',
                  style: TextStyle(
                    color: AppColors.muted,
                    height: 1.55,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 22),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.tealSoft,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.shield_outlined, color: AppColors.teal),
                      SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Tu información se comparte con esta empresa solo al confirmar la postulación.',
                          style: TextStyle(
                            color: AppColors.navy,
                            fontSize: 12,
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(28, 10, 28, 18),
              child: Semantics(
                label: applied ? 'Postulación enviada' : 'Postular ahora',
                button: !applied,
                child: SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: FilledButton.icon(
                    onPressed: applied ? null : onApply,
                    icon: Icon(
                      applied
                          ? Icons.check_circle_outline_rounded
                          : Icons.send_outlined,
                    ),
                    label: Text(
                      applied ? 'Postulación enviada' : 'Postular ahora',
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    width: 170,
    padding: const EdgeInsets.all(13),
    decoration: BoxDecoration(
      color: AppColors.background,
      borderRadius: BorderRadius.circular(13),
    ),
    child: Row(
      children: [
        Icon(icon, color: AppColors.teal, size: 21),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(color: AppColors.muted, fontSize: 10),
              ),
              Text(
                value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.navy,
                  fontSize: 12,
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
