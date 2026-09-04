import 'package:flutter/material.dart';

import 'features/auth/auth_page.dart';
import 'features/auth/auth_repository.dart';
import 'features/auth/auth_session.dart';
import 'features/auth/auth_session_store.dart';
import 'features/company/company_dashboard_page.dart';
import 'features/marketplace/http_worker_marketplace_repository.dart';
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
    this.useLocalApiOverride,
  });

  final AuthSessionStore? sessionStore;
  final AuthRepository? authRepository;
  final bool? useLocalApiOverride;

  @override
  State<CumpleNowApp> createState() => _CumpleNowAppState();
}

class _CumpleNowAppState extends State<CumpleNowApp> {
  static const _configuredLocalApi = bool.fromEnvironment(
    'USE_LOCAL_API',
    defaultValue: false,
  );

  late final AuthSessionStore _sessionStore;
  late final AuthRepository _authRepository;
  AppAudience? _audience;
  AuthSession? _session;
  var _restoringSession = true;

  bool get _useLocalApi => widget.useLocalApiOverride ?? _configuredLocalApi;

  @override
  void initState() {
    super.initState();
    _sessionStore = widget.sessionStore ?? SharedPreferencesAuthSessionStore();
    _authRepository = widget.authRepository ?? AuthRepository();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    AuthSession? restored = await _sessionStore.read();
    if (restored != null && _useLocalApi) {
      try {
        restored = await _authRepository.restore(restored.token);
        await _sessionStore.write(restored);
      } catch (_) {
        await _sessionStore.clear();
        restored = null;
      }
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
    if (_useLocalApi && token != null) {
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
              child: CircularProgressIndicator(
                semanticsLabel: 'Restaurando sesión',
              ),
            ),
          )
        : _audience == null
        ? OnboardingPage(
            onComplete: (value) => setState(() => _audience = value),
          )
        : _session == null
        ? AuthPage(
            role: _audience!,
            useLocalApi: _useLocalApi,
            repository: _authRepository,
            onAuthenticated: _authenticated,
          )
        : _audience == AppAudience.company
        ? CompanyDashboardPage(onLogout: () => _logout())
        : WorkerShell(
            onLogout: () => _logout(),
            workerName: _session?.name,
            alertStore: SharedPreferencesSearchAlertStore(),
            repository: _useLocalApi
                ? HttpWorkerMarketplaceRepository(token: _session?.token)
                : createWorkerMarketplaceRepository(useLocalApi: false),
          ),
  );
}
