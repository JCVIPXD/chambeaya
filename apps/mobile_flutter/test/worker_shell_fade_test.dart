import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reads the *actual* interpolated opacity `AnimatedOpacity` is currently
/// rendering (via the `FadeTransition` it builds internally), as opposed to
/// `AnimatedOpacity.opacity`, which is only the animation's *target* value
/// and stays constant across the whole transition. Regression test for
/// CN-20260917-104 ALTO-2: `worker_shell.dart` used to flip
/// `_contentVisible` false then true within the same frame (via
/// `Future.microtask`), so this animated value never actually moved.
double _shellFadeOpacity(WidgetTester tester) {
  // `AnimatedOpacity` builds this `FadeTransition` as its own direct child,
  // so it is the first (outermost) `FadeTransition` found under the shell's
  // key; the IndexedStack it wraps mounts every tab, and other tabs (job
  // cards, discovery) use their own nested `FadeTransition`s for unrelated
  // animations, which is why this must not assume there is only one match.
  final fade = tester.widget<FadeTransition>(
    find
        .descendant(
          of: find.byKey(const Key('worker-shell-tab-fade')),
          matching: find.byType(FadeTransition),
        )
        .first,
  );
  return fade.opacity.value;
}

void main() {
  testWidgets(
    'switching worker tabs actually cross-fades through intermediate '
    'opacity values instead of jumping straight back to opaque',
    (tester) async {
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
      expect(_shellFadeOpacity(tester), 1);

      await tester.tap(find.text('Postulaciones'));

      // Sample several frames (with real elapsed time each, unlike a bare
      // `pump()`) while the fade-out/fade-in plays out. The first `pump()`
      // right after the tap only registers the new target (opacity drops to
      // 0 with zero elapsed time, so it still *reads* 1); it's the ticks
      // that follow that must show the interpolated value actually moving.
      // If the transition were instantaneous (the original bug, where both
      // `setState` calls collapsed into the same frame before any of this
      // ever rendered) every sample would read exactly 0 or exactly 1; a
      // real cross-fade must pass through strictly-between values.
      final samples = <double>[];
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 20));
        samples.add(_shellFadeOpacity(tester));
      }
      expect(
        samples.any((value) => value > 0 && value < 1),
        isTrue,
        reason:
            'expected at least one intermediate frame with 0 < opacity < 1, '
            'got: $samples',
      );

      await tester.pumpAndSettle();
      expect(_shellFadeOpacity(tester), 1);
      expect(find.text('Mis postulaciones'), findsOneWidget);
    },
  );
}
