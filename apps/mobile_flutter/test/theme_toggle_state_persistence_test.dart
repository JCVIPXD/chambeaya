import 'package:chambeaya_mobile/features/auth/auth_session.dart';
import 'package:chambeaya_mobile/features/auth/auth_session_store.dart';
import 'package:chambeaya_mobile/features/discovery/discovery_models.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_shell.dart';
import 'package:chambeaya_mobile/main.dart';
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

  // Regression test for CN-20260917-106's blocking finding: `main.dart` used
  // to keep a `_themeMode.addListener` on `ChambeayaApp`'s root `State` that
  // called `setState({})` on every dark-mode toggle, and `build()` created a
  // *new* `DemoWorkerMarketplaceRepository()`/`HttpWorkerMarketplaceRepository`
  // (plus the profile/invitation repositories, plus a new `http.Client` for
  // the live variant) inline every time it ran. The auditor's own probe
  // showed a submitted application and a saved shift both vanishing from the
  // repository the instant the switch flipped (`PROBE_BEFORE` had them,
  // `PROBE_AFTER` did not). This test drives the real `ChambeayaApp` through
  // that same sequence — apply to a shift, save another, then flip "Modo
  // oscuro" — and checks both that the `WorkerShell` still gets the *same*
  // repository instance across the toggle, and that the data survives.
  //
  // It deliberately does not wait out `WorkerApplicationsPage`'s 3-second
  // polling `Timer` to observe the loss indirectly through the "Postulaciones"
  // tab: that timer's own `setState(() => _loading = _load())` callback
  // returns a `Future` (a pre-existing, unrelated issue in
  // `worker_secondary_pages.dart`, outside this fix's scope), which trips a
  // framework assertion the moment the timer actually fires under
  // `flutter test`. Reading the repository directly is also a more precise
  // check: it is the exact object whose identity/in-memory state this fix
  // is about, independent of which page happens to poll it.
  testWidgets(
    'toggling dark mode from the profile tab keeps the same worker '
    'repository instance, with applications and saved shifts intact',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});

      await tester.pumpWidget(
        ChambeayaApp(
          sessionStore: _MemorySessionStore(null),
          demoModeOverride: true,
        ),
      );
      await tester.pumpAndSettle();

      // Walk onboarding through to the worker `AuthPage` (same pattern as
      // `dark_theme_scope_test.dart`), then log in with the demo bypass.
      for (var i = 0; i < 3; i++) {
        await tester.tap(find.text('Siguiente'));
        await tester.pump();
      }
      await tester.tap(find.text('Empezar'));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Correo electrónico'),
        'trabajador@demo.pe',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Contraseña'),
        'Password1',
      );
      await tester.tap(find.text('Ingresar'));
      await tester.pumpAndSettle();

      // Now inside `WorkerShell`, on the Discovery tab ("Inicio").
      // Save "Bartender" (Café del Cielo) directly from the list card. It is
      // the second of three cards in a non-lazy `ListView`, so it is already
      // built but starts out scrolled below the fold (`skipOffstage: false`
      // is required for `find`/`ensureVisible` to see it before scrolling).
      final cafeCieloCard = find.byKey(
        const Key('shift-card-shift-cafe-cielo'),
        skipOffstage: false,
      );
      await tester.ensureVisible(cafeCieloCard);
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: cafeCieloCard,
          matching: find.byTooltip('Guardar empleo'),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: cafeCieloCard,
          matching: find.byTooltip('Empleo guardado'),
        ),
        findsOneWidget,
      );

      // Apply to "Mozo de Salón" (Restaurante La Mar), which has no
      // screening questions, so it applies immediately without a dialog.
      final laMarCard = find.byKey(const Key('shift-card-shift-la-mar'));
      await tester.ensureVisible(laMarCard);
      await tester.pumpAndSettle();
      await tester.tap(laMarCard);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Postular ahora'));
      await tester.pumpAndSettle();
      expect(find.text('Postulación enviada'), findsWidgets);
      // Dismiss the modal detail sheet by tapping its barrier.
      await tester.tapAt(const Offset(20, 20));
      await tester.pumpAndSettle();

      final repositoryBefore = tester
          .widget<WorkerShell>(find.byType(WorkerShell))
          .repository;
      final statesBefore = await repositoryBefore.applicationStates();
      final savedBefore = await repositoryBefore.savedShiftIds();
      expect(statesBefore['shift-la-mar'], ApplicationState.submitted);
      expect(savedBefore, contains('shift-cafe-cielo'));

      // Toggle dark mode from the profile tab.
      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();
      final switchFinder = find.widgetWithText(SwitchListTile, 'Modo oscuro');
      await tester.ensureVisible(switchFinder);
      await tester.pumpAndSettle();
      await tester.tap(switchFinder);
      await tester.pumpAndSettle();

      // Regression check for CN-20260917-106: before the fix, `WorkerShell`
      // received a brand-new repository instance on this rebuild, discarding
      // everything above.
      final repositoryAfter = tester
          .widget<WorkerShell>(find.byType(WorkerShell))
          .repository;
      expect(
        identical(repositoryBefore, repositoryAfter),
        isTrue,
        reason:
            'the worker repository must survive a dark-mode toggle instead '
            'of being recreated',
      );
      final statesAfter = await repositoryAfter.applicationStates();
      final savedAfter = await repositoryAfter.savedShiftIds();
      expect(statesAfter['shift-la-mar'], ApplicationState.submitted);
      expect(savedAfter, contains('shift-cafe-cielo'));

      // And the UI still reflects it too: back on Discovery, the bookmark is
      // still shown as saved.
      await tester.tap(find.text('Inicio'));
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: cafeCieloCard,
          matching: find.byTooltip('Empleo guardado'),
        ),
        findsOneWidget,
      );
    },
  );
}
