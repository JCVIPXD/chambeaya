import 'dart:async';

import 'package:chambeaya_mobile/features/discovery/discovery_models.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_data.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_secondary_pages.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// El sondeo de "Mis postulaciones" (cada 3 s) debe ser SILENCIOSO: antes cada
// tick asignaba un `Future` nuevo a un `FutureBuilder`, que volvía a
// `ConnectionState.waiting` y reemplazaba toda la lista por un
// `CircularProgressIndicator` mientras llegaba la respuesta (parpadeo visible,
// pérdida de posición de scroll). Estas pruebas fijan el comportamiento nuevo:
// los datos previos se conservan sin indicador de carga, la lista solo se
// reconstruye si el contenido cambió, un fallo conserva lo que se ve, no hay
// peticiones solapadas ni respuestas obsoletas que pisen a una recarga más
// nueva, y el sondeo se detiene con la pestaña oculta y con `dispose`.
void main() {
  testWidgets('the very first load (no data yet) still shows the spinner, then '
      'the list', (tester) async {
    final repository = _Repository()..hold = true;
    await _pumpPage(tester, repository);

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Mozo de Salón'), findsNothing);

    repository.answer(0, {'a': ApplicationState.accepted});
    await tester.pump();
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Mozo de Salón'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets('a periodic refresh keeps the list on screen and never shows a '
      'spinner while waiting for the response', (tester) async {
    final repository = _Repository();
    await _pumpPage(tester, repository);
    expect(find.text('Mozo de Salón'), findsOneWidget);

    repository.hold = true;
    await _tick(tester);

    // The tick did start a request, and it is still in flight.
    expect(repository.pending, hasLength(1));
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Mozo de Salón'), findsOneWidget);
    expect(find.text('Confirmar asistencia'), findsOneWidget);

    repository.answer(0, {'a': ApplicationState.accepted});
    await tester.pump();
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Mozo de Salón'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets('a refresh with identical data does not rebuild the cards', (
    tester,
  ) async {
    final repository = _Repository();
    await _pumpPage(tester, repository);
    // Text widgets are created in `build`, so a rebuilt list yields new
    // instances: identity is what tells "rebuilt" from "left alone". The
    // repository hands out fresh (non-identical) Shift objects on every call,
    // so this also exercises comparison by value, not by reference.
    final before = tester.widget<Text>(find.text('Mozo de Salón'));

    await _tick(tester);
    await _tick(tester);

    expect(repository.stateCalls, 3, reason: 'initial load + two ticks');
    final after = tester.widget<Text>(find.text('Mozo de Salón'));
    expect(identical(before, after), isTrue);
    await _unmount(tester);
  });

  testWidgets('a refresh with different data does update the list, without '
      'a spinner in between', (tester) async {
    final repository = _Repository();
    await _pumpPage(tester, repository);
    expect(find.text('Seleccionado'), findsOneWidget);
    expect(find.text('Proceso cerrado'), findsNothing);
    final before = tester.widget<Text>(find.text('Mozo de Salón'));

    repository.hold = true;
    await _tick(tester);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Seleccionado'), findsOneWidget);

    repository.answer(0, {'a': ApplicationState.closed});
    await tester.pump();
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Seleccionado'), findsNothing);
    expect(find.text('Proceso cerrado'), findsOneWidget);
    expect(
      identical(before, tester.widget<Text>(find.text('Mozo de Salón'))),
      isFalse,
    );
    await _unmount(tester);
  });

  testWidgets('a refresh that brings a new application adds its card', (
    tester,
  ) async {
    final repository = _Repository();
    await _pumpPage(tester, repository);
    expect(find.text('Barista'), findsNothing);

    repository.extraShifts = [_shift('b', 'Barista')];
    repository.states = {
      'a': ApplicationState.accepted,
      'b': ApplicationState.submitted,
    };
    await _tick(tester);

    expect(find.text('Mozo de Salón'), findsOneWidget);
    expect(find.text('Barista'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets('a failed refresh keeps the list and no error screen; only a '
      'second consecutive failure shows a discreet notice, and a later success '
      'clears it', (tester) async {
    final repository = _Repository();
    await _pumpPage(tester, repository);

    repository.failWith = StateError('sin conexión');
    await _tick(tester);

    // One failed poll is usually a blip: nothing changes on screen (a notice
    // that appears and vanishes within 3 s would be a flicker of its own).
    expect(tester.takeException(), isNull);
    expect(find.text('Mozo de Salón'), findsOneWidget);
    expect(find.text('No pudimos cargar tus postulaciones'), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.textContaining('No pudimos actualizar'), findsNothing);

    await _tick(tester);
    expect(find.text('Mozo de Salón'), findsOneWidget);
    expect(find.text('No pudimos cargar tus postulaciones'), findsNothing);
    expect(find.textContaining('No pudimos actualizar'), findsOneWidget);

    repository.failWith = null;
    await _tick(tester);
    expect(find.text('Mozo de Salón'), findsOneWidget);
    expect(find.textContaining('No pudimos actualizar'), findsNothing);
    await _unmount(tester);
  });

  testWidgets('a failed first load shows the error with "Reintentar", which '
      'shows the spinner and loads', (tester) async {
    final repository = _Repository()..failWith = StateError('sin conexión');
    await _pumpPage(tester, repository);
    expect(find.text('No pudimos cargar tus postulaciones'), findsOneWidget);

    repository
      ..failWith = null
      ..hold = true;
    await tester.tap(find.text('Reintentar'));
    await tester.pump();
    // The explicit retry is the one refresh that does show the indicator.
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('No pudimos cargar tus postulaciones'), findsNothing);

    repository.answer(0, {'a': ApplicationState.accepted});
    await tester.pump();
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Mozo de Salón'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets('while the first-load error screen shows, a tick that succeeds '
      'recovers the list without a spinner', (tester) async {
    final repository = _Repository()..failWith = StateError('sin conexión');
    await _pumpPage(tester, repository);
    expect(find.text('No pudimos cargar tus postulaciones'), findsOneWidget);

    repository.failWith = null;
    await _tick(tester);

    expect(find.text('No pudimos cargar tus postulaciones'), findsNothing);
    expect(find.text('Mozo de Salón'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets('ticks do not stack requests while one is still in flight', (
    tester,
  ) async {
    final repository = _Repository();
    await _pumpPage(tester, repository);
    expect(repository.stateCalls, 1);

    repository.hold = true;
    await _tick(tester);
    await _tick(tester);
    await _tick(tester);
    expect(repository.stateCalls, 2, reason: 'one request for three ticks');

    repository.answer(0, {'a': ApplicationState.accepted});
    await tester.pump();
    await tester.pump();
    await _tick(tester);
    expect(repository.stateCalls, 3, reason: 'polling resumes once it ends');
    await _unmount(tester);
  });

  testWidgets('a response that arrives after the page is gone is discarded '
      'and the timer stops', (tester) async {
    final repository = _Repository();
    await _pumpPage(tester, repository);
    repository.hold = true;
    await _tick(tester);
    expect(repository.pending, hasLength(1));

    await _unmount(tester);
    repository.answer(0, {'a': ApplicationState.closed});
    await tester.pump();
    await tester.pump(const Duration(seconds: 12));

    expect(tester.takeException(), isNull);
    expect(repository.stateCalls, 2, reason: 'no request after dispose');
  });

  testWidgets('a slow poll answered late cannot overwrite the newer reload '
      'triggered by the worker\'s own action', (tester) async {
    final repository = _Repository()..confirmError = 'ASSIGNMENT_NOT_FOUND';
    await _pumpPage(tester, repository);
    expect(find.text('Confirmar asistencia'), findsOneWidget);

    // A tick starts a request that the server answers only much later...
    repository.hold = true;
    await _tick(tester);
    expect(repository.pending, hasLength(1));

    // ...meanwhile the worker taps "Confirmar asistencia", the server says the
    // shift is gone and the page reloads right away.
    await tester.tap(find.text('Confirmar asistencia'));
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('ya no está disponible'), findsWidgets);
    expect(repository.pending, hasLength(2), reason: 'the forced reload');

    repository.answer(1, {'a': ApplicationState.closed});
    await tester.pump();
    await tester.pump();
    expect(find.text('Confirmar asistencia'), findsNothing);
    expect(find.text('Proceso cerrado'), findsOneWidget);

    // The old poll finally answers with the stale "accepted" picture.
    repository.answer(0, {'a': ApplicationState.accepted});
    await tester.pump();
    await tester.pump();
    expect(find.text('Confirmar asistencia'), findsNothing);
    expect(find.text('Proceso cerrado'), findsOneWidget);
    await tester.pumpAndSettle();
    await _unmount(tester);
  });

  testWidgets('a refresh keeps the scroll position and the local state of '
      'each card', (tester) async {
    final repository = _Repository()
      ..extraShifts = [for (var i = 0; i < 9; i++) _shift('s$i', 'Turno $i')]
      ..states = {
        'a': ApplicationState.accepted,
        for (var i = 0; i < 9; i++) 's$i': ApplicationState.submitted,
      };
    await _pumpPage(tester, repository);

    // Local-only state: the worker confirmed and the server has not caught up.
    await tester.tap(find.text('Confirmar asistencia'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Confirmar asistencia'), findsNothing);
    expect(find.text('Confirmar llegada'), findsOneWidget);

    await tester.drag(find.byType(ListView), const Offset(0, -450));
    await tester.pump();
    final scrollable = tester.state<ScrollableState>(find.byType(Scrollable));
    final offset = scrollable.position.pixels;
    expect(offset, greaterThan(0));

    repository.hold = true;
    await _tick(tester);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(scrollable.position.pixels, offset);

    // Changed data (one more application) arrives: still no jump.
    repository.answer(0, {
      'a': ApplicationState.accepted,
      for (var i = 0; i < 9; i++) 's$i': ApplicationState.reviewing,
    });
    await tester.pump();
    await tester.pump();
    expect(scrollable.position.pixels, offset);
    expect(find.text('En revisión'), findsWidgets);

    // The card kept what only the app knew (the server still says "not
    // confirmed"): it offers the next step, not "Confirmar asistencia" again.
    expect(find.text('Confirmar asistencia'), findsNothing);
    expect(find.text('Confirmar llegada'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets('the same applications in a different order are a change: the '
      'cards are reordered', (tester) async {
    final repository = _Repository()
      ..extraShifts = [_shift('b', 'Barista')]
      ..states = {
        'a': ApplicationState.accepted,
        'b': ApplicationState.submitted,
      };
    await _pumpPage(tester, repository);
    expect(
      tester.getTopLeft(find.text('Mozo de Salón')).dy,
      lessThan(tester.getTopLeft(find.text('Barista')).dy),
    );

    repository.states = {
      'b': ApplicationState.submitted,
      'a': ApplicationState.accepted,
    };
    await _tick(tester);

    expect(
      tester.getTopLeft(find.text('Barista')).dy,
      lessThan(tester.getTopLeft(find.text('Mozo de Salón')).dy),
    );
    await _unmount(tester);
  });

  testWidgets('polling pauses while the tab is hidden (TickerMode off) and '
      'catches up as soon as it is shown again', (tester) async {
    final repository = _Repository();
    await _pumpPage(tester, repository, tabVisible: false);
    expect(repository.stateCalls, 1, reason: 'the first load runs regardless');

    await tester.pump(const Duration(seconds: 3));
    await tester.pump(const Duration(seconds: 3));
    await tester.pump(const Duration(seconds: 3));
    expect(repository.stateCalls, 1, reason: 'no polling while hidden');

    await _pumpPage(tester, repository, tabVisible: true);
    await tester.pump();
    expect(repository.stateCalls, 2, reason: 'immediate refresh when shown');

    await _tick(tester);
    expect(repository.stateCalls, 3, reason: 'regular polling resumes');
    await _unmount(tester);
  });

  testWidgets('inside the real WorkerShell the hidden Postulaciones tab does '
      'not poll, and the visible one does', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repository = _Repository();
    await tester.pumpWidget(
      MaterialApp(home: WorkerShell(repository: repository)),
    );
    await tester.pump();
    await tester.pump();
    final callsWhenHidden = repository.stateCalls;

    await tester.pump(const Duration(seconds: 3));
    await tester.pump(const Duration(seconds: 3));
    await tester.pump(const Duration(seconds: 3));
    expect(
      repository.stateCalls,
      callsWhenHidden,
      reason: 'three intervals on another tab',
    );

    await tester.tap(find.text('Postulaciones'));
    await tester.pumpAndSettle();
    expect(find.text('Mis postulaciones'), findsOneWidget);
    final callsWhenShown = repository.stateCalls;
    expect(callsWhenShown, greaterThan(callsWhenHidden));

    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    await tester.pump();
    expect(repository.stateCalls, greaterThan(callsWhenShown));
    await _unmount(tester);
  });

  testWidgets(
    're-entering "Postulaciones" keeps the previous cards on screen while the '
    'reload it triggers is in flight, instead of remounting the page and '
    'showing the full-page spinner (CN-20260921-008, MEDIO-2)',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repository = _Repository();
      await tester.pumpWidget(
        MaterialApp(home: WorkerShell(repository: repository, initialIndex: 1)),
      );
      await tester.pump();
      await tester.pump();
      expect(find.text('Mozo de Salón'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      // Leave the tab and come back: `_selectTab` bumps `_applicationRevision`
      // on every entry to "Postulaciones". That revision used to be passed as
      // the page's `ValueKey`, so changing it destroyed the whole `State`
      // (and its `_data`) and recreated it from scratch on every entry.
      repository.hold = true;
      await tester.tap(find.text('Inicio'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Postulaciones'));
      await tester.pumpAndSettle();

      // The reload triggered by re-entering is in flight (held by the fake
      // repository), but the card from the previous load must still be on
      // screen: a remount would have reset `_data` to null and shown the
      // full-page spinner instead, exactly the symptom reported.
      expect(repository.pending, hasLength(1));
      expect(find.text('Mozo de Salón'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      repository.answer(0, {'a': ApplicationState.accepted});
      await tester.pump();
      await tester.pump();
      expect(find.text('Mozo de Salón'), findsOneWidget);
      await _unmount(tester);
    },
  );

  testWidgets(
    're-tapping "Postulaciones" while it is already the active tab still '
    'reloads, and does so through didUpdateWidget rather than a '
    'TickerMode/visibility change (CN-20260922-007, MEDIO-1)',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repository = _Repository();
      await tester.pumpWidget(
        MaterialApp(home: WorkerShell(repository: repository, initialIndex: 1)),
      );
      await tester.pump();
      await tester.pump();
      expect(find.text('Mozo de Salón'), findsOneWidget);
      final callsBeforeRetap = repository.stateCalls;

      // Tap "Postulaciones" while it is already the selected tab.
      // `WorkerShell._selectTab` takes the `!changingTab` branch for this: it
      // still bumps `_applicationRevision` (the manual-refresh contract this
      // whole cierre exists to preserve) but neither `selected` nor
      // `TickerMode.enabled` for this page actually change, so
      // `_onTickerModeChanged` never fires (`visible == _tabVisible` stays
      // true throughout). `didUpdateWidget` is the only route that can
      // deliver this reload; the "re-entering" test above only exercises the
      // tab-switch path, where `_onTickerModeChanged` wins the race and
      // `didUpdateWidget`'s call is the one dropped by `_requestPending`
      // (see CN-20260922-007, MEDIO-1: this exact gap, confirmed by the
      // auditor by neutralizing `didUpdateWidget`'s body and finding no test
      // failed).
      await tester.tap(find.text('Postulaciones'));
      await tester.pump();
      await tester.pump();

      expect(
        repository.stateCalls,
        greaterThan(callsBeforeRetap),
        reason:
            're-tapping the already-active tab must still trigger a silent '
            'reload via didUpdateWidget',
      );
      await _unmount(tester);
    },
  );
}

Shift _shift(String id, String title) => Shift(
  id: id,
  title: title,
  company: 'Restaurante La Mar',
  schedule: 'Hoy · 18:00 – 00:00',
  workerPayCents: 9000,
  urgent: false,
  industry: ShiftIndustry.hospitality,
  location: 'Miraflores, Lima',
  dateScope: ShiftDateScope.any,
  state: ShiftState.assigned,
  screeningQuestions: ['¿Tienes experiencia?'],
);

Future<void> _pumpPage(
  WidgetTester tester,
  WorkerMarketplaceRepository repository, {
  bool tabVisible = true,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: TickerMode(
          enabled: tabVisible,
          child: WorkerApplicationsPage(repository: repository),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

/// Advances the fake clock by one polling interval and lets the request and
/// the rebuild it may cause run.
Future<void> _tick(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 3));
  await tester.pump();
  await tester.pump();
}

// Unmounts the page so its periodic timer is cancelled by `dispose` before the
// test ends.
Future<void> _unmount(WidgetTester tester) =>
    tester.pumpWidget(const SizedBox.shrink());

/// Serves one accepted, not-yet-confirmed application. Every call hands out
/// brand-new `Shift` objects (as the HTTP repository does after decoding the
/// JSON), so equality has to be by value. While [hold] is true, each
/// `applicationStates()` waits for the test to [answer] it.
class _Repository extends DemoWorkerMarketplaceRepository {
  Map<String, ApplicationState> states = {'a': ApplicationState.accepted};
  List<Shift> extraShifts = const [];
  bool hold = false;
  Object? failWith;
  String? confirmError;
  var stateCalls = 0;
  final pending = <Completer<Map<String, ApplicationState>>>[];

  @override
  Future<Map<String, ApplicationState>> applicationStates() {
    stateCalls++;
    final error = failWith;
    if (error != null) return Future.error(error);
    if (hold) {
      final completer = Completer<Map<String, ApplicationState>>();
      pending.add(completer);
      return completer.future;
    }
    return Future.value(Map.of(states));
  }

  void answer(int index, Map<String, ApplicationState> data) =>
      pending[index].complete(data);

  @override
  Future<List<Shift>> availableShifts() async => [
    _shift('a', 'Mozo de Salón'),
    ...extraShifts.map((shift) => _shift(shift.id, shift.title)),
  ];

  @override
  Future<void> confirmAssignment(String shiftId) {
    final code = confirmError;
    if (code != null) return Future.error(MarketplaceApiException(code));
    return Future.value();
  }
}
