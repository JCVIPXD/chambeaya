import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/material.dart';

/// Brand-fixed colors: these do not change between light and dark mode
/// because they are always used as a solid accent fill (with white/near-white
/// content on top) or as an accent icon/text that already reads well on both
/// backgrounds. Colors that instead depend on the current surface (page
/// background, card fill, borders, body/heading text) live in [AppPalette]
/// below and must be resolved through `context.palette` so the worker panel
/// can offer a real dark mode.
abstract final class AppColors {
  static const navy = Color(0xFF1A2B4A);
  static const navySoft = Color(0xFFE9EEF6);
  static const teal = Color(0xFF00C896);
  static const tealDark = Color(0xFF009F7C);
  static const tealSoft = Color(0xFFE4FAF4);
  static const background = Color(0xFFF4F7FB);
  static const surfaceMuted = Color(0xFFF8FAFD);
  static const surface = Colors.white;
  static const border = Color(0xFFD9E2EC);
  static const muted = Color(0xFF718096);
  static const gold = Color(0xFFF5AE28);
  static const shadow = Color(0x141A2B4A);
}

/// Semantic colors that flip between light and dark mode. Widgets read these
/// through `context.palette` instead of `AppColors` directly whenever the
/// color represents a background surface or text drawn on top of the page
/// background (as opposed to a fixed brand accent).
@immutable
class AppPalette extends ThemeExtension<AppPalette> {
  const AppPalette({
    required this.background,
    required this.surface,
    required this.surfaceMuted,
    required this.border,
    required this.controlBorder,
    required this.ink,
    required this.muted,
    required this.accentSoft,
    required this.onNotice,
    required this.shadow,
  });

  /// Scaffold/page background.
  final Color background;

  /// Card/sheet/container fill (replaces hardcoded `Colors.white`).
  final Color surface;

  /// Subtle fill for secondary containers (chips, empty states).
  final Color surfaceMuted;

  /// Hairline borders and dividers drawn on top of [surface]/[background].
  final Color border;

  /// Outline of interactive controls (text fields, filter chips): unlike the
  /// decorative hairline [border] it must be perceivable against the control's
  /// own fill (WCAG 1.4.11, 3:1). In light mode it is the same hairline as
  /// [border] (unchanged); in dark mode it is a stronger tone.
  final Color controlBorder;

  /// Primary heading/body text color drawn on [background] or [surface]
  /// (replaces `AppColors.navy` used as a text color, as opposed to its use
  /// as an accent background fill, which stays fixed).
  final Color ink;

  /// Secondary/muted text color.
  final Color muted;

  /// Soft accent fill used behind teal icons/text (avatars, badges, chips).
  final Color accentSoft;

  /// Text drawn on the fixed light-amber notice fill (`_ErrorNotice`, always
  /// `#FFF4E5` in both modes). Light keeps the inherited muted tone; dark must
  /// not inherit its own (light) muted text onto that light fill.
  final Color onNotice;

  /// Card/elevation shadow tint.
  final Color shadow;

  static const light = AppPalette(
    background: AppColors.background,
    surface: AppColors.surface,
    surfaceMuted: AppColors.surfaceMuted,
    border: AppColors.border,
    controlBorder: AppColors.border,
    ink: AppColors.navy,
    muted: AppColors.muted,
    accentSoft: AppColors.tealSoft,
    onNotice: AppColors.muted,
    shadow: AppColors.shadow,
  );

  static const dark = AppPalette(
    background: Color(0xFF10141D),
    surface: Color(0xFF181D28),
    surfaceMuted: Color(0xFF1F2532),
    border: Color(0xFF2C3342),
    controlBorder: Color(0xFF69748A),
    ink: Color(0xFFEEF1F7),
    muted: Color(0xFFA1AABB),
    accentSoft: Color(0xFF17352E),
    onNotice: AppColors.navy,
    shadow: Color(0x66000000),
  );

  @override
  AppPalette copyWith({
    Color? background,
    Color? surface,
    Color? surfaceMuted,
    Color? border,
    Color? controlBorder,
    Color? ink,
    Color? muted,
    Color? accentSoft,
    Color? onNotice,
    Color? shadow,
  }) => AppPalette(
    background: background ?? this.background,
    surface: surface ?? this.surface,
    surfaceMuted: surfaceMuted ?? this.surfaceMuted,
    border: border ?? this.border,
    controlBorder: controlBorder ?? this.controlBorder,
    ink: ink ?? this.ink,
    muted: muted ?? this.muted,
    accentSoft: accentSoft ?? this.accentSoft,
    onNotice: onNotice ?? this.onNotice,
    shadow: shadow ?? this.shadow,
  );

