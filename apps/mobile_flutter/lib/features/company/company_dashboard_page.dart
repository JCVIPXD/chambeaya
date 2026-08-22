import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../marketplace/marketplace_data.dart';

class CompanyDashboardPage extends StatelessWidget {
  const CompanyDashboardPage({this.onLogout, super.key});

  final VoidCallback? onLogout;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text(
        'Panel Empresa',
        style: TextStyle(color: AppColors.navy, fontWeight: FontWeight.w800),
      ),
      actions: [
        IconButton(
          tooltip: 'Cerrar sesión',
          onPressed: onLogout,
          icon: const Icon(Icons.logout_rounded),
        ),
      ],
    ),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: () {},
      backgroundColor: AppColors.teal,
      icon: const Icon(Icons.add),
      label: const Text('Publicar turno'),
    ),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 94),
      children: [
        const Text(
          'Restaurante La Mar',
          style: TextStyle(color: AppColors.muted, fontSize: 13),
        ),
        const SizedBox(height: 18),
        Row(
          children: [
            _Metric(
              value: '${companyMetrics.activeShifts}',
              label: 'Turnos\nactivos',
              icon: Icons.calendar_month_outlined,
            ),
            const SizedBox(width: 10),
            _Metric(
              value: '${companyMetrics.coverage}%',
              label: 'Cobertura',
              icon: Icons.pie_chart_outline_rounded,
            ),
            const SizedBox(width: 10),
            _Metric(
              value: '${companyMetrics.onTime}/${companyMetrics.activeShifts}',
              label: 'A tiempo',
              icon: Icons.person_pin_circle_outlined,
            ),
          ],
        ),
        const SizedBox(height: 24),
        _Section(
          title: 'Acciones rápidas',
          child: Row(
            children: [
              Expanded(
                child: _Action(
                  icon: Icons.add_business_outlined,
                  label: 'Publicar\nturno',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _Action(
                  icon: Icons.people_outline,
                  label: 'Ver\ntrabajadores',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _Action(
                  icon: Icons.payments_outlined,
                  label: 'Gestionar\npagos',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(17),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF4E5),
            border: Border.all(color: const Color(0xFFF7D8A9)),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.bolt_rounded,
                color: Color(0xFFF59E0B),
                size: 26,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'CUMPLE Rescate',
                      style: TextStyle(
                        color: AppColors.navy,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Faltó 1 trabajador para el turno de esta noche.',
                      style: TextStyle(color: AppColors.muted, fontSize: 12),
                    ),
                    const SizedBox(height: 10),
                    FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFFF59E0B),
                      ),
                      onPressed: () {},
                      child: const Text('Activar rescate IA'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        _Section(
          title: 'Cobertura en tiempo real',
          child: Column(
            children: availableShifts
                .take(2)
                .map(
                  (shift) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(
                      backgroundColor: AppColors.tealSoft,
                      child: Icon(Icons.person_outline, color: AppColors.teal),
                    ),
                    title: Text(
                      shift.title,
                      style: const TextStyle(
                        color: AppColors.navy,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    subtitle: Text(
                      shift.company,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 11,
                      ),
                    ),
                    trailing: Text(
                      '${shift.match}%',
                      style: const TextStyle(
                        color: AppColors.teal,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
        ),
      ],
    ),
  );
}

class _Metric extends StatelessWidget {
  const _Metric({required this.value, required this.label, required this.icon});
  final String value;
  final String label;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Expanded(
    child: Container(
      height: 113,
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.teal, size: 22),
          const Spacer(),
          Text(
            value,
            style: const TextStyle(
              color: AppColors.navy,
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.muted,
              fontSize: 10,
              height: 1.1,
            ),
          ),
        ],
      ),
    ),
  );
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.label});
  final IconData icon;
  final String label;
  @override
  Widget build(BuildContext context) => Container(
    height: 94,
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppColors.border),
      borderRadius: BorderRadius.circular(13),
    ),
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, color: AppColors.teal),
        const SizedBox(height: 8),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: AppColors.navy,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(title, style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 12),
      child,
    ],
  );
}
