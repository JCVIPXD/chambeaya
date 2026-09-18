import 'package:flutter/material.dart';

import '../../../theme/app_theme.dart';

class DiscoveryHeader extends StatelessWidget {
  const DiscoveryHeader({
    super.key,
    required this.isAvailable,
    required this.onAvailabilityChanged,
    this.workerName,
  });

  final bool isAvailable;
  final ValueChanged<bool> onAvailabilityChanged;
  final String? workerName;

  String get _name => (workerName == null || workerName!.trim().isEmpty)
      ? 'Ana'
      : workerName!.trim().split(RegExp(r'\s+')).first;
  String get _initials {
    final parts = (workerName ?? 'Ana García').trim().split(RegExp(r'\s+'));
    return parts.take(2).map((part) => part[0].toUpperCase()).join();
  }

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        colors: [AppColors.navy, Color(0xFF29446F)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
      borderRadius: BorderRadius.circular(22),
      boxShadow: const [
        BoxShadow(
          color: AppColors.shadow,
          blurRadius: 18,
          offset: Offset(0, 7),
        ),
      ],
    ),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Hola, $_name',
                style: Theme.of(
                  context,
                ).textTheme.headlineSmall?.copyWith(color: Colors.white),
              ),
              const SizedBox(height: 5),
              const Text(
                'Tu próxima oportunidad puede empezar hoy',
                style: TextStyle(color: Color(0xFFD8E2F0), fontSize: 12),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.teal,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.circle, color: Colors.white, size: 8),
                        SizedBox(width: 6),
                        Text(
                          isAvailable ? 'Disponible' : 'No disponible',
                          style: TextStyle(
                            color: AppColors.navy,
                            fontWeight: FontWeight.w900,
                            fontSize: 10,
                          ),
                        ),
                        SizedBox(width: 4),
                        SizedBox(
                          width: 40,
                          height: 24,
                          child: Transform.scale(
                            scale: .72,
                            child: Switch.adaptive(
                              value: isAvailable,
                              onChanged: onAvailabilityChanged,
                              activeThumbColor: Colors.white,
                              activeTrackColor: AppColors.navy,
                              materialTapTargetSize:
                                  MaterialTapTargetSize.shrinkWrap,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const _HeaderStat(icon: Icons.star_rounded, label: '4.9'),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Container(
          width: 52,
          height: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: context.palette.surface,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.teal, width: 3),
          ),
          child: Text(
            _initials,
            style: TextStyle(
              color: context.palette.ink,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ],
    ),
  );
}

class _HeaderStat extends StatelessWidget {
  const _HeaderStat({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: .12),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: AppColors.gold, size: 14),
        const SizedBox(width: 5),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    ),
  );
}