  @override
  AppPalette lerp(ThemeExtension<AppPalette>? other, double t) {
    if (other is! AppPalette) return this;
    return AppPalette(
      background: Color.lerp(background, other.background, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceMuted: Color.lerp(surfaceMuted, other.surfaceMuted, t)!,
      border: Color.lerp(border, other.border, t)!,
      controlBorder: Color.lerp(controlBorder, other.controlBorder, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      onNotice: Color.lerp(onNotice, other.onNotice, t)!,
      shadow: Color.lerp(shadow, other.shadow, t)!,
    );
  }
}

/// Convenience accessor so widgets can write `context.palette.muted` instead
/// of `Theme.of(context).extension<AppPalette>()`. Falls back to
/// [AppPalette.light] when the current [ThemeData] does not carry the
/// extension (e.g. a widget test that pumps a bare `MaterialApp()` without
/// `buildAppTheme`), so existing tests keep seeing the original light colors
/// without needing to opt into the app's real theme.
extension AppPaletteX on BuildContext {
  AppPalette get palette =>
      Theme.of(this).extension<AppPalette>() ?? AppPalette.light;
}

/// Returns the app's [ThemeData] for [brightness], built once and reused.
///
/// Building it is not free (`ColorScheme.fromSeed` plus every component
/// theme: ~660 us per call in the JIT test runner, see CN-20260921-003), and
/// worse, `MaterialApp` and `Theme.of` keep their localized-text-theme cache
/// keyed by the `ThemeData` *identity*, so a fresh instance on every rebuild
/// of `ChambeayaApp` or of the worker shell's theme wrapper discards that
/// cache. The result depends only on [brightness] and on
/// [defaultTargetPlatform] (which `ThemeData` reads for its platform-specific
/// defaults), so both form the cache key; in production the platform never
/// changes, so there are exactly two instances for the whole process.
ThemeData buildAppTheme([Brightness brightness = Brightness.light]) =>
    _themeCache.putIfAbsent(
      (brightness, defaultTargetPlatform),
      () => _createAppTheme(brightness),
    );

final _themeCache = <(Brightness, TargetPlatform), ThemeData>{};

ThemeData _createAppTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final palette = isDark ? AppPalette.dark : AppPalette.light;
  final colorScheme = ColorScheme.fromSeed(
    seedColor: AppColors.teal,
    brightness: brightness,
    primary: AppColors.teal,
    surface: palette.surface,
  );
  final inputBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(14),
    borderSide: BorderSide(color: palette.controlBorder),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: colorScheme,
    extensions: [palette],
    scaffoldBackgroundColor: palette.background,
    canvasColor: palette.background,
    focusColor: AppColors.teal.withValues(alpha: .16),
    splashColor: AppColors.teal.withValues(alpha: .10),
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: AppColors.teal,
      selectionColor: Color(0x5500C896),
      selectionHandleColor: AppColors.teal,
    ),
    textTheme: TextTheme(
      headlineSmall: TextStyle(
        color: palette.ink,
        fontSize: 22,
        fontWeight: FontWeight.w800,
        height: 1.2,
      ),
      titleLarge: TextStyle(
        color: palette.ink,
        fontSize: 18,
        fontWeight: FontWeight.w800,
        height: 1.3,
      ),
      titleMedium: TextStyle(
        color: palette.ink,
        fontSize: 15,
        fontWeight: FontWeight.w800,
        height: 1.3,
      ),
      bodyLarge: TextStyle(color: palette.ink, fontSize: 15, height: 1.45),
      bodyMedium: TextStyle(color: palette.muted, fontSize: 13, height: 1.45),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: palette.surface,
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      hintStyle: TextStyle(color: palette.muted, fontSize: 13),
      labelStyle: TextStyle(color: palette.muted),
      floatingLabelStyle: const TextStyle(
        color: AppColors.teal,
        fontWeight: FontWeight.w700,
      ),
      border: inputBorder,
      enabledBorder: inputBorder,
      focusedBorder: inputBorder.copyWith(
        borderSide: const BorderSide(color: AppColors.teal, width: 2),
      ),
      errorBorder: inputBorder.copyWith(
        borderSide: const BorderSide(color: Color(0xFFD9344B)),
      ),
      focusedErrorBorder: inputBorder.copyWith(
        borderSide: const BorderSide(color: Color(0xFFD9344B), width: 2),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.teal,
        foregroundColor: AppColors.navy,
        disabledBackgroundColor: palette.border,
        disabledForegroundColor: palette.muted,
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
        textStyle: const TextStyle(fontWeight: FontWeight.w800),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.teal,
        minimumSize: const Size(48, 48),
        side: const BorderSide(color: AppColors.teal),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
        textStyle: const TextStyle(fontWeight: FontWeight.w800),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: palette.surface,
      selectedColor: palette.accentSoft,
      side: BorderSide(color: palette.controlBorder),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
      labelStyle: TextStyle(
        color: palette.ink,
        fontSize: 12,
        fontWeight: FontWeight.w700,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      showCheckmark: false,
    ),
    cardTheme: CardThemeData(
      color: palette.surface,
      elevation: 1,
      shadowColor: palette.shadow,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: palette.border),
        borderRadius: BorderRadius.circular(16),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: palette.surface,
      indicatorColor: palette.accentSoft,
      height: 72,
      labelTextStyle: WidgetStatePropertyAll(
        TextStyle(
          color: palette.ink,
          fontSize: 10,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: palette.surface,
      indicatorColor: palette.accentSoft,
      selectedIconTheme: const IconThemeData(color: AppColors.teal),
      selectedLabelTextStyle: TextStyle(
        color: palette.ink,
        fontSize: 11,
        fontWeight: FontWeight.w800,
      ),
      unselectedLabelTextStyle: TextStyle(color: palette.muted, fontSize: 11),
    ),
    dividerTheme: DividerThemeData(
      color: palette.border,
      thickness: 1,
      space: 1,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.navy,
      contentTextStyle: const TextStyle(
        color: Colors.white,
        fontWeight: FontWeight.w600,
      ),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}
