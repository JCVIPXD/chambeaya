import 'package:flutter/material.dart';

import '../../core/config/temporary_shifts.dart' as feature_flags;
import '../../core/navigation/adaptive_worker_scaffold.dart';
import '../../core/navigation/worker_destination.dart';
import '../../theme/app_theme.dart';
import '../../theme/theme_mode_controller.dart';
import '../auth/auth_repository.dart';
import '../discovery/worker_discovery_page.dart';
import '../jobs/job_postings_page.dart';
import '../jobs/jobs_hub_page.dart';
import '../jobs/jobs_services.dart';
import '../jobs/my_applications_page.dart';
import '../wallet/profile_completion_card.dart';
import '../wallet/wallet_page.dart';
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
    this.authRepository,
    this.sessionToken,
    this.googleOnlyAccount = false,
    this.temporaryShiftsEnabled = feature_flags.temporaryShiftsEnabled,
    this.jobsServices,
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

  /// Threaded straight into the Perfil tab's `ProfileHomePage` so it can
  /// offer "Cambiar contraseña" (see the fields with the same name there).
  final AuthRepository? authRepository;
  final String? sessionToken;
  final bool googleOnlyAccount;
  /// Con `false` (valor por defecto) la aplicación es solo de puestos fijos y
  /// moneda: no hay ninguna pantalla ni texto del flujo de turnos temporales.
  /// Con `true` se conservan las pestañas heredadas y se añaden las nuevas.
  final bool temporaryShiftsEnabled;

  /// Servicios de puestos fijos y billetera. Sin ellos (pruebas, demo aislado)
  /// la pantalla usa los servicios en memoria.
  final JobsServices? jobsServices;

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
  late final JobsServices _jobs;
  late final bool _ownsJobs;

  bool get _shifts => widget.temporaryShiftsEnabled;

  @override
  void initState() {
    super.initState();
    _ownsJobs = widget.jobsServices == null;
    _jobs = widget.jobsServices ?? JobsServices.demo();
  }

  @override
  void dispose() {
    if (_ownsJobs) _jobs.dispose();
    super.dispose();
  }

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
    final profilePage = ProfileHomePage(
      showNavigation: false,
      onLogout: widget.onLogout,
      talentProfileRepository: widget.talentProfileRepository,
      themeModeController: widget.themeModeController,
      authRepository: widget.authRepository,
      sessionToken: widget.sessionToken,
      googleOnlyAccount: widget.googleOnlyAccount,
      marketplaceRepository: _shifts ? widget.repository : null,
      temporaryShiftsEnabled: _shifts,
      completionBuilder: (context, profile) => ProfileCompletionCard(
        // Se vuelve a leer cuando cambia algo que cuenta para el criterio.
        key: ValueKey(
          '${profile.headline}|${profile.bio}|${profile.district}|'
          '${profile.availabilityDays.length}|${profile.availabilityPeriods.length}|'
          '${profile.specialties.length}|${profile.experiences.length}|'
          '${profile.cv != null}|${profile.photo != null}',
        ),
        wallet: _jobs.wallet,
        currencyName: _jobs.walletController.currencyName,
      ),
    );
    final invitationsPage = WorkerInvitationsPage(
      repository: widget.talentInvitationRepository,
      showShiftInfo: _shifts,
      wallet: _jobs.wallet,
      onResponded: _jobs.walletController.refresh,
    );
    final pages = _shifts
        ? [
            WorkerDiscoveryPage(
              repository: widget.repository,
              alertStore: widget.alertStore,
              workerName: widget.workerName,
              temporaryShiftsEnabled: widget.temporaryShiftsEnabled,
              onApplicationChanged: () => setState(() => _applicationRevision++),
            ),
            WorkerApplicationsPage(
              repository: widget.repository,
              applicationRevision: _applicationRevision,
            ),
            WorkerMessagesPage(repository: widget.repository),
            profilePage,
            invitationsPage,
            JobsHubPage(services: _jobs),
            WalletPage(
              services: _jobs,
              profileRepository: widget.talentProfileRepository,
            ),
          ]
        : [
            JobPostingsPage(
              services: _jobs,
              onApplicationChanged: () => setState(() => _applicationRevision++),
            ),
            MyApplicationsPage(
              services: _jobs,
              revision: _applicationRevision,
            ),
            WalletPage(
              services: _jobs,
              profileRepository: widget.talentProfileRepository,
            ),
            profilePage,
            invitationsPage,
          ];
    final scaffold = AdaptiveWorkerScaffold(
      destinations: _shifts ? legacyAndJobsDestinations : fixedJobsDestinations,
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
