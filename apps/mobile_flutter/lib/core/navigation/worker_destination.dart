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
  WorkerDestination(
    label: 'Invitaciones',
    icon: Icons.mail_outline_rounded,
    selectedIcon: Icons.mail_rounded,
  ),
];

/// Destinos del trabajador con los turnos temporales apagados (el producto
/// vigente): puestos fijos, postulaciones, billetera, perfil e invitaciones.
/// Perfil conserva el índice 3 para quien abre el perfil al terminar de
/// registrarse.
const fixedJobsDestinations = <WorkerDestination>[
  WorkerDestination(
    label: 'Puestos',
    icon: Icons.work_outline_rounded,
    selectedIcon: Icons.work_rounded,
  ),
  WorkerDestination(
    label: 'Postulaciones',
    icon: Icons.work_history_outlined,
    selectedIcon: Icons.work_history_rounded,
  ),
  WorkerDestination(
    label: 'Billetera',
    icon: Icons.account_balance_wallet_outlined,
    selectedIcon: Icons.account_balance_wallet_rounded,
  ),
  WorkerDestination(
    label: 'Perfil',
    icon: Icons.person_outline_rounded,
    selectedIcon: Icons.person_rounded,
  ),
  WorkerDestination(
    label: 'Invitaciones',
    icon: Icons.mail_outline_rounded,
    selectedIcon: Icons.mail_rounded,
  ),
];

/// Con los turnos temporales encendidos se conservan los cinco destinos
/// heredados sin cambios y se añaden los de puestos fijos y billetera.
const legacyAndJobsDestinations = <WorkerDestination>[
  ...workerDestinations,
  WorkerDestination(
    label: 'Puestos fijos',
    icon: Icons.business_center_outlined,
    selectedIcon: Icons.business_center_rounded,
  ),
  WorkerDestination(
    label: 'Billetera',
    icon: Icons.account_balance_wallet_outlined,
    selectedIcon: Icons.account_balance_wallet_rounded,
  ),
];
