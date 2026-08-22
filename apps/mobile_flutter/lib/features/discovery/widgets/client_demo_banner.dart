import 'package:flutter/material.dart';

import '../../../theme/app_theme.dart';

enum ClientDemoScenario { normal, empty, error }

class ClientDemoBanner extends StatelessWidget {
  const ClientDemoBanner({
    super.key,
    required this.scenario,
    required this.onScenarioChanged,
  });

  final ClientDemoScenario scenario;
  final ValueChanged<ClientDemoScenario> onScenarioChanged;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppColors.teal.withValues(alpha: .22)),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Row(
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: AppColors.tealSoft,
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Icon(
            Icons.science_outlined,
            color: AppColors.tealDark,
            size: 19,
          ),
        ),
        const SizedBox(width: 10),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Datos de demostración',
                style: TextStyle(
                  color: AppColors.navy,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                'Explora todos los estados',
                style: TextStyle(color: AppColors.muted, fontSize: 9),
              ),
            ],
          ),
        ),
        PopupMenuButton<ClientDemoScenario>(
          tooltip: 'Cambiar escenario de demostración',
          initialValue: scenario,
          onSelected: onScenarioChanged,
          itemBuilder: (_) => const [
            PopupMenuItem(
              value: ClientDemoScenario.normal,
              child: Text('Resultados normales'),
            ),
            PopupMenuItem(
              value: ClientDemoScenario.empty,
              child: Text('Sin resultados'),
            ),
            PopupMenuItem(
              value: ClientDemoScenario.error,
              child: Text('Error de conexión'),
            ),
          ],
        ),
      ],
    ),
  );
}

class LiveMarketplaceBanner extends StatelessWidget {
  const LiveMarketplaceBanner({super.key});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppColors.teal.withValues(alpha: .28)),
      borderRadius: BorderRadius.circular(14),
    ),
    child: const Row(
      children: [
        _LivePulse(),
        SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Turnos en tiempo real',
                style: TextStyle(
                  color: AppColors.navy,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
              SizedBox(height: 2),
              Text(
                'Las nuevas publicaciones aparecen automáticamente.',
                style: TextStyle(color: AppColors.muted, fontSize: 9),
              ),
            ],
          ),
        ),
        Icon(Icons.wifi_rounded, color: AppColors.tealDark, size: 19),
      ],
    ),
  );
}

class _LivePulse extends StatelessWidget {
  const _LivePulse();

  @override
  Widget build(BuildContext context) => Container(
    width: 34,
    height: 34,
    decoration: BoxDecoration(
      color: AppColors.tealSoft,
      borderRadius: BorderRadius.circular(10),
    ),
    child: const Icon(Icons.bolt_rounded, color: AppColors.tealDark, size: 19),
  );
}
