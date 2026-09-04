import 'package:flutter/material.dart';

import '../../core/navigation/adaptive_worker_scaffold.dart';
import '../discovery/worker_discovery_page.dart';
import 'marketplace_repository.dart';
import '../profile/profile_home_page.dart';
import 'worker_secondary_pages.dart';
import '../discovery/search_alert_store.dart';

class WorkerShell extends StatefulWidget {
  WorkerShell({
    super.key,
    required this.repository,
    this.onLogout,
    this.workerName,
    SearchAlertStore? alertStore,
  }) : alertStore = alertStore ?? InMemorySearchAlertStore();
  final WorkerMarketplaceRepository repository;
  final VoidCallback? onLogout;
  final String? workerName;
  final SearchAlertStore alertStore;
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
        alertStore: widget.alertStore,
        workerName: widget.workerName,
        onApplicationChanged: () => setState(() => _applicationRevision++),
      ),
      WorkerApplicationsPage(
        key: ValueKey(_applicationRevision),
        repository: widget.repository,
      ),
      WorkerMessagesPage(repository: widget.repository),
      ProfileHomePage(
        showNavigation: false,
        onLogout: widget.onLogout,
        repository: widget.repository,
        workerName: widget.workerName,
      ),
    ];
    return AdaptiveWorkerScaffold(
      selectedIndex: selected,
      onDestinationSelected: (value) => setState(() {
        selected = value;
        if (value == 1) _applicationRevision++;
      }),
      body: IndexedStack(index: selected, children: pages),
    );
  }
}
