import 'package:flutter/material.dart';

class WorkerDestination {
  const WorkerDestination({
    required this.label,
    required this.icon,
    required this.selectedIcon,
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

const workerDestinations = <WorkerDestination>[
  WorkerDestination(
    label: 'Inicio',
    icon: Icons.home_outlined,
    selectedIcon: Icons.home_rounded,
  ),
  WorkerDestination(
    label: 'Postulaciones',
    icon: Icons.work_history_outlined,
    selectedIcon: Icons.work_history_rounded,
  ),
  WorkerDestination(
    label: 'Mensajes',
    icon: Icons.chat_bubble_outline_rounded,
    selectedIcon: Icons.chat_bubble_rounded,
  ),
  WorkerDestination(
    label: 'Perfil',
    icon: Icons.person_outline_rounded,
    selectedIcon: Icons.person_rounded,
  ),
];
