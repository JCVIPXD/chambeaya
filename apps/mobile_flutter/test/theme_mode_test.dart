import 'package:chambeaya_mobile/features/profile/profile_home_page.dart';
import 'package:chambeaya_mobile/features/profile/talent_profile_repository.dart';
import 'package:chambeaya_mobile/theme/app_theme.dart';
import 'package:chambeaya_mobile/theme/theme_mode_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'shared preferences stores and restores the chosen appearance',
    () async {
      SharedPreferences.setMockInitialValues({});
      final store = SharedPreferencesThemeModeStore();

      // No preference saved yet: defaults to following the system setting.
      expect(await store.read(), ThemeMode.system);

      await store.write(ThemeMode.dark);
      expect(await store.read(), ThemeMode.dark);

      await store.write(ThemeMode.light);
      expect(await store.read(), ThemeMode.light);
    },
  );

  test('ThemeModeController.setDark persists the new value once', () async {
    SharedPreferences.setMockInitialValues({});
    final writes = <ThemeMode>[];
    final controller = ThemeModeController(
      store: _RecordingThemeModeStore(writes),
    );

    expect(controller.isDark, isFalse);

    await controller.setDark(true);
    expect(controller.value, ThemeMode.dark);
    expect(controller.isDark, isTrue);
    expect(writes, [ThemeMode.dark]);

    // Setting the same value again must not persist redundantly.
    await controller.setDark(true);
    expect(writes, [ThemeMode.dark]);

    await controller.setDark(false);
    expect(controller.value, ThemeMode.light);
    expect(writes, [ThemeMode.dark, ThemeMode.light]);
  });

  test(
    'buildAppTheme produces a distinct, coherent palette per brightness',
    () {
      final light = buildAppTheme(Brightness.light);
      final dark = buildAppTheme(Brightness.dark);

      final lightPalette = light.extension<AppPalette>()!;
      final darkPalette = dark.extension<AppPalette>()!;

      expect(light.brightness, Brightness.light);
      expect(dark.brightness, Brightness.dark);
      expect(lightPalette.background, isNot(darkPalette.background));
      expect(lightPalette.surface, isNot(darkPalette.surface));
      expect(lightPalette.ink, isNot(darkPalette.ink));
      // The scaffold/card colors must come from the same palette instance the
      // rest of the worker panel reads through `context.palette`, otherwise a
      // screen could visually desync from its own chrome when the mode flips.
      expect(light.scaffoldBackgroundColor, lightPalette.background);
      expect(dark.scaffoldBackgroundColor, darkPalette.background);
      expect(light.cardTheme.color, lightPalette.surface);
      expect(dark.cardTheme.color, darkPalette.surface);
    },
  );

  testWidgets(
    'the worker can turn on dark mode from the profile tab and it persists',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final controller = ThemeModeController(initial: ThemeMode.light);
      final repository = DemoTalentProfileRepository(name: 'Ana Torres');

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(Brightness.light),
          darkTheme: buildAppTheme(Brightness.dark),
          themeMode: controller.value,
          home: ProfileHomePage(
            talentProfileRepository: repository,
            themeModeController: controller,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Modo oscuro'), findsOneWidget);
      final switchFinder = find.byType(SwitchListTile);
      expect(switchFinder, findsOneWidget);
      expect(tester.widget<SwitchListTile>(switchFinder).value, isFalse);

      await tester.tap(switchFinder);
      await tester.pumpAndSettle();

      expect(controller.value, ThemeMode.dark);
      expect(tester.widget<SwitchListTile>(switchFinder).value, isTrue);

      // The preference survives a fresh controller reading the same store.
      final restored = ThemeModeController();
      await restored.load();
      expect(restored.value, ThemeMode.dark);
    },
  );

  testWidgets(
    'the appearance toggle is not rendered without a theme controller',
    (tester) async {
      final repository = DemoTalentProfileRepository(name: 'Ana Torres');
      await tester.pumpWidget(
        MaterialApp(home: ProfileHomePage(talentProfileRepository: repository)),
      );
      await tester.pumpAndSettle();

      expect(find.text('Modo oscuro'), findsNothing);
    },
  );
}

class _RecordingThemeModeStore implements ThemeModeStore {
  _RecordingThemeModeStore(this.writes);
  final List<ThemeMode> writes;
  ThemeMode _value = ThemeMode.system;

  @override
  Future<ThemeMode> read() async => _value;

  @override
  Future<void> write(ThemeMode mode) async {
    _value = mode;
    writes.add(mode);
  }
}
