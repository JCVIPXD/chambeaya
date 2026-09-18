import 'package:chambeaya_mobile/features/auth/auth_session.dart';
import 'package:chambeaya_mobile/features/auth/auth_session_store.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_shell.dart';
import 'package:chambeaya_mobile/features/onboarding/onboarding_page.dart';
import 'package:chambeaya_mobile/main.dart';
import 'package:chambeaya_mobile/theme/app_theme.dart';
import 'package:chambeaya_mobile/theme/theme_mode_controller.dart';
import 'package:flutter/material.dart';
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

  // Regression tests for CN-20260917-104 ALTO-1: `MaterialApp.darkTheme` +
  // `themeMode` used to be global, so a device with a dark system brightness
  // made onboarding/auth/company render with dark `scaffoldBackgroundColor`
  // and `textTheme` while their hardcoded light colors (`Colors.white`,
  // `AppColors.navy`) stayed put, producing near-unreadable contrast. Dark
  // mode must now be confined to `WorkerShell`.
  group('onboarding, auth and the company dashboard stay light', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    tearDown(() {
      // Leave the test binding's platform brightness as Flutter's default
      // for any test that runs after these in the same process.
      TestWidgetsFlutterBinding.instance.platformDispatcher
          .clearPlatformBrightnessTestValue();
    });

    testWidgets('onboarding ignores a dark system brightness', (
      tester,
    ) async {
      TestWidgetsFlutterBinding.instance.platformDispatcher
              .platformBrightnessTestValue =
          Brightness.dark;

      await tester.pumpWidget(
        ChambeayaApp(
          sessionStore: _MemorySessionStore(null),
          demoModeOverride: true,
        ),
      );
      await tester.pumpAndSettle();

      final onboarding = tester.element(
        find.byKey(const Key('onboarding-content')),
      );
      final theme = Theme.of(onboarding);
      expect(theme.brightness, Brightness.light);
      expect(theme.scaffoldBackgroundColor, AppColors.background);
    });

    testWidgets('the worker auth screen ignores a dark system brightness', (
      tester,
    ) async {
      TestWidgetsFlutterBinding.instance.platformDispatcher
              .platformBrightnessTestValue =
          Brightness.dark;

      await tester.pumpWidget(
        ChambeayaApp(
          sessionStore: _MemorySessionStore(null),
          demoModeOverride: true,
        ),
      );
      await tester.pumpAndSettle();

      // Walk onboarding through to the end to reach AuthPage(worker).
      for (var i = 0; i < 3; i++) {
        await tester.tap(find.text('Siguiente'));
        await tester.pump();
      }
      await tester.tap(find.text('Empezar'));
      await tester.pumpAndSettle();

      expect(find.text('Inicia sesión'), findsOneWidget);
      final auth = tester.element(find.byType(Scaffold).first);
      expect(Theme.of(auth).brightness, Brightness.light);
      expect(Theme.of(auth).scaffoldBackgroundColor, AppColors.background);
    });

    testWidgets(
      'the company dashboard ignores a dark system brightness',
      (tester) async {
        TestWidgetsFlutterBinding.instance.platformDispatcher
                .platformBrightnessTestValue =
            Brightness.dark;

        await tester.pumpWidget(
          ChambeayaApp(
            sessionStore: _MemorySessionStore(
              const AuthSession(
                token: 'opaque-token',
                audience: AppAudience.company,
                name: 'Empresa Demo',
              ),
            ),
            demoModeOverride: true,
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Panel Empresa'), findsOneWidget);
        final company = tester.element(find.byType(Scaffold).first);
        expect(Theme.of(company).brightness, Brightness.light);
        expect(
          Theme.of(company).scaffoldBackgroundColor,
          AppColors.background,
        );
      },
    );
  });

  testWidgets(
    'the worker panel (and only the worker panel) actually turns dark when '
    'its toggle is switched on',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      SharedPreferences.setMockInitialValues({});
      final controller = ThemeModeController(initial: ThemeMode.light);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(Brightness.light),
          home: WorkerShell(
            repository: DemoWorkerMarketplaceRepository(),
            themeModeController: controller,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final before = tester.element(find.byType(Scaffold).first);
      expect(Theme.of(before).brightness, Brightness.light);
      expect(
        Theme.of(before).scaffoldBackgroundColor,
        AppPalette.light.background,
      );

      await controller.setDark(true);
      await tester.pumpAndSettle();

      final after = tester.element(find.byType(Scaffold).first);
      expect(Theme.of(after).brightness, Brightness.dark);
      expect(
        Theme.of(after).scaffoldBackgroundColor,
        AppPalette.dark.background,
      );

      await controller.setDark(false);
      await tester.pumpAndSettle();
      final restored = tester.element(find.byType(Scaffold).first);
      expect(Theme.of(restored).brightness, Brightness.light);
    },
  );
}
