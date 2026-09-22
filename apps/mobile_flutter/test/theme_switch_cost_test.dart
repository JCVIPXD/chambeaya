import 'package:chambeaya_mobile/features/auth/auth_session.dart';
import 'package:chambeaya_mobile/features/auth/auth_session_store.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_shell.dart';
import 'package:chambeaya_mobile/features/onboarding/onboarding_page.dart';
import 'package:chambeaya_mobile/main.dart';
import 'package:chambeaya_mobile/theme/app_theme.dart';
import 'package:chambeaya_mobile/theme/theme_mode_controller.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Regression and measurement tests for CN-20260921-003 (dark-mode toggle
// cost in the worker panel). Before the change, flipping "Modo oscuro" ran a
// 220 ms `AnimatedTheme` that rebuilt every theme-dependent widget in all five
// mounted tabs on ~14 consecutive frames (measured: 26,348 element rebuilds
// over 28 frames from the Inicio tab in `flutter test`); the budgets below
// fail if that behavior comes back. Rebuild counts are deterministic in
// `flutter test`; wall-clock time is printed for reference but never asserted
// because it depends on the machine.

class _NoopStore implements ThemeModeStore {
  @override
  Future<ThemeMode> read() async => ThemeMode.light;
  @override
  Future<void> write(ThemeMode mode) async {}
}

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

typedef _Cost = ({int frames, int rebuilds, int elapsedMs});

/// Mounts the worker panel on [initialIndex], flips it to dark and pumps
/// frames until nothing is scheduled, counting every element rebuild.
Future<(_Cost, ThemeModeController)> _toggleFromTab(
  WidgetTester tester,
  int initialIndex,
) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final controller = ThemeModeController(
    store: _NoopStore(),
    initial: ThemeMode.light,
  );
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(Brightness.light),
      home: WorkerShell(
        repository: DemoWorkerMarketplaceRepository(),
        initialIndex: initialIndex,
        themeModeController: controller,
      ),
    ),
  );
  await tester.pumpAndSettle();

  var rebuilds = 0;
  debugOnRebuildDirtyWidget = (element, builtOnce) => rebuilds++;
  addTearDown(() => debugOnRebuildDirtyWidget = null);
  final watch = Stopwatch()..start();
  await controller.setDark(true);
  var frames = 1;
  await tester.pump();
  while (tester.binding.hasScheduledFrame && frames < 200) {
    await tester.pump(const Duration(milliseconds: 16));
    frames++;
  }
  watch.stop();
  debugOnRebuildDirtyWidget = null;
  return (
    (frames: frames, rebuilds: rebuilds, elapsedMs: watch.elapsedMilliseconds),
    controller,
  );
}

List<bool> _tabTickerModes(WidgetTester tester) {
  final stack = tester.widget<IndexedStack>(find.byType(IndexedStack));
  return [for (final child in stack.children) (child as TickerMode).enabled];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('toggling dark mode from Inicio settles quickly without '
      're-animating the whole panel', (tester) async {
    final (cost, _) = await _toggleFromTab(tester, 0);
    // ignore: avoid_print
    print(
      'MED toggle desde Inicio: frames=${cost.frames} '
      'rebuilds=${cost.rebuilds} wall=${cost.elapsedMs} ms',
    );
    // Before: 28 frames / 26,348 rebuilds. After: 14 frames / ~3,250.
    expect(cost.frames, lessThanOrEqualTo(16));
    expect(cost.rebuilds, lessThan(6000));
  });

  testWidgets('toggling dark mode from Perfil (where the switch lives) stays '
      'cheap', (tester) async {
    final (cost, _) = await _toggleFromTab(tester, 3);
    // ignore: avoid_print
    print(
      'MED toggle desde Perfil: frames=${cost.frames} '
      'rebuilds=${cost.rebuilds} wall=${cost.elapsedMs} ms',
    );
    // Before: 28 frames / 26,348 rebuilds. After: 20 frames / ~3,600; the
    // extra frames over Inicio are the switch's own local animations (thumb
    // and the icon `AnimatedSwitcher`), which touch only that card.
    expect(cost.frames, lessThanOrEqualTo(24));
    expect(cost.rebuilds, lessThan(6000));
  });

  testWidgets('the new theme is applied in a single frame, not interpolated', (
    tester,
  ) async {
    final (_, controller) = await _toggleFromTab(tester, 0);
    // `_toggleFromTab` already settled on dark; flip back and check that the
    // very first frame after the change already shows the final theme.
    await controller.setDark(false);
    await tester.pump();
    final light = Theme.of(tester.element(find.byType(Scaffold).first));
    expect(light.brightness, Brightness.light);
    expect(light.scaffoldBackgroundColor, AppPalette.light.background);

    await controller.setDark(true);
    await tester.pump();
    final dark = Theme.of(tester.element(find.byType(Scaffold).first));
    expect(dark.brightness, Brightness.dark);
    expect(dark.scaffoldBackgroundColor, AppPalette.dark.background);
  });

  testWidgets('only the visible worker tab keeps its tickers running', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: WorkerShell(repository: DemoWorkerMarketplaceRepository()),
      ),
    );
    await tester.pumpAndSettle();
    expect(_tabTickerModes(tester), [true, false, false, false, false]);

    await tester.tap(find.text('Perfil'));
    await tester.pumpAndSettle();
    expect(_tabTickerModes(tester), [false, false, false, true, false]);
  });

  test('buildAppTheme builds each brightness once and keys by platform', () {
    final light = buildAppTheme(Brightness.light);
    final dark = buildAppTheme(Brightness.dark);
    expect(identical(light, buildAppTheme(Brightness.light)), isTrue);
    expect(identical(dark, buildAppTheme(Brightness.dark)), isTrue);
    expect(identical(light, dark), isFalse);
    // The default argument still means light.
    expect(identical(light, buildAppTheme()), isTrue);

    // `ThemeData` reads `defaultTargetPlatform` for its platform defaults, so
    // a cache that ignored the platform would hand an iOS theme to an Android
    // (or test-overridden) caller.
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      final ios = buildAppTheme(Brightness.light);
      expect(ios.platform, TargetPlatform.iOS);
      expect(identical(ios, light), isFalse);
      expect(identical(ios, buildAppTheme(Brightness.light)), isTrue);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
    expect(identical(light, buildAppTheme(Brightness.light)), isTrue);
  });

  testWidgets('a saved dark preference is already applied when the worker '
      'panel first appears (no light flash)', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({'chambeaya.theme.mode': 'dark'});

    await tester.pumpWidget(
      ChambeayaApp(
        sessionStore: _MemorySessionStore(
          const AuthSession(
            token: 'opaque-token',
            audience: AppAudience.worker,
            name: 'Ana Torres',
          ),
        ),
        demoModeOverride: true,
      ),
    );

    // Advance frame by frame and inspect the very first frame in which the
    // worker panel exists.
    Brightness? firstBrightness;
    for (var i = 0; i < 50 && firstBrightness == null; i++) {
      await tester.pump(const Duration(milliseconds: 16));
      if (find.byType(WorkerShell).evaluate().isNotEmpty) {
        firstBrightness = Theme.of(
          tester.element(find.byType(Scaffold).first),
        ).brightness;
      }
    }
    expect(firstBrightness, isNotNull, reason: 'worker panel never mounted');
    expect(firstBrightness, Brightness.dark);
  });
}
