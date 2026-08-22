import 'package:flutter/material.dart';

import '../../marketplace/marketplace_data.dart';
import '../discovery_controller.dart';

class JobFilterControls extends StatelessWidget {
  const JobFilterControls({
    super.key,
    required this.controller,
    this.expanded = false,
  });

  final DiscoveryController controller;
  final bool expanded;

  @override
  Widget build(BuildContext context) {
    final filter = controller.state.filter;
    final locations =
        controller.shifts.map((shift) => shift.location).toSet().toList()
          ..sort();
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        FilterChip(
          label: const Text('Recomendados'),
          selected: filter.recommendedOnly,
          onSelected: controller.setRecommendedOnly,
        ),
        FilterChip(
          label: const Text('Urgentes'),
          selected: filter.urgentOnly,
          onSelected: controller.setUrgentOnly,
        ),
        if (expanded) ...[
          _FilterDropdown<ShiftIndustry?>(
            label: 'Rubro',
            value: filter.industry,
            items: const {
              null: 'Todos los rubros',
              ShiftIndustry.hospitality: 'Hotelería',
              ShiftIndustry.foodService: 'Alimentos y bebidas',
              ShiftIndustry.retail: 'Ventas',
              ShiftIndustry.events: 'Eventos',
            },
            onChanged: controller.setIndustry,
          ),
          _FilterDropdown<int>(
            label: 'Pago mínimo',
            value: filter.minimumPayCents,
            items: const {
              0: 'Cualquier pago',
              9000: 'Desde S/ 90',
              11000: 'Desde S/ 110',
            },
            onChanged: controller.setMinimumPayCents,
          ),
          _FilterDropdown<String?>(
            label: 'Distrito',
            value: filter.location,
            items: {
              null: 'Todos los distritos',
              for (final location in locations) location: location,
            },
            onChanged: controller.setLocation,
          ),
          _FilterDropdown<ShiftDateScope>(
            label: 'Fecha',
            value: filter.dateScope,
            items: const {
              ShiftDateScope.any: 'Cualquier fecha',
              ShiftDateScope.today: 'Hoy',
              ShiftDateScope.tomorrow: 'Mañana',
              ShiftDateScope.weekend: 'Fin de semana',
            },
            onChanged: controller.setDateScope,
          ),
          _FilterDropdown<ShiftSortOrder>(
            label: 'Orden',
            value: filter.sortOrder,
            items: const {
              ShiftSortOrder.recommended: 'Más compatibles',
              ShiftSortOrder.highestPay: 'Mayor pago',
            },
            onChanged: controller.setSortOrder,
          ),
        ],
        if (filter.hasActiveFilters)
          TextButton.icon(
            onPressed: controller.clearFilters,
            icon: const Icon(Icons.restart_alt_rounded),
            label: Text('Limpiar (${filter.activeFilterCount})'),
          ),
      ],
    );
  }
}

class _FilterDropdown<T> extends StatelessWidget {
  const _FilterDropdown({
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final String label;
  final T value;
  final Map<T, String> items;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minWidth: 170, maxWidth: 220),
    padding: const EdgeInsets.symmetric(horizontal: 12),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: Theme.of(context).dividerColor),
      borderRadius: BorderRadius.circular(12),
    ),
    child: DropdownButtonHideUnderline(
      child: DropdownButton<T>(
        value: value,
        isExpanded: true,
        borderRadius: BorderRadius.circular(12),
        hint: Text(label),
        items: items.entries
            .map(
              (entry) => DropdownMenuItem<T>(
                value: entry.key,
                child: Text(entry.value, overflow: TextOverflow.ellipsis),
              ),
            )
            .toList(),
        onChanged: (next) {
          if (next != null || items.containsKey(null)) onChanged(next as T);
        },
      ),
    ),
  );
}
