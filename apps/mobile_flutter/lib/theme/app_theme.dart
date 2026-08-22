import 'package:flutter/material.dart';

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

ThemeData buildAppTheme() {
  final colorScheme = ColorScheme.fromSeed(
    seedColor: AppColors.teal,
    brightness: Brightness.light,
    primary: AppColors.teal,
    surface: AppColors.surface,
  );
  final inputBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(14),
    borderSide: const BorderSide(color: AppColors.border),
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: AppColors.background,
    canvasColor: AppColors.background,
    focusColor: AppColors.teal.withValues(alpha: .16),
    splashColor: AppColors.teal.withValues(alpha: .10),
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: AppColors.teal,
      selectionColor: Color(0x5500C896),
      selectionHandleColor: AppColors.teal,
    ),
    textTheme: const TextTheme(
      headlineSmall: TextStyle(
        color: AppColors.navy,
        fontSize: 22,
        fontWeight: FontWeight.w800,
        height: 1.2,
      ),
      titleLarge: TextStyle(
        color: AppColors.navy,
        fontSize: 18,
        fontWeight: FontWeight.w800,
        height: 1.3,
      ),
      titleMedium: TextStyle(
        color: AppColors.navy,
        fontSize: 15,
        fontWeight: FontWeight.w800,
        height: 1.3,
      ),
      bodyLarge: TextStyle(color: AppColors.navy, fontSize: 15, height: 1.45),
      bodyMedium: TextStyle(color: AppColors.muted, fontSize: 13, height: 1.45),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      hintStyle: const TextStyle(color: AppColors.muted, fontSize: 13),
      labelStyle: const TextStyle(color: AppColors.muted),
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
        disabledBackgroundColor: AppColors.border,
        disabledForegroundColor: AppColors.muted,
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
      backgroundColor: Colors.white,
      selectedColor: AppColors.tealSoft,
      side: const BorderSide(color: AppColors.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
      labelStyle: const TextStyle(
        color: AppColors.navy,
        fontSize: 12,
        fontWeight: FontWeight.w700,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      showCheckmark: false,
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 1,
      shadowColor: AppColors.shadow,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: AppColors.border),
        borderRadius: BorderRadius.circular(16),
      ),
    ),
    navigationBarTheme: const NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: AppColors.tealSoft,
      height: 72,
      labelTextStyle: WidgetStatePropertyAll(
        TextStyle(
          color: AppColors.navy,
          fontSize: 10,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    navigationRailTheme: const NavigationRailThemeData(
      backgroundColor: Colors.white,
      indicatorColor: AppColors.tealSoft,
      selectedIconTheme: IconThemeData(color: AppColors.teal),
      selectedLabelTextStyle: TextStyle(
        color: AppColors.navy,
        fontSize: 11,
        fontWeight: FontWeight.w800,
      ),
      unselectedLabelTextStyle: TextStyle(color: AppColors.muted, fontSize: 11),
    ),
    dividerTheme: const DividerThemeData(
      color: AppColors.border,
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
