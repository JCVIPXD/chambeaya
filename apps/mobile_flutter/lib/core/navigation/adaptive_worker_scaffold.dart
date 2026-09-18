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
              VerticalDivider(width: 1, color: context.palette.border),
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
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Container(
      width: 252,
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(right: BorderSide(color: palette.border)),
      ),
      padding: const EdgeInsets.fromLTRB(18, 24, 18, 18),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              child: Row(
                children: [
                  const _BrandMark(),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'CHAMBEAYA',
                          style: TextStyle(
                            color: palette.ink,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.5,
                          ),
                        ),
                        Text(
                          'TRABAJO A TU RITMO',
                          style: TextStyle(
                            color: palette.muted,
                            fontSize: 8,
                            fontWeight: FontWeight.w800,
                            letterSpacing: .7,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(13, 22, 13, 8),
              child: Text(
                'TU ESPACIO',
                style: TextStyle(
                  color: palette.muted,
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1,
                ),
              ),
            ),
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
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      curve: Curves.easeOut,
                      constraints: const BoxConstraints(minHeight: 48),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 13,
                        vertical: 11,
                      ),
                      decoration: BoxDecoration(
                        color: selected
                            ? palette.accentSoft
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: selected
                              ? AppColors.teal.withValues(alpha: .22)
                              : Colors.transparent,
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            selected
                                ? destination.selectedIcon
                                : destination.icon,
                            color: selected ? AppColors.teal : palette.muted,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              destination.label,
                              style: TextStyle(
                                color: selected ? palette.ink : palette.muted,
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
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppColors.navy, Color(0xFF243E68)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(18),
                boxShadow: const [
                  BoxShadow(
                    color: AppColors.shadow,
                    blurRadius: 18,
                    offset: Offset(0, 7),
                  ),
                ],
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.bolt_rounded, color: AppColors.gold, size: 18),
                      SizedBox(width: 7),
                      Expanded(
                        child: Text(
                          'Perfil en crecimiento',
                          maxLines: 2,
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 12),
                  Text(
                    'Haz que te encuentren',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Agrega tu experiencia, distrito y especialidades para aparecer en búsquedas relevantes.',
                    style: TextStyle(
                      color: Color(0xFFD8E2F0),
                      fontSize: 10,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) => Container(
    width: 38,
    height: 38,
    decoration: BoxDecoration(
      color: AppColors.teal,
      borderRadius: BorderRadius.circular(12),
    ),
    child: const Icon(Icons.bolt_rounded, color: AppColors.navy, size: 23),
  );
}
