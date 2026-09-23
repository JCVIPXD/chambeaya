import 'dart:async';
import 'dart:math' as math;

import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_secondary_pages.dart';
import 'package:chambeaya_mobile/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Regression test for CN-20260922-006 (MEDIO-1): the `CircularProgressIndicator`
// that replaces the "Actualizar mensajes" button's icon while a refresh is in
// flight must have enough contrast against the button's own fill
// (`IconButton.filledTonal` paints it with `colorScheme.secondaryContainer`).
// Before the fix it had no explicit color and fell back to
// `colorScheme.primary` (`ProgressIndicator._getValueColor`'s default),
// measuring 1.68:1 in light mode and 4.34:1 in dark against
// `secondaryContainer`, both under (or, in dark, right at) the 3:1 floor this
// project already applies to non-text UI components (CN-20260921-009/010).
//
// This checks the *effective* color the indicator paints with (its own
// `color:`, read from the mounted widget, not assumed) against the real
// `ColorScheme.secondaryContainer` that `buildAppTheme` produces, in both
// themes -- a WCAG ratio, not a hardcoded hex, so a legitimate palette tweak
// does not break it while a regression to no explicit color (or a mismatched
// one) does.

double _luminance(Color color) {
  double channel(double value) => value <= 0.03928
      ? value / 12.92
      : math.pow((value + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(color.r) +
      0.7152 * channel(color.g) +
      0.0722 * channel(color.b);
}

double _ratio(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

const _graphicMinimum = 3.0;

/// Serves [data] immediately for the very first call (the page's initial
/// load); every later call (a poll or the button's own tap) hangs on a
/// `Completer` until the test [answer]s it -- used here to keep the refresh
/// "in flight" so the button's spinner stays on screen long enough to
/// measure it.
class _HoldableAfterFirstLoadRepository
    extends DemoWorkerMarketplaceRepository {
  List<WorkerConversationRecord> data = const [];
  var _calls = 0;
  final pending = <Completer<List<WorkerConversationRecord>>>[];

  @override
  Future<List<WorkerConversationRecord>> workerConversations() {
    _calls++;
    if (_calls == 1) return Future.value(List.of(data));
    final completer = Completer<List<WorkerConversationRecord>>();
    pending.add(completer);
    return completer.future;
  }
}

Future<void> _pumpMessagesWithSpinner(
  WidgetTester tester, {
  required bool dark,
}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final repository = _HoldableAfterFirstLoadRepository();
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(dark ? Brightness.dark : Brightness.light),
      home: Scaffold(body: WorkerMessagesPage(repository: repository)),
    ),
  );
  await tester.pumpAndSettle();

  // Trigger a refresh that stays in flight so the spinner replaces the
  // static icon and stays on screen.
  await tester.tap(find.byTooltip('Actualizar mensajes'));
  await tester.pump();
}

void main() {
  for (final dark in [false, true]) {
    final mode = dark ? 'oscuro' : 'claro';

    testWidgets('el indicador del boton "Actualizar mensajes" tiene contraste '
        'suficiente sobre su propio boton en modo $mode '
        '(CN-20260922-006, MEDIO-1)', (tester) async {
      await _pumpMessagesWithSpinner(tester, dark: dark);

      final indicatorFinder = find.byType(CircularProgressIndicator);
      expect(indicatorFinder, findsOneWidget);
      final indicator = tester.widget<CircularProgressIndicator>(
        indicatorFinder,
      );
      final color = indicator.color;
      expect(
        color,
        isNotNull,
        reason:
            'el indicador debe fijar su propio color explicito; de lo '
            'contrario hereda colorScheme.primary, el valor por defecto de '
            'ProgressIndicator, que no fue elegido para contrastar sobre '
            'secondaryContainer',
      );

      final theme = buildAppTheme(dark ? Brightness.dark : Brightness.light);
      final background = theme.colorScheme.secondaryContainer;
      final ratio = _ratio(color!, background);
      // ignore: avoid_print
      print(
        'CONTRASTE boton Actualizar mensajes/$mode: '
        '${ratio.toStringAsFixed(2)}:1 '
        '(fg=$color bg=$background)',
      );
      expect(ratio, greaterThanOrEqualTo(_graphicMinimum));
      // The fix reuses the same color `IconButton.filledTonal` already
      // uses for its own static icon (`onSecondaryContainer`), so there is
      // no visible color jump between the idle icon and the spinner.
      expect(color, theme.colorScheme.onSecondaryContainer);
    });
  }
}
