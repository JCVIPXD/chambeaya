import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists the user's light/dark/system preference so it survives app
/// restarts, following the same `SharedPreferences`-backed store pattern used
/// by `SharedPreferencesAuthSessionStore`.
abstract interface class ThemeModeStore {
  Future<ThemeMode> read();
  Future<void> write(ThemeMode mode);
}

class SharedPreferencesThemeModeStore implements ThemeModeStore {
  static const _key = 'chambeaya.theme.mode';

  @override
  Future<ThemeMode> read() async {
    final preferences = await SharedPreferences.getInstance();
    return switch (preferences.getString(_key)) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
  }

  @override
  Future<void> write(ThemeMode mode) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_key, mode.name);
  }
}

/// A `ValueNotifier<ThemeMode>` that the worker panel's appearance toggle
/// reads and writes, and that `ChambeayaApp` listens to for `MaterialApp`'s
/// `themeMode`. Only `ThemeMode.light`/`ThemeMode.dark` are exposed to the
/// worker toggle today (a simple on/off switch); `ThemeMode.system` is kept
/// as the initial value only until a stored preference is loaded, so a first
/// launch still respects the device setting.
class ThemeModeController extends ValueNotifier<ThemeMode> {
  ThemeModeController({
    ThemeModeStore? store,
    ThemeMode initial = ThemeMode.system,
  }) : _store = store ?? SharedPreferencesThemeModeStore(),
       super(initial);

  final ThemeModeStore _store;

  Future<void> load() async {
    value = await _store.read();
  }

  /// The effective dark/light state the worker toggle should reflect, for a
  /// caller with no `BuildContext` at hand. For [ThemeMode.system] (only
  /// possible before `load()` resolves a saved preference, or if none was
  /// ever saved) this resolves the device's current brightness via
  /// `PlatformDispatcher.instance` instead of always reporting `false`, so
  /// the switch never disagrees with what the screen actually looks like —
  /// but that read neither rebuilds when the system brightness changes nor
  /// honors a `MediaQuery` override in widget tests. Prefer [resolveIsDark]
  /// with `MediaQuery.platformBrightnessOf(context)` wherever a
  /// `BuildContext` is available (both `WorkerShell` and `_AppearanceCard`
  /// in `profile_home_page.dart` do).
  bool get isDark => resolveIsDark(PlatformDispatcher.instance.platformBrightness);

  /// Same effective dark/light state as [isDark], but resolves
  /// [ThemeMode.system] from the given [platformBrightness] instead of
  /// reading `PlatformDispatcher.instance` directly.
  bool resolveIsDark(Brightness platformBrightness) => switch (value) {
    ThemeMode.dark => true,
    ThemeMode.light => false,
    ThemeMode.system => platformBrightness == Brightness.dark,
  };

  Future<void> setDark(bool dark) async {
    final mode = dark ? ThemeMode.dark : ThemeMode.light;
    if (value == mode) return;
    value = mode;
    await _store.write(mode);
  }
}
