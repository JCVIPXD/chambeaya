import 'package:flutter/material.dart';

import '../../core/navigation/adaptive_worker_scaffold.dart';
import '../discovery/worker_discovery_page.dart';
import 'marketplace_repository.dart';
import '../profile/profile_home_page.dart';
import 'worker_secondary_pages.dart';
import 'worker_pages.dart';

class WorkerShell extends StatefulWidget {
  const WorkerShell({super.key, required this.repository, this.onLogout});
  final WorkerMarketplaceRepository repository;
  final VoidCallback? onLogout;
  @override
  State<WorkerShell> createState() => _WorkerShellState();
}

class _WorkerShellState extends State<WorkerShell> {
  var selected = 0;
  var _applicationRevision = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      WorkerDiscoveryPage(
        repository: widget.repository,
        onApplicationChanged: () => setState(() => _applicationRevision++),
      ),
      ShiftsPage(
        repository: widget.repository,
        onAccepted: (shift) => ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Turno de ${shift.company} aceptado correctamente.'),
          ),
        ),
      ),
      WorkerApplicationsPage(
        key: ValueKey(_applicationRevision),
        repository: widget.repository,
      ),
      const WorkerMessagesPage(),
      ProfileHomePage(showNavigation: false, onLogout: widget.onLogout),
    ];
    return AdaptiveWorkerScaffold(
      selectedIndex: selected,
      onDestinationSelected: (value) => setState(() {
        selected = value;
        if (value == 2) _applicationRevision++;
      }),
      body: IndexedStack(index: selected, children: pages),
    );
  }
}
