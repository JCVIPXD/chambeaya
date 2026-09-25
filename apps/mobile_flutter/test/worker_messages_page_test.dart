import 'dart:async';

import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_secondary_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Cubre los dos sitios de `WorkerMessagesPage` que antes asignaban un `Future`
// dentro de un `setState(() => _loading = ...)` de cuerpo de expresión. En
// modo debug `setState` lanza una aserción cuando su callback devuelve un
// `Future`, y esa aserción salta ANTES de `markNeedsBuild`: la pantalla no se
// reconstruía. En el sondeo (`_poll`) el error además lo tragaba `catch (_)`,
// así que el síntoma era silencioso: la lista simplemente dejaba de
// refrescarse. Por eso las pruebas verifican el efecto visible (la lista
// nueva aparece), no solo `takeException`. La tercera prueba cubre el `catch`
// del sondeo: un fallo conserva la lista, muestra un aviso discreto y el
// siguiente sondeo exitoso lo limpia. La cuarta cubre el "Reintentar" de la
// pantalla de error de carga: un sondeo fallido detrás de esa pantalla enciende
// la bandera, y el reintento exitoso debe limpiarla.
void main() {
  testWidgets(
    'retrying after a failed load reloads the conversations without a '
    'setState assertion',
    (tester) async {
      final repository = _ScriptedConversationsRepository([
        () => Future.error(StateError('sin conexión')),
        () async => [_conversation('c1', 'Restaurante La Mar')],
      ]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('No pudimos cargar tus mensajes'), findsOneWidget);

      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('No pudimos cargar tus mensajes'), findsNothing);
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      await _unmount(tester);
    },
  );

  testWidgets(
    'the periodic poll swaps in the refreshed conversations and rebuilds',
    (tester) async {
      final repository = _ScriptedConversationsRepository([
        () async => [_conversation('c1', 'Restaurante La Mar')],
        () async => [
          _conversation('c1', 'Restaurante La Mar'),
          _conversation('c2', 'Eventos Perú'),
        ],
      ]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.text('Eventos Perú'), findsNothing);

      // The 4-second timer fires `_poll`, which awaits the repository and then
      // replaces `_loading`; the extra pumps let that microtask chain and the
      // rebuild run.
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.text('Eventos Perú'), findsOneWidget);
      await _unmount(tester);
    },
  );

  testWidgets(
    'a failed poll keeps the list, shows a notice and clears it once a later '
    'poll succeeds',
    (tester) async {
      final repository = _ScriptedConversationsRepository([
        () async => [_conversation('c1', 'Restaurante La Mar')],
        () => Future.error(StateError('sin conexión')),
        () async => [
          _conversation('c1', 'Restaurante La Mar'),
          _conversation('c2', 'Eventos Perú'),
        ],
      ]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.textContaining('No pudimos actualizar'), findsNothing);

      // First poll fails: the list already on screen stays, the full-screen
      // error state does not replace it, and the notice tells the worker the
      // data may be stale.
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.text('No pudimos cargar tus mensajes'), findsNothing);
      expect(find.textContaining('No pudimos actualizar'), findsOneWidget);

      // The timer keeps retrying; the next success brings the fresh list and
      // clears the notice.
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.text('Eventos Perú'), findsOneWidget);
      expect(find.textContaining('No pudimos actualizar'), findsNothing);
      await _unmount(tester);
    },
  );

  testWidgets(
    'retrying from the load error screen clears a notice raised by a poll that '
    'failed in the meantime',
    (tester) async {
      final repository = _ScriptedConversationsRepository([
        () => Future.error(StateError('sin conexión')),
        () => Future.error(StateError('sin conexión')),
        () async => [_conversation('c1', 'Restaurante La Mar')],
      ]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('No pudimos cargar tus mensajes'), findsOneWidget);

      // A poll fails while the initial-load error screen is still showing: it
      // raises the flag behind that screen, which keeps precedence.
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();
      expect(find.text('No pudimos cargar tus mensajes'), findsOneWidget);
      expect(find.textContaining('No pudimos actualizar'), findsNothing);

      // The worker taps "Reintentar" before the next tick and the reload works:
      // nothing is failing any more, so the stale notice must not appear on top
      // of the fresh list while waiting for the next poll to clear it.
      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.text('No pudimos cargar tus mensajes'), findsNothing);
      expect(find.textContaining('No pudimos actualizar'), findsNothing);
      await _unmount(tester);
    },
  );

  testWidgets('a poll does not paint a spinner frame in place of the list '
      '(CN-20260921-008, MEDIO-3: SynchronousFuture instead of Future.value)', (
    tester,
  ) async {
    final repository = _ScriptedConversationsRepository([
      () async => [_conversation('c1', 'Restaurante La Mar')],
      () async => [
        _conversation('c1', 'Restaurante La Mar'),
        _conversation('c2', 'Eventos Perú'),
      ],
    ]);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: WorkerMessagesPage(repository: repository)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Restaurante La Mar'), findsOneWidget);

    // The 4-second timer fires `_poll`, which awaits the repository and
    // then reassigns `_loading` to a new future for the same
    // `FutureBuilder`. `tester.pump(duration)` both elapses the fake clock
    // (firing the timer and running `_poll` up to and past that `await`)
    // and draws the next frame in the same call, with no separate `pump()`
    // needed in between (checked empirically: with the pre-fix
    // `Future.value`, the spinner is already showing by this point, not
    // one `pump()` later). A plain `Future`'s `.then` always defers via a
    // microtask even when already resolved, so `FutureBuilder` sees a new
    // future identity and reports `ConnectionState.waiting` for exactly
    // this frame, painting a `CircularProgressIndicator` over the whole
    // list. `SynchronousFuture.then` runs synchronously inside this same
    // build, so this frame already shows the resolved list instead.
    await tester.pump(const Duration(seconds: 4));

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Restaurante La Mar'), findsOneWidget);

    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('Eventos Perú'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets(
    'tapping "Actualizar mensajes" while a refresh is already in flight still '
    'shows a visible updating signal instead of a silent no-op '
    '(CN-20260918-010, BAJO-2)',
    (tester) async {
      final repository = _HoldableConversationsRepository()
        ..data = [_conversation('c1', 'Restaurante La Mar')];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      // The automatic 4 s timer starts a refresh that the fake repository
      // holds open, simulating one already in flight when the worker taps
      // the button.
      repository.hold = true;
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      expect(repository.pending, hasLength(1));

      // The button already reflects the in-flight refresh...
      expect(find.byIcon(Icons.refresh_rounded), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // ...and tapping it while that refresh is still in flight must not be a
      // silent no-op: before this fix, `_poll` returning early on
      // `_refreshing` left the tap with no visible reaction of any kind, and
      // it must not start a second overlapping request either.
      await tester.tap(find.byTooltip('Actualizar mensajes'));
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(
        repository.calls,
        2,
        reason: 'initial load + the one held refresh; the tap started none',
      );

      repository.answer(0, [
        _conversation('c1', 'Restaurante La Mar'),
        _conversation('c2', 'Eventos Perú'),
      ]);
      await tester.pump();
      await tester.pump();
      expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('Eventos Perú'), findsOneWidget);
      await _unmount(tester);
    },
  );

  testWidgets(
    'a second consecutive failed poll still turns the button icon back to '
    'idle once the failure lands, instead of leaving it stuck showing '
    '"updating" until the next poll starts '
    '(CN-20260922-006, BAJO-1: unconditional setState in the catch)',
    (tester) async {
      final repository = _HoldableConversationsRepository()
        ..data = [_conversation('c1', 'Restaurante La Mar')];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);

      // First failed poll. The "updating" frame is rendered (via its own
      // `pump()`, forcing the widget to actually rebuild and paint the
      // spinner) *before* the failure lands, so the rebuild that follows the
      // failure -- not a leftover from the one that started the poll -- is
      // what has to turn the icon back off. `_refreshFailed` goes from false
      // to true here, so even the reverted buggy condition
      // `mounted && !_refreshFailed` would still fire on this first failure;
      // it does not yet discriminate the fix (see the second failure below).
      repository.hold = true;
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      expect(repository.pending, hasLength(1));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      repository.pending[0].completeError(StateError('sin conexión'));
      await tester.pump();
      await tester.pump();
      expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      // Second consecutive failure: `_refreshFailed` is already true when
      // this poll's `catch` runs, so the reverted buggy condition
      // `!_refreshFailed` would be false and `setState` would be skipped
      // entirely -- `_refreshing` would only flip to `false` in the
      // unconditional `finally`, a plain field write with no rebuild. Because
      // the "updating" frame here is rendered (and settles: the widget is no
      // longer dirty) *before* the failure completes, there is nothing left
      // to pick up that field write once the failure lands, and the button
      // would stay stuck showing the spinner until the next poll 4 s later.
      // The fix's unconditional `if (mounted)` must still turn it back to
      // idle right away.
      repository.hold = true;
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      expect(repository.pending, hasLength(2));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      repository.pending[1].completeError(StateError('sin conexión'));
      await tester.pump();
      await tester.pump();
      expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      await _unmount(tester);
    },
  );

  // Pendiente #2d del plan maestro: el sondeo de mensajes tampoco debe correr
  // con la aplicación en segundo plano.
  testWidgets(
    'the message poll stops while the app is in the background and catches up '
    'on resume; inactive keeps polling',
    (tester) async {
      addTearDown(() => _goForeground(tester));
      final repository = _HoldableConversationsRepository()
        ..data = [_conversation('c1', 'Restaurante La Mar')];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      expect(repository.calls, 1);

      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();
      expect(repository.calls, 2, reason: 'foreground: normal polling');

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();
      expect(repository.calls, 3, reason: 'inactive still polls');

      _goBackground(tester);
      await tester.pump(const Duration(seconds: 4));
      await tester.pump(const Duration(seconds: 4));
      await tester.pump(const Duration(seconds: 4));
      expect(repository.calls, 3, reason: 'no polling in the background');

      _goForeground(tester);
      await tester.pump();
      await tester.pump();
      expect(repository.calls, 4, reason: 'immediate catch-up on resume');

      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();
      expect(repository.calls, 5, reason: 'regular polling resumes');
      await _unmount(tester);
    },
  );

  testWidgets(
    'an open conversation stops polling its messages in the background and '
    'catches up on resume',
    (tester) async {
      addTearDown(() => _goForeground(tester));
      final repository = _HoldableConversationsRepository()
        ..data = [_conversation('c1', 'Restaurante La Mar')];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Restaurante La Mar'));
      await tester.pumpAndSettle();
      final opened = repository.conversationCalls;
      expect(opened, greaterThanOrEqualTo(1), reason: 'the sheet loaded');

      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      expect(repository.conversationCalls, opened + 1);

      _goBackground(tester);
      await tester.pump(const Duration(seconds: 4));
      await tester.pump(const Duration(seconds: 4));
      await tester.pump(const Duration(seconds: 4));
      expect(repository.conversationCalls, opened + 1);

      _goForeground(tester);
      await tester.pump();
      await tester.pump();
      expect(repository.conversationCalls, opened + 2);
      await _unmount(tester);
    },
  );
}

/// The OS moves the app to the background through `inactive` and `hidden`, and
/// back through `inactive` (the framework asserts on skipped transitions).
void _goBackground(WidgetTester tester) {
  for (final state in [
    AppLifecycleState.inactive,
    AppLifecycleState.hidden,
    AppLifecycleState.paused,
  ]) {
    tester.binding.handleAppLifecycleStateChanged(state);
  }
}

void _goForeground(WidgetTester tester) {
  for (final state in [
    AppLifecycleState.hidden,
    AppLifecycleState.inactive,
    AppLifecycleState.resumed,
  ]) {
    tester.binding.handleAppLifecycleStateChanged(state);
  }
}

// Unmounts the page so its periodic refresh timer is cancelled by `dispose`
// before the test ends.
Future<void> _unmount(WidgetTester tester) =>
    tester.pumpWidget(const SizedBox.shrink());

// Fija una sola vez (los inicializadores de nivel superior son perezosos) un
// instante de hace 3 días, para que todas las conversaciones compartan
// `updatedAt` y su etiqueta no dependa de una fecha calendario fija.
final DateTime _staleUpdatedAt = DateTime.now().subtract(
  const Duration(days: 3),
);

WorkerConversationRecord _conversation(String id, String company) =>
    WorkerConversationRecord(
      id: id,
      company: company,
      subject: 'Postulación · Mozo de Salón',
      updatedAt: _staleUpdatedAt,
      messages: const [],
    );

/// Answers each `workerConversations()` call with the next scripted result and
/// keeps repeating the last one, so the page's retries and polling never run
/// off the end of the script.
class _ScriptedConversationsRepository extends DemoWorkerMarketplaceRepository {
  _ScriptedConversationsRepository(this._script);

  final List<Future<List<WorkerConversationRecord>> Function()> _script;
  var _calls = 0;

  @override
  Future<List<WorkerConversationRecord>> workerConversations() {
    final index = _calls < _script.length ? _calls : _script.length - 1;
    _calls++;
    return _script[index]();
  }
}

/// Serves [data] immediately, unless [hold] is true, in which case each
/// `workerConversations()` call hangs on a `Completer` added to [pending]
/// until the test [answer]s it. Used to put a refresh "in flight" on demand,
/// the way the button's own visible-signal test needs.
class _HoldableConversationsRepository extends DemoWorkerMarketplaceRepository {
  List<WorkerConversationRecord> data = const [];
  var hold = false;
  var calls = 0;
  var conversationCalls = 0;
  final pending = <Completer<List<WorkerConversationRecord>>>[];

  @override
  Future<WorkerConversationRecord> workerConversation(String conversationId) {
    conversationCalls++;
    return Future.value(data.firstWhere((item) => item.id == conversationId));
  }

  @override
  Future<List<WorkerConversationRecord>> workerConversations() {
    calls++;
    if (hold) {
      final completer = Completer<List<WorkerConversationRecord>>();
      pending.add(completer);
      return completer.future;
    }
    return Future.value(List.of(data));
  }

  void answer(int index, List<WorkerConversationRecord> value) =>
      pending[index].complete(value);
}
