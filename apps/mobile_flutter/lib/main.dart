import 'package:flutter/material.dart';

import 'features/auth/auth_page.dart';
import 'features/auth/auth_repository.dart';
import 'features/auth/auth_session.dart';
import 'features/auth/auth_session_store.dart';
import 'features/company/company_dashboard_page.dart';
import 'features/marketplace/http_worker_marketplace_repository.dart';
import 'features/profile/talent_invitation_repository.dart';
import 'features/profile/talent_profile_repository.dart';
import 'features/marketplace/marketplace_repository.dart';
import 'features/marketplace/worker_shell.dart';
import 'features/onboarding/onboarding_page.dart';
import 'features/discovery/search_alert_store.dart';
import 'theme/app_theme.dart';
import 'theme/theme_mode_controller.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ChambeayaApp());
}

class ChambeayaApp extends StatefulWidget {
  const ChambeayaApp({
    super.key,
    this.sessionStore,
    this.authRepository,
    this.demoModeOverride,
    this.themeModeController,
  });

  final AuthSessionStore? sessionStore;
  final AuthRepository? authRepository;

  /// Test-only override. Production builds select demo mode exclusively through
  /// the explicit CHAMBEAYA_DEMO_MODE dart define.
  final bool? demoModeOverride;

  /// Test-only override for the persisted appearance preference. Production
  /// builds always start from `ThemeModeController()` (system default, then
  /// whatever the worker chose last, read from `SharedPreferences`).
  final ThemeModeController? themeModeController;

  @override
  State<ChambeayaApp> createState() => _ChambeayaAppState();
}

class _ChambeayaAppState extends State<ChambeayaApp> {
  static const _configuredDemoMode = bool.fromEnvironment(
    'CHAMBEAYA_DEMO_MODE',
    defaultValue: false,
  );

  late final AuthSessionStore _sessionStore;
  late final AuthRepository _authRepository;
  late final ThemeModeController _themeMode;
  // Created once, on first use, instead of inline inside `build()`. `build()`
  // used to construct a fresh `HttpWorkerMarketplaceRepository`/
  // `DemoWorkerMarketplaceRepository` (and the profile/invitation
  // repositories) on every rebuild of this root widget, which discarded
  // their in-memory state (demo applications/saved shifts, and
  // `HttpWorkerMarketplaceRepository`'s local caches — see its own comments
  // on why those exist) and leaked an `http.Client` per throwaway instance.
  // That used to bite on every dark-mode toggle, back when this State also
  // listened to `_themeMode` and called `setState` purely to rebuild
  // `MaterialApp` — see CN-20260917-106. These are now recreated only when
  // the underlying session actually changes (login/logout/re-login).
  final SearchAlertStore _alertStore = SharedPreferencesSearchAlertStore();
  WorkerMarketplaceRepository? _workerRepository;
  TalentProfileRepository? _talentProfileRepository;
  TalentInvitationRepository? _talentInvitationRepository;
  String? _workerDependenciesKey;
  AppAudience? _audience;
  AuthSession? _session;
  var _restoringSession = true;

  bool get _isDemoMode => widget.demoModeOverride ?? _configuredDemoMode;
  bool get _usesLiveApi => !_isDemoMode;

  @override
  void initState() {
    super.initState();
    _sessionStore = widget.sessionStore ?? SharedPreferencesAuthSessionStore();
    _authRepository = widget.authRepository ?? AuthRepository();
    _themeMode = widget.themeModeController ?? ThemeModeController();
    // No listener on `_themeMode` here: `MaterialApp.theme` below is a
    // constant light theme regardless of `_themeMode`'s value, so rebuilding
    // this root on a theme change would serve no purpose (see the `theme:`
    // comment in `build()`). Dark mode is applied locally by `WorkerShell`,
    // which listens to `_themeMode` itself via its own `AnimatedBuilder`.
    _loadThemeMode();
    _restoreSession();
  }

