import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../responsive/app_breakpoints.dart';
import 'worker_destination.dart';

class AdaptiveWorkerScaffold extends StatelessWidget {
  const AdaptiveWorkerScaffold({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.body,
  });

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final Widget body;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final layout = classifyLayout(constraints.maxWidth);
      return switch (layout) {
        AppLayoutClass.mobile => Scaffold(
          body: SafeArea(bottom: false, child: body),
          bottomNavigationBar: NavigationBar(
            selectedIndex: selectedIndex,
            indicatorColor: AppColors.tealSoft,
            onDestinationSelected: onDestinationSelected,
            destinations: workerDestinations
                .map(
                  (destination) => NavigationDestination(
                    icon: Icon(destination.icon),
                    selectedIcon: Icon(
                      destination.selectedIcon,
                      color: AppColors.teal,
                    ),
                    label: destination.label,
                  ),
                )
                .toList(),
          ),
        ),
        AppLayoutClass.tablet => Scaffold(
          body: Row(
            children: [
              SafeArea(
                child: NavigationRail(
                  selectedIndex: selectedIndex,
                  onDestinationSelected: onDestinationSelected,
                  labelType: NavigationRailLabelType.all,
                  indicatorColor: AppColors.tealSoft,
                  destinations: workerDestinations
                      .map(
                        (destination) => NavigationRailDestination(
                          icon: Icon(destination.icon),
                          selectedIcon: Icon(
                            destination.selectedIcon,
                            color: AppColors.teal,
                          ),
                          label: Text(destination.label),
                        ),
                      )
                      .toList(),
                ),
              ),
              const VerticalDivider(width: 1, color: AppColors.border),
              Expanded(child: body),
            ],
          ),
        ),
        AppLayoutClass.desktop => Scaffold(
          body: Row(
            children: [
              _DesktopSidebar(
                selectedIndex: selectedIndex,
                onDestinationSelected: onDestinationSelected,
              ),
              Expanded(child: body),
            ],
          ),
        ),
      };
    },
  );
}

class _DesktopSidebar extends StatelessWidget {
  const _DesktopSidebar({
    required this.selectedIndex,
    required this.onDestinationSelected,
  });

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;

  @override
  Widget build(BuildContext context) => Container(
    width: 240,
    color: Colors.white,
    padding: const EdgeInsets.fromLTRB(18, 24, 18, 20),
    child: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Text(
              'CUMPLE NOW',
              style: TextStyle(
                color: AppColors.navy,
                fontSize: 19,
                fontWeight: FontWeight.w900,
                letterSpacing: -.5,
              ),
            ),
          ),
          const SizedBox(height: 26),
          ...workerDestinations.indexed.map((entry) {
            final index = entry.$1;
            final destination = entry.$2;
            final selected = index == selectedIndex;
            return Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Semantics(
                selected: selected,
                button: true,
                label: destination.label,
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => onDestinationSelected(index),
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 48),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 13,
                      vertical: 11,
                    ),
                    decoration: BoxDecoration(
                      color: selected ? AppColors.tealSoft : Colors.transparent,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          selected
                              ? destination.selectedIcon
                              : destination.icon,
                          color: selected ? AppColors.teal : AppColors.muted,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            destination.label,
                            style: TextStyle(
                              color: selected
                                  ? AppColors.navy
                                  : AppColors.muted,
                              fontWeight: selected
                                  ? FontWeight.w800
                                  : FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          }),
          const Spacer(),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.tealSoft,
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Text(
              'Modo demostración\nDatos locales seguros',
              style: TextStyle(
                color: AppColors.navy,
                fontSize: 12,
                height: 1.4,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
