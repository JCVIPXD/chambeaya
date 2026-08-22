import 'package:flutter/material.dart';

import '../../../theme/app_theme.dart';

class DiscoveryHeader extends StatelessWidget {
  const DiscoveryHeader({super.key});

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Hola, Ana', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 5),
            const Text(
              'Encuentra un trabajo que encaje contigo hoy',
              style: TextStyle(color: AppColors.muted, fontSize: 13),
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.tealSoft,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.circle, color: AppColors.teal, size: 9),
                  SizedBox(width: 6),
                  Text(
                    'Disponible hoy',
                    style: TextStyle(
                      color: AppColors.teal,
                      fontWeight: FontWeight.w800,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      const CircleAvatar(
        radius: 24,
        backgroundColor: Color(0xFFDCE6ED),
        child: Text(
          'AG',
          style: TextStyle(color: AppColors.navy, fontWeight: FontWeight.w800),
        ),
      ),
    ],
  );
}
