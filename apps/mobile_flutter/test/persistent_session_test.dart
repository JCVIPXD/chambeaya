import 'package:cumple_now_mobile/features/auth/auth_session.dart';
import 'package:cumple_now_mobile/features/auth/auth_session_store.dart';
import 'package:cumple_now_mobile/features/onboarding/onboarding_page.dart';
import 'package:cumple_now_mobile/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _MemorySessionStore implements AuthSessionStore {
  _MemorySessionStore(this.session);

  AuthSession? session;

  @override
  Future<void> clear() async => session = null;

  @override
  Future<AuthSession?> read() async => session;

  @override
  Future<void> write(AuthSession value) async => session = value;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'shared preferences stores and removes the authenticated session',
    () async {
      SharedPreferences.setMockInitialValues({});
      final store = SharedPreferencesAuthSessionStore();
      const session = AuthSession(
        token: 'opaque-token',
        audience: AppAudience.worker,
        name: 'Ana Torres',
      );

      await store.write(session);
      final restored = await store.read();
      expect(restored?.token, session.token);
      expect(restored?.audience, session.audience);
      expect(restored?.name, session.name);

      await store.clear();
      expect(await store.read(), isNull);
    },
  );

  testWidgets('the app restores a company session and supports logout', (
    tester,
  ) async {
    final store = _MemorySessionStore(
      const AuthSession(
        token: 'opaque-token',
        audience: AppAudience.company,
        name: 'Empresa Demo',
      ),
    );

    await tester.pumpWidget(
      CumpleNowApp(sessionStore: store, useLocalApiOverride: false),
    );
    await tester.pumpAndSettle();

    expect(find.text('Panel Empresa'), findsOneWidget);
    await tester.tap(find.byTooltip('Cerrar sesión'));
    await tester.pumpAndSettle();

    expect(store.session, isNull);
    expect(find.text('Soy trabajador'), findsOneWidget);
  });
}
