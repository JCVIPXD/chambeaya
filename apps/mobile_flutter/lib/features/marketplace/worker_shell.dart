import 'package:flutter/material.dart';

import '../../core/navigation/adaptive_worker_scaffold.dart';
import '../../theme/app_theme.dart';
import '../../theme/theme_mode_controller.dart';
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
    this.themeModeController,
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

  /// Optional: lets the profile tab expose a "Modo oscuro" toggle. Widget
  /// tests that build `WorkerShell` directly (without the app's
  /// `ChambeayaApp` shell) can omit it; the profile tab then simply does not
  /// render the toggle, matching prior behavior.
  final ThemeModeController? themeModeController;

  @override
  State<WorkerShell> createState() => _WorkerShellState();
}

class _WorkerShellState extends State<WorkerShell> {
  late int selected = widget.initialIndex;
  var _applicationRevision = 0;
  var _contentVisible = true;

  void _selectTab(int value) {
    // Re-tapping the already active tab keeps the prior behavior exactly
    // (still bumps `_applicationRevision` to force Postulaciones to reload,
    // used as a manual refresh): only an actual tab change gets the fade, so
    // the animation never delays that refresh.
    final changingTab = value != selected;
    void apply() {
      if (!mounted) return;
      setState(() {
        selected = value;
        if (value == 1) _applicationRevision++;
        _contentVisible = true;
      });
    }

    if (!changingTab) {
      apply();
      return;
    }
    setState(() => _contentVisible = false);
    // A post-frame callback (not `Future.microtask`, which drains before the
    // engine ever renders the `_contentVisible = false` frame and would
    // collapse both `setState` calls into a single build, so the opacity
    // never visibly changes) waits for that frame to actually be rendered
    // before swapping the page and fading back in, so the cross-fade is a
    // real transition rather than an instant no-op.
    WidgetsBinding.instance.addPostFrameCallback((_) => apply());
  }

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
        repository: widget.repository,
        applicationRevision: _applicationRevision,
      ),
      WorkerMessagesPage(repository: widget.repository),
      ProfileHomePage(
        showNavigation: false,
        onLogout: widget.onLogout,
        talentProfileRepository: widget.talentProfileRepository,
        themeModeController: widget.themeModeController,
      ),
      WorkerInvitationsPage(repository: widget.talentInvitationRepository),
    ];
    final scaffold = AdaptiveWorkerScaffold(
      selectedIndex: selected,
      onDestinationSelected: _selectTab,
      // IndexedStack keeps every tab mounted (so background polling in
      // Postulaciones/Mensajes keeps running and scroll state survives a
      // switch); the AnimatedOpacity around it only cross-fades what is
      // already there, it never remounts a page.
      //
      // Each page is wrapped in a `TickerMode` that is enabled only for the
      // visible tab. `IndexedStack` (unlike `Visibility`) does not mute the
      // tickers of its hidden children, so every implicit animation inside
      // an offstage tab kept running and rebuilding: notably each `Material`
      // (cards, scaffolds) animates its own 200 ms color/text-style change
      // when the theme flips, so a dark-mode toggle still rebuilt the four
      // tabs the worker cannot even see (CN-20260921-003). A muted ticker
      // does not advance, and jumps to the end state as soon as the tab is
      // shown again, so the hidden tabs are correct by the time they appear.
      // Timers (background polling) are not tickers and are unaffected.
      body: AnimatedOpacity(
        key: const Key('worker-shell-tab-fade'),
        opacity: _contentVisible ? 1 : 0,
        duration: const Duration(milliseconds: 140),
        curve: Curves.easeOut,
        child: IndexedStack(
          index: selected,
          children: [
            for (var i = 0; i < pages.length; i++)
              TickerMode(enabled: i == selected, child: pages[i]),
          ],
        ),
      ),
    );

    final controller = widget.themeModeController;
    if (controller == null) return scaffold;

    // Dark mode is scoped to exactly this subtree via a local `Theme` instead
    // of `MaterialApp.darkTheme`/`themeMode` (which are global and would also
    // darken onboarding, auth and the company dashboard, none of which have
    // migrated colors — see CN-20260917-104). `AnimatedBuilder` with a static
    // `child` re-wraps only the theme, it never rebuilds the scaffold/pages
    // subtree itself on a toggle.
    //
    // This used to be an `AnimatedTheme` (220 ms): every animation tick built
    // a new interpolated `ThemeData`, which notified every widget that reads
    // `Theme.of`/`context.palette` on each of ~14 frames, and `IndexedStack`
    // keeps all five tabs mounted, so all of them, visible or not. Measured
    // in CN-20260921-003: ~26,000 element rebuilds per toggle versus ~1,000
    // for a single swap. The new theme is now applied in one frame; the
    // switch's own icon (`_AppearanceCard`) keeps its local animation as the
    // visible feedback.
    return AnimatedBuilder(
      animation: controller,
      // `resolveIsDark` (not `controller.isDark`) so a `ThemeMode.system`
      // preference resolves from this `BuildContext`'s `MediaQuery` instead
      // of reading `PlatformDispatcher.instance` directly: that live-updates
      // on a system brightness change and honors a `MediaQuery` override in
      // widget tests, neither of which the raw `PlatformDispatcher` read did.
      builder: (context, child) => Theme(
        data: buildAppTheme(
          controller.resolveIsDark(MediaQuery.platformBrightnessOf(context))
              ? Brightness.dark
              : Brightness.light,
        ),
        child: child!,
      ),
      child: scaffold,
    );
  }
}
