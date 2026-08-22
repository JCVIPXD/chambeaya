import 'package:flutter/material.dart';

class JobSearchBar extends StatelessWidget {
  const JobSearchBar({
    super.key,
    required this.onChanged,
    required this.onOpenFilters,
  });

  final ValueChanged<String> onChanged;
  final VoidCallback onOpenFilters;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Semantics(
          label: 'Buscar empleos',
          textField: true,
          enabled: true,
          child: TextField(
            onChanged: onChanged,
            decoration: const InputDecoration(
              hintText: 'Cargo, empresa o distrito',
              prefixIcon: Icon(Icons.search_rounded),
            ),
          ),
        ),
      ),
      const SizedBox(width: 10),
      Semantics(
        label: 'Abrir filtros',
        button: true,
        child: IconButton.filledTonal(
          onPressed: onOpenFilters,
          icon: const Icon(Icons.tune_rounded),
          tooltip: 'Filtros',
        ),
      ),
    ],
  );
}