  /// Creates (once per session) and reuses the worker panel's marketplace,
  /// talent profile and talent invitation repositories, so a rebuild of this
  /// root widget (however it is triggered) never discards their in-memory
  /// state. Recomputed only when the live/demo mode or the session's
  /// token/name actually changes.
  void _ensureWorkerDependencies() {
    final key = '$_usesLiveApi|${_session?.token}|${_session?.name}';
    if (_workerDependenciesKey == key && _workerRepository != null) return;
    _workerDependenciesKey = key;
    _workerRepository = _usesLiveApi
        ? HttpWorkerMarketplaceRepository(token: _session?.token)
        : DemoWorkerMarketplaceRepository();
    _talentProfileRepository = _usesLiveApi
        ? HttpTalentProfileRepository(token: _session?.token)
        : DemoTalentProfileRepository(name: _session?.name ?? 'Trabajador');
    _talentInvitationRepository = _usesLiveApi
        ? HttpTalentInvitationRepository(token: _session?.token)
        : DemoTalentInvitationRepository();
  }

  Future<void> _loadThemeMode() async {
    try {
      await _themeMode.load();
    } catch (_) {
      // Keep the in-memory default (system brightness) if local storage
      // fails to read the saved preference, same as `_restoreSession` does
      // for the auth session.
    }
  }

  @override
  void dispose() {
    if (widget.themeModeController == null) _themeMode.dispose();
    super.dispose();
  }

  Future<void> _restoreSession() async {
    AuthSession? restored;
    try {
      restored = await _sessionStore.read();
      if (restored != null && _usesLiveApi) {
        restored = await _authRepository.restore(restored.token);
        await _sessionStore.write(restored);
      }
    } catch (_) {
      try {
        await _sessionStore.clear();
      } catch (_) {
        // The application must still leave the startup state if local storage fails.
      }
      restored = null;
    }
    if (!mounted) return;
    setState(() {
      _session = restored;
      _audience = restored?.audience;
      _restoringSession = false;
    });
  }

  Future<void> _authenticated(AuthSession session) async {
    await _sessionStore.write(session);
    if (!mounted) return;
    setState(() {
      _session = session;
      _audience = session.audience;
    });
  }

  Future<void> _logout() async {
    final token = _session?.token;
    if (_usesLiveApi && token != null) {
      try {
        await _authRepository.logout(token);
      } catch (_) {
        // El cierre local siempre debe completarse aunque la API esté desconectada.
      }
    }
    await _sessionStore.clear();
    if (!mounted) return;
    setState(() {
      _session = null;
      _audience = null;
    });
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Chambeaya',
    debugShowCheckedModeBanner: false,
    // Intentionally no `darkTheme`/`themeMode` here: `ThemeData` set this way
    // is global to the whole `MaterialApp`, so it would apply to onboarding,
    // auth and the company dashboard too, none of which have been migrated
    // to dark colors and would render illegibly. Dark mode is scoped to the
    // worker panel only, via a local `AnimatedTheme` inside `WorkerShell`
    // driven by `_themeMode`.
    theme: buildAppTheme(Brightness.light),
    builder: (context, child) => MediaQuery.withClampedTextScaling(
      minScaleFactor: 1,
      maxScaleFactor: 2,
      child: child!,
    ),
    home: _buildHome(),
  );

  Widget _buildHome() {
    if (_restoringSession) {
      return const Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(semanticsLabel: 'Restaurando sesión'),
              SizedBox(height: 16),
              Text('Preparando tu espacio...'),
            ],
          ),
        ),
      );
    }
    if (_audience == null) {
      return OnboardingPage(
        onComplete: (value) => setState(() => _audience = value),
      );
    }
    if (_session == null || _session!.requiresPasswordSetup) {
      return AuthPage(
        role: _audience!,
        demoMode: _isDemoMode,
        repository: _authRepository,
        onAuthenticated: _authenticated,
        initialGooglePasswordSetupSession:
            _session?.requiresPasswordSetup == true ? _session : null,
      );
    }
    if (_audience == AppAudience.company) {
      return CompanyDashboardPage(onLogout: () => _logout());
    }
    _ensureWorkerDependencies();
    return WorkerShell(
      onLogout: () => _logout(),
      workerName: _session?.name,
      initialIndex: _session?.openProfileAfterSignIn == true ? 3 : 0,
      alertStore: _alertStore,
      themeModeController: _themeMode,
      repository: _workerRepository!,
      talentProfileRepository: _talentProfileRepository!,
      talentInvitationRepository: _talentInvitationRepository!,
    );
  }
}
