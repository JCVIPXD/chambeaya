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

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const CumpleNowApp());
}

class CumpleNowApp extends StatefulWidget {
  const CumpleNowApp({
    super.key,
    this.sessionStore,
    this.authRepository,
    this.demoModeOverride,
  });

  final AuthSessionStore? sessionStore;
  final AuthRepository? authRepository;

  /// Test-only override. Production builds select demo mode exclusively through
  /// the explicit CUMPLENOW_DEMO_MODE dart define.
  final bool? demoModeOverride;

  @override
  State<CumpleNowApp> createState() => _CumpleNowAppState();
}

class _CumpleNowAppState extends State<CumpleNowApp> {
  static const _configuredDemoMode = bool.fromEnvironment(
    'CUMPLENOW_DEMO_MODE',
    defaultValue: false,
  );

  late final AuthSessionStore _sessionStore;
  late final AuthRepository _authRepository;
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
    _restoreSession();
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
    title: 'Cumple Now',
    debugShowCheckedModeBanner: false,
    theme: buildAppTheme(),
    builder: (context, child) => MediaQuery.withClampedTextScaling(
      minScaleFactor: 1,
      maxScaleFactor: 2,
      child: child!,
    ),
    home: _restoringSession
        ? const Scaffold(
            body: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(
                    semanticsLabel: 'Restaurando sesión',
                  ),
                  SizedBox(height: 16),
                  Text('Preparando tu espacio...'),
                ],
              ),
            ),
          )
        : _audience == null
        ? OnboardingPage(
            onComplete: (value) => setState(() => _audience = value),
          )
        : _session == null || _session!.requiresPasswordSetup
        ? AuthPage(
            role: _audience!,
            demoMode: _isDemoMode,
            repository: _authRepository,
            onAuthenticated: _authenticated,
            initialGooglePasswordSetupSession:
                _session?.requiresPasswordSetup == true ? _session : null,
          )
        : _audience == AppAudience.company
        ? CompanyDashboardPage(onLogout: () => _logout())
        : WorkerShell(
            onLogout: () => _logout(),
            workerName: _session?.name,
            initialIndex: _session?.openProfileAfterSignIn == true ? 3 : 0,
            alertStore: SharedPreferencesSearchAlertStore(),
            repository: _usesLiveApi
                ? HttpWorkerMarketplaceRepository(token: _session?.token)
                : DemoWorkerMarketplaceRepository(),
            talentProfileRepository: _usesLiveApi
                ? HttpTalentProfileRepository(token: _session?.token)
                : DemoTalentProfileRepository(
                    name: _session?.name ?? 'Trabajador',
                  ),
            talentInvitationRepository: _usesLiveApi
                ? HttpTalentInvitationRepository(token: _session?.token)
                : DemoTalentInvitationRepository(),
          ),
  );
}
