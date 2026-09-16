import 'package:flutter/material.dart';

import '../../core/navigation/adaptive_worker_scaffold.dart';
import '../discovery/worker_discovery_page.dart';
import 'marketplace_repository.dart';
import '../profile/profile_home_page.dart';
import '../profile/talent_invitation_repository.dart';
import '../profile/talent_profile_repository.dart';
import '../profile/worker_invitations_page.dart';
import 'worker_secondary_pages.dart';
import '../discovery/search_alert_store.dart';

class WorkerShell extends StatefulWidget {
  WorkerShell({
    super.key,
    required this.repository,
    this.onLogout,
    this.workerName,
    this.initialIndex = 0,
    TalentProfileRepository? talentProfileRepository,
    TalentInvitationRepository? talentInvitationRepository,
    SearchAlertStore? alertStore,
  }) : talentProfileRepository =
           talentProfileRepository ??
           DemoTalentProfileRepository(name: workerName ?? 'Trabajador'),
       talentInvitationRepository =
           talentInvitationRepository ?? DemoTalentInvitationRepository(),
       alertStore = alertStore ?? InMemorySearchAlertStore();
  final WorkerMarketplaceRepository repository;
  final TalentProfileRepository talentProfileRepository;
  final TalentInvitationRepository talentInvitationRepository;
  final VoidCallback? onLogout;
  final String? workerName;
  final int initialIndex;
  final SearchAlertStore alertStore;
  @override
  State<WorkerShell> createState() => _WorkerShellState();
}

class _WorkerShellState extends State<WorkerShell> {
  late int selected = widget.initialIndex;
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
        talentProfileRepository: widget.talentProfileRepository,
      ),
      WorkerInvitationsPage(repository: widget.talentInvitationRepository),
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
