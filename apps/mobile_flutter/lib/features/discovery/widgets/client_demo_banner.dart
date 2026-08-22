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
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    decoration: BoxDecoration(
      color: AppColors.tealSoft,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      children: [
        const Icon(Icons.science_outlined, color: AppColors.teal, size: 19),
        const SizedBox(width: 8),
        const Expanded(
          child: Text(
            'Datos de demostración',
            style: TextStyle(
              color: AppColors.navy,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
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
